import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { argv, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptPath = fileURLToPath(import.meta.url)
// NOTICE: Bump this when the cached executable layout changes. Windows caches
// taskbar icons by executable path and AppUserModelID, even after an in-place rebrand.
const DEV_RUNTIME_CACHE_VERSION = 2

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readState(path) {
  if (!existsSync(path))
    return undefined

  try {
    const state = JSON.parse(readFileSync(path, 'utf8'))
    if (
      typeof state?.electronVersion === 'string'
      && typeof state?.baseHash === 'string'
      && typeof state?.brandedHash === 'string'
      && typeof state?.iconHash === 'string'
    ) {
      return state
    }
  }
  catch {
    // A missing or interrupted state write is recovered from the pristine backup below.
  }

  return undefined
}

export function getBrandingPlan({ backupHash, currentHash, electronVersion, iconHash, state }) {
  if (!state) {
    return {
      refreshBackup: !backupHash,
      shouldBrand: true,
    }
  }

  // A previous migration may already have restored node_modules/electron from
  // the pristine backup. That is a valid steady state, not a new install.
  if (currentHash === backupHash && backupHash === state.baseHash) {
    return {
      refreshBackup: false,
      shouldBrand: false,
    }
  }

  // A hash change outside our own branded output means pnpm installed a new Electron binary.
  if (currentHash !== state.brandedHash) {
    return {
      refreshBackup: true,
      shouldBrand: true,
    }
  }

  if (backupHash !== state.baseHash)
    throw new Error('The pristine Electron backup is missing or invalid. Reinstall Electron before starting Wuwiii again.')

  return {
    refreshBackup: false,
    shouldBrand: state.electronVersion !== electronVersion || state.iconHash !== iconHash,
  }
}

export function getDevRuntimeIdentity({ baseHash, electronVersion, iconHash }) {
  return `electron-v${DEV_RUNTIME_CACHE_VERSION}-${electronVersion}-${baseHash.slice(0, 12)}-${iconHash.slice(0, 12)}`
}

export function getBrandingState({ electronVersion, baseHash, brandedHash, iconHash }) {
  return { electronVersion, baseHash, brandedHash, iconHash }
}

function writeBrandedExecutable({ desktopRequire, iconPath, pristineExecutable, targetExecutable }) {
  const electronBuilderRequire = createRequire(desktopRequire.resolve('electron-builder'))
  const appBuilderRequire = createRequire(electronBuilderRequire.resolve('app-builder-lib'))
  const PELibrary = appBuilderRequire('pe-library')
  const ResEdit = appBuilderRequire('resedit')

  const executable = PELibrary.NtExecutable.from(readFileSync(pristineExecutable), { ignoreCert: true })
  const resources = PELibrary.NtExecutableResource.from(executable)
  const icons = ResEdit.Data.IconFile.from(readFileSync(iconPath)).icons.map(item => item.data)
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)

  if (groups.length === 0) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 101, 1033, icons)
  }
  else {
    for (const group of groups)
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons)
  }

  resources.outputResource(executable)
  writeFileSync(targetExecutable, Buffer.from(executable.generate()))
}

/**
 * Reuse a previously prepared runtime when pnpm left Electron's package
 * without its downloaded `dist` directory (for example after an
 * `--ignore-scripts` install). The hidden VBS launcher has no console, so
 * failing before this recovery made a desktop click look like a no-op.
 */
function findCachedRuntimeDist(root, electronVersion, iconPath) {
  const cacheRoot = join(root, '.cache', 'wuwiii-dev-electron')
  if (!existsSync(cacheRoot))
    return undefined

  const iconHash = sha256(iconPath)
  const candidates = readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .reverse()

  for (const candidate of candidates) {
    const runtimeRoot = join(cacheRoot, candidate.name)
    const readyPath = join(runtimeRoot, 'ready.json')
    const runtimeExecutable = join(runtimeRoot, 'dist', 'electron.exe')
    if (!existsSync(readyPath) || !existsSync(runtimeExecutable))
      continue

    try {
      const ready = JSON.parse(readFileSync(readyPath, 'utf8'))
      if (ready?.electronVersion === electronVersion && ready?.iconHash === iconHash)
        return join(runtimeRoot, 'dist')
    }
    catch {
      // Ignore an interrupted cache entry and try the next one.
    }
  }

  return undefined
}

export function prepareWuwiiiDevElectron(root = repoRoot) {
  const desktopRoot = join(root, 'apps', 'stage-tamagotchi')
  const desktopRequire = createRequire(join(desktopRoot, 'package.json'))
  const electronRoot = dirname(realpathSync(desktopRequire.resolve('electron/package.json')))
  const electronDist = join(electronRoot, 'dist')
  const electronExecutable = join(electronDist, 'electron.exe')
  const pristineExecutable = join(electronRoot, '.wuwiii-electron-original.exe')
  const electronPathFile = join(electronRoot, 'path.txt')
  const statePath = join(electronRoot, '.wuwiii-electron-state.json')
  const iconPath = join(desktopRoot, 'build', 'icon.ico')

  if (!existsSync(iconPath))
    throw new Error('The Wuwiii desktop icon is missing. Run the icon generator first.')

  // Electron's postinstall may not have downloaded `dist` even though a
  // branded runtime from an earlier launch is still available in `.cache`.
  // Reusing that exact version/icon keeps the launcher functional and avoids
  // silently doing nothing from the VBS entrypoint.
  if (!existsSync(electronExecutable)) {
    const packageVersion = JSON.parse(readFileSync(desktopRequire.resolve('electron/package.json'), 'utf8')).version
    const cachedRuntime = findCachedRuntimeDist(root, packageVersion, iconPath)
    if (cachedRuntime)
      return cachedRuntime

    throw new Error('Electron is not installed correctly. Run pnpm install (without --ignore-scripts) before starting Wuwiii.')
  }

  const electronVersion = readFileSync(join(electronDist, 'version'), 'utf8').trim()
  const currentHash = sha256(electronExecutable)
  const backupHash = existsSync(pristineExecutable) ? sha256(pristineExecutable) : undefined
  const state = readState(statePath)
  const plan = getBrandingPlan({ backupHash, currentHash, electronVersion, iconHash: sha256(iconPath), state })

  if (plan.refreshBackup) {
    copyFileSync(electronExecutable, pristineExecutable)
  }
  else if (currentHash === state?.brandedHash) {
    // NOTICE: Older launchers branded node_modules/electron/dist/electron.exe in place.
    // Restore the pristine binary once; all subsequent development launches use the
    // icon-versioned runtime cache below so the Windows Shell gets a new executable path.
    copyFileSync(pristineExecutable, electronExecutable)
  }

  const baseHash = sha256(pristineExecutable)
  const iconHash = sha256(iconPath)
  const runtimeIdentity = getDevRuntimeIdentity({ baseHash, electronVersion, iconHash })
  const runtimeRoot = join(root, '.cache', 'wuwiii-dev-electron', runtimeIdentity)
  const runtimeDist = join(runtimeRoot, 'dist')
  const runtimeExecutable = join(runtimeDist, 'electron.exe')
  const readyPath = join(runtimeRoot, 'ready.json')

  if (!existsSync(readyPath) || !existsSync(runtimeExecutable)) {
    mkdirSync(runtimeRoot, { recursive: true })
    cpSync(electronDist, runtimeDist, { recursive: true, force: true })
    writeBrandedExecutable({
      desktopRequire,
      iconPath,
      pristineExecutable,
      targetExecutable: runtimeExecutable,
    })
    writeFileSync(readyPath, `${JSON.stringify({ electronVersion, baseHash, iconHash, runtimeIdentity }, null, 2)}\n`)
  }

  // Electron identifies development mode partly from this executable basename.
  // The cache directory changes when the icon changes, while the executable stays electron.exe.
  writeFileSync(electronPathFile, 'electron.exe')
  writeFileSync(statePath, `${JSON.stringify(getBrandingState({
    electronVersion,
    baseHash,
    brandedHash: sha256(runtimeExecutable),
    iconHash,
  }), null, 2)}\n`)

  return runtimeDist
}

if (argv[1] && resolve(argv[1]) === scriptPath)
  stdout.write(prepareWuwiiiDevElectron())
