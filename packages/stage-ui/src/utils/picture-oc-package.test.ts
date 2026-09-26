import JSZip from 'jszip'

import { describe, expect, it } from 'vitest'

import { createPictureOcSemanticActionCards, inspectPictureOcPackage, isPictureOcSemanticActionLocked, loadPictureOcActionAssets, resolvePictureOcActionPath, resolvePictureOcSemanticActionId, resolvePictureOcSupportedActionPath } from './picture-oc-package'

const png = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00])
const gif = new TextEncoder().encode('GIF89a')

async function archiveFile(name: string, files: Record<string, string | Uint8Array>) {
  const archive = new JSZip()
  for (const [path, content] of Object.entries(files))
    archive.file(path, content)
  return new File([Uint8Array.from(await archive.generateAsync({ type: 'uint8array' }))], name, { type: 'application/zip' })
}

describe('picture OC package inspection', () => {
  it('creates stable identities and an idle mapping for a manifest-free single-image package', async () => {
    const file = await archiveFile('Miu.zip', { 'idle.png': png })

    const first = await inspectPictureOcPackage(file)
    const second = await inspectPictureOcPackage(file)

    expect(first).toMatchObject({
      actions: { idle: 'idle.png' },
      imagePaths: ['idle.png'],
      manifestSource: 'generated',
      name: 'Miu',
    })
    expect(first.packageId).toBe(second.packageId)
    expect(first.characterId).toBe(second.characterId)
    expect(first.modelId).toBe(second.modelId)
  })

  it('uses an idle-named image as the default action in a manifest-free multi-image package', async () => {
    const file = await archiveFile('Miu.zip', {
      'happy.png': png,
      'idle.png': png,
    })

    await expect(inspectPictureOcPackage(file)).resolves.toMatchObject({
      actions: { idle: 'idle.png' },
      imagePaths: ['happy.png', 'idle.png'],
      manifestSource: 'generated',
    })
  })

  it('validates manifest identities and normalizes built-in, emotion, and custom actions', async () => {
    const manifest = {
      schemaVersion: 1,
      packageId: 'miu-package',
      characterId: 'miu-character',
      modelId: 'miu-model',
      name: 'Miu',
      actions: {
        idle: 'idle.png',
        speaking: 'talk.gif',
        emotions: { happy: 'happy.png' },
        custom: { wave: 'wave.png' },
      },
    }
    const file = await archiveFile('miu.zip', {
      'oc.json': JSON.stringify(manifest),
      'idle.png': png,
      'talk.gif': gif,
      'happy.png': png,
      'wave.png': png,
    })

    await expect(inspectPictureOcPackage(file)).resolves.toMatchObject({
      actions: {
        'idle': 'idle.png',
        'speaking': 'talk.gif',
        'emotion:happy': 'happy.png',
        'custom:wave': 'wave.png',
      },
      characterId: 'miu-character',
      manifestSource: 'oc.json',
      modelId: 'miu-model',
      packageId: 'miu-package',
    })

    const assets = await loadPictureOcActionAssets(file, {
      idle: 'idle.png',
      speaking: 'talk.gif',
    })
    expect(assets.idle).toMatchObject({ path: 'idle.png' })
    expect(assets.idle.blob.type).toBe('image/png')
    expect(assets.speaking.blob.type).toBe('image/gif')
  })

  it('rejects ZIP traversal paths before reading image content', async () => {
    const file = await archiveFile('unsafe.zip', { '../idle.png': png })

    await expect(inspectPictureOcPackage(file)).rejects.toThrow(/unsafe path/i)
  })

  it('rejects nested archives and files disguised with an image extension', async () => {
    const nested = await archiveFile('nested.zip', { 'idle.png': png, 'other.zip': 'nested' })
    const disguised = await archiveFile('disguised.zip', { 'idle.png': 'not an image' })

    await expect(inspectPictureOcPackage(nested)).rejects.toThrow(/nested archives/i)
    await expect(inspectPictureOcPackage(disguised)).rejects.toThrow(/signature/i)
  })

  it('rejects manifests without idle and mappings outside the package image set', async () => {
    const base = {
      schemaVersion: 1,
      packageId: 'miu-package',
      characterId: 'miu-character',
      modelId: 'miu-model',
      name: 'Miu',
    }
    const missingIdle = await archiveFile('missing-idle.zip', {
      'oc.json': JSON.stringify({ ...base, actions: { speaking: 'talk.gif' } }),
      'talk.gif': gif,
    })
    const missingImage = await archiveFile('missing-image.zip', {
      'oc.json': JSON.stringify({ ...base, actions: { idle: 'missing.png' } }),
      'idle.png': png,
    })

    await expect(inspectPictureOcPackage(missingIdle)).rejects.toThrow(/schema version 1/i)
    await expect(inspectPictureOcPackage(missingImage)).rejects.toThrow(/missing or invalid image/i)
  })

  it('resolves exact and emotion actions before falling back to idle', () => {
    const actions = { idle: 'idle.png', happy: 'happy.png', speaking: 'talk.gif' }

    expect(resolvePictureOcActionPath(actions, 'speaking')).toBe('talk.gif')
    expect(resolvePictureOcActionPath(actions, 'emotion:happy')).toBe('happy.png')
    expect(resolvePictureOcActionPath(actions, 'thinking')).toBe('idle.png')
    expect(resolvePictureOcSupportedActionPath(actions, 'thinking')).toBeUndefined()
  })

  it('exposes only manifest custom keys without inventing natural-language meaning', () => {
    expect(createPictureOcSemanticActionCards({
      'idle': 'idle.png',
      'happy': 'happy.png',
      'custom:wave-small': 'wave.png',
    })).toEqual([expect.objectContaining({
      id: 'custom:wave-small',
      meaning: '图片 OC 清单中的动作：wave-small',
      suitableWhen: [],
    })])
  })

  it('normalizes semantic action ids without duplicating the custom namespace', () => {
    expect(resolvePictureOcSemanticActionId('wave-small')).toBe('custom:wave-small')
    expect(resolvePictureOcSemanticActionId('custom:wave-small')).toBe('custom:wave-small')
  })

  it('keeps a non-interruptible semantic action until its scheduled release', () => {
    expect(isPictureOcSemanticActionLocked('custom:wave', 'speaking', false, 200, 100)).toBe(true)
    expect(isPictureOcSemanticActionLocked('custom:wave', 'speaking', true, 200, 100)).toBe(false)
    expect(isPictureOcSemanticActionLocked('custom:wave', 'speaking', false, 100, 100)).toBe(false)
    expect(isPictureOcSemanticActionLocked('custom:wave', 'custom:wave', false, 200, 100)).toBe(false)
  })
})
