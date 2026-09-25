let ringtoneContext: AudioContext | undefined
let ringtoneTimer: ReturnType<typeof setInterval> | undefined

function playPulse(context: AudioContext, volume: number) {
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(1, volume) * 0.12), context.currentTime + 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.72)
  gain.connect(context.destination)

  for (const [frequency, delay] of [[440, 0], [554.37, 0.18]] as const) {
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + delay)
    oscillator.connect(gain)
    oscillator.start(context.currentTime + delay)
    oscillator.stop(context.currentTime + delay + 0.48)
  }
}

export async function startVoiceCallRingtone(volume: number) {
  stopVoiceCallRingtone()
  if (volume <= 0)
    return false

  const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor)
    return false

  ringtoneContext = new AudioContextConstructor()
  await ringtoneContext.resume()
  playPulse(ringtoneContext, volume)
  ringtoneTimer = setInterval(() => ringtoneContext && playPulse(ringtoneContext, volume), 2200)
  return true
}

export function stopVoiceCallRingtone() {
  if (ringtoneTimer)
    clearInterval(ringtoneTimer)
  ringtoneTimer = undefined
  void ringtoneContext?.close().catch(() => undefined)
  ringtoneContext = undefined
}
