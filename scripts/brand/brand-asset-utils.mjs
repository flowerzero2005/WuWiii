import { Buffer } from 'node:buffer'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export function findSharp(repoRoot, moduleUrl) {
  const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
  const sharpPackage = readdirSync(pnpmDir)
    .filter(name => name.startsWith('sharp@'))
    .sort()
    .at(-1)
  if (!sharpPackage)
    throw new Error('Sharp is not available in the existing pnpm dependency tree.')
  return createRequire(moduleUrl)(join(pnpmDir, sharpPackage, 'node_modules', 'sharp'))
}

export function writeAsset(target, value) {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, value)
}

export function createIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(buffer.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += buffer.length
  })
  return Buffer.concat([header, ...images.map(image => image.buffer)])
}

export function createIcns(chunks) {
  const body = Buffer.concat(chunks.map(({ type, buffer }) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(buffer.length + 8, 4)
    return Buffer.concat([header, buffer])
  }))
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}
