import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createIcns, createIco, findSharp, writeAsset } from './brand-asset-utils.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const finalDir = join(repoRoot, 'docs', 'brand', 'final', 'airi-app-icon')
const desktopRoot = join(repoRoot, 'apps', 'stage-tamagotchi')
const masterPath = join(finalDir, 'airi-app-icon-master.png')
const foregroundPath = join(finalDir, 'airi-app-icon-foreground.png')

const approvedSources = new Map([
  [masterPath, '2764b44f7eef195299a1b0f57b63216d36800e8741264b40cbda880590eaff49'],
  [foregroundPath, '2e28c98d037075d80912c1662d830ce72edbd596caa29b577a8463cc696bc8fd'],
])

for (const [path, expectedHash] of approvedSources) {
  const actualHash = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (actualHash !== expectedHash)
    throw new Error(`Approved AIRI companion icon source changed: ${path}`)
}

const sharp = findSharp(repoRoot, import.meta.url)
const master = readFileSync(masterPath)
const pngs = new Map()
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  // NOTICE: Full-composition downsamples make the character illegible in the
  // Windows taskbar and tray. Small exports use an approved optical face crop.
  const image = size <= 32
    ? sharp(master).extract({ left: 260, top: 150, width: 600, height: 600 })
    : sharp(master)
  const buffer = await image.resize(size, size).png().toBuffer()
  pngs.set(size, buffer)
  writeAsset(join(finalDir, `airi-app-icon-${size}.png`), buffer)
}

writeAsset(join(desktopRoot, 'resources', 'icon.png'), pngs.get(512))
writeAsset(join(desktopRoot, 'resources', 'icon-512.png'), pngs.get(512))
writeAsset(join(desktopRoot, 'resources', 'tray-icon.png'), pngs.get(16))
writeAsset(join(desktopRoot, 'resources', 'tray-icon@2x.png'), pngs.get(32))
writeAsset(join(desktopRoot, 'build', 'icon.png'), pngs.get(512))
writeAsset(join(desktopRoot, 'build', 'icons', 'icon.png'), pngs.get(512))
const windowsIcon = createIco(
  [16, 24, 32, 48, 64, 128, 256].map(size => ({ size, buffer: pngs.get(size) })),
)
writeAsset(join(desktopRoot, 'resources', 'icon.ico'), windowsIcon)
writeAsset(join(desktopRoot, 'build', 'icon.ico'), windowsIcon)
writeAsset(join(desktopRoot, 'build', 'icon.icns'), createIcns([
  { type: 'icp4', buffer: pngs.get(16) },
  { type: 'icp5', buffer: pngs.get(32) },
  { type: 'icp6', buffer: pngs.get(64) },
  { type: 'ic07', buffer: pngs.get(128) },
  { type: 'ic08', buffer: pngs.get(256) },
  { type: 'ic09', buffer: pngs.get(512) },
  { type: 'ic10', buffer: pngs.get(1024) },
  { type: 'ic11', buffer: pngs.get(32) },
  { type: 'ic12', buffer: pngs.get(64) },
  { type: 'ic13', buffer: pngs.get(256) },
  { type: 'ic14', buffer: pngs.get(512) },
]))

const macOSTrayMask = await sharp(foregroundPath)
  .extract({ left: 130, top: 0, width: 950, height: 950 })
  .flatten({ background: 'white' })
  .grayscale()
  .threshold(112)
  .negate()
  .resize(28, 28)
  .raw()
  .toBuffer({ resolveWithObject: true })
if (macOSTrayMask.info.channels !== 1)
  throw new Error(`Expected a single-channel macOS tray mask, received ${macOSTrayMask.info.channels}.`)
const macOSTrayPixels = Buffer.alloc(28 * 28 * 4)
for (let index = 0; index < macOSTrayMask.data.length; index++)
  macOSTrayPixels[index * 4 + 3] = macOSTrayMask.data[index]
const macOSTrayIcon = await sharp(macOSTrayPixels, {
  raw: { width: 28, height: 28, channels: 4 },
})
  .extend({ top: 2, right: 2, bottom: 2, left: 2, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()
writeAsset(join(desktopRoot, 'resources', 'tray-icon-macos.png'), macOSTrayIcon)

console.info('Generated approved AIRI/Wuwiii companion desktop, installer, dock, window, and tray icons.')
