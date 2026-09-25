import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import JSZip from 'jszip'

const editableSourceExtensions = ['.can3', '.cmo3']

function isRuntimeEntry(name: string) {
  return name.replaceAll('\\', '/').toLowerCase().includes('/runtime/')
}

function isLicenseNotice(name: string) {
  return /^(?:license|readme|terms)(?:\..+)?$/i.test(basename(name))
}

/** Replace a Live2D sample archive with the files required by the application runtime. */
export async function prepareLive2dRuntimeArchive(path: string) {
  const sourceBytes = await readFile(path)
  const sourceArchive = await JSZip.loadAsync(sourceBytes)
  const sourceFiles = Object.values(sourceArchive.files).filter(entry => !entry.dir)
  const retainedFiles = sourceFiles.filter(entry => isRuntimeEntry(entry.name) || isLicenseNotice(entry.name))

  if (!retainedFiles.some(entry => entry.name.toLowerCase().endsWith('.moc3')))
    throw new Error(`Live2D runtime archive is missing a .moc3 file: ${path}`)
  if (!retainedFiles.some(entry => entry.name.toLowerCase().endsWith('.model3.json')))
    throw new Error(`Live2D runtime archive is missing a .model3.json file: ${path}`)
  if (!retainedFiles.some(entry => isLicenseNotice(entry.name)))
    throw new Error(`Live2D runtime archive is missing a license or attribution notice: ${path}`)

  const forbiddenEntries = retainedFiles.filter(entry => editableSourceExtensions.some(extension => entry.name.toLowerCase().endsWith(extension)))
  if (forbiddenEntries.length > 0)
    throw new Error(`Live2D runtime archive still contains editable source files: ${forbiddenEntries.map(entry => entry.name).join(', ')}`)

  if (retainedFiles.length === sourceFiles.length) {
    return {
      afterBytes: sourceBytes.length,
      beforeBytes: sourceBytes.length,
      changed: false,
      removedEntries: 0,
    }
  }

  const runtimeArchive = new JSZip()
  for (const entry of retainedFiles) {
    runtimeArchive.file(entry.name, await entry.async('nodebuffer'), {
      date: entry.date,
    })
  }

  const runtimeBytes = await runtimeArchive.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    type: 'nodebuffer',
  })
  await writeFile(path, runtimeBytes)

  return {
    afterBytes: runtimeBytes.length,
    beforeBytes: sourceBytes.length,
    changed: true,
    removedEntries: sourceFiles.length - retainedFiles.length,
  }
}
