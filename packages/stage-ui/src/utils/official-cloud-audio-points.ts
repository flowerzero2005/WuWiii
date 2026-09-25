import { BlobSource, Input, WAVE } from 'mediabunny'

const SERVER_SUPPORTED_PCM_WAV_CODECS = new Set([
  'pcm-u8',
  'pcm-s16',
  'pcm-s24',
  'pcm-s32',
  'pcm-f32',
])

/** Reads only container/track metadata accepted by the official cloud audio routes. */
export async function getOfficialCloudPcmWavDurationMs(source: Blob | ArrayBuffer) {
  const input = new Input({
    formats: [WAVE],
    source: new BlobSource(source instanceof Blob ? source : new Blob([source])),
  })

  try {
    if (await input.getFormat() !== WAVE)
      return undefined

    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack?.codec || !SERVER_SUPPORTED_PCM_WAV_CODECS.has(audioTrack.codec))
      return undefined

    const durationMs = Math.ceil(await input.computeDuration() * 1000)
    return Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : undefined
  }
  catch {
    return undefined
  }
  finally {
    input.dispose()
  }
}

export function estimateOfficialCloudTtsPoints(
  durationMs: number,
  pricing: { minimumBasePoints: number, pointsPerMinute: number, voicePointSurcharge: number },
) {
  const voicePointSurcharge = Math.max(0, pricing.voicePointSurcharge)
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    return voicePointSurcharge
  return Math.max(pricing.minimumBasePoints, Math.ceil(durationMs * pricing.pointsPerMinute / 60_000)) + voicePointSurcharge
}

export function estimateOfficialCloudAsrPoints(durationMs: number, firstMinutePoints = 25, additionalMinutePoints = 20) {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    return 0
  return Math.max(1, firstMinutePoints + Math.max(0, Math.ceil(durationMs / 60_000) - 1) * additionalMinutePoints)
}
