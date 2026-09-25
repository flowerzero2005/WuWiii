import { describe, expect, it } from 'vitest'

import {
  estimateOfficialCloudAsrPoints,
  estimateOfficialCloudTtsPoints,
  getOfficialCloudPcmWavDurationMs,
} from './official-cloud-audio-points'

function wav(durationMs: number, audioFormat = 1) {
  const sampleRate = 1000
  const blockAlign = 2
  const dataBytes = Math.round(sampleRate * blockAlign * durationMs / 1000)
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1)
      bytes[offset + index] = text.charCodeAt(index)
  }

  writeText(0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, audioFormat, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataBytes, true)
  return bytes.buffer
}

describe('official cloud audio point estimates', () => {
  it('matches the server proportional TTS and ASR rules', () => {
    const primary = { minimumBasePoints: 1, pointsPerMinute: 35, voicePointSurcharge: 0 }
    expect(estimateOfficialCloudTtsPoints(10_000, primary)).toBe(6)
    expect(estimateOfficialCloudTtsPoints(35_000, { ...primary, voicePointSurcharge: 7 })).toBe(28)
    expect(estimateOfficialCloudTtsPoints(60_000, primary)).toBe(35)
    expect(estimateOfficialCloudTtsPoints(60_001, { ...primary, voicePointSurcharge: 7 })).toBe(43)
    expect(estimateOfficialCloudTtsPoints(10_000, { minimumBasePoints: 4, pointsPerMinute: 12, voicePointSurcharge: 2 })).toBe(6)
    expect(estimateOfficialCloudAsrPoints(60_000)).toBe(25)
    expect(estimateOfficialCloudAsrPoints(60_001)).toBe(45)
    expect(estimateOfficialCloudAsrPoints(120_001, 30, 10)).toBe(50)
    expect(estimateOfficialCloudAsrPoints(1, 0, 0)).toBe(1)
  })

  it('reads duration from server-supported integer PCM WAV audio', async () => {
    await expect(getOfficialCloudPcmWavDurationMs(wav(90_000))).resolves.toBe(90_000)
  })

  it('returns unavailable for WAV codecs the server rejects', async () => {
    await expect(getOfficialCloudPcmWavDurationMs(wav(1000, 3))).resolves.toBeUndefined()
    await expect(getOfficialCloudPcmWavDurationMs(new Uint8Array([1, 2, 3]).buffer)).resolves.toBeUndefined()
  })
})
