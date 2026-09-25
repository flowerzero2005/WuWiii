import { generateSpeech } from '@xsai/generate-speech'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateConfiguredSpeech, isAlibabaModelStudioCosyVoiceSpeechModel, isAlibabaModelStudioQwenSpeechModel } from './speech-generation'

vi.mock('@xsai/generate-speech', () => ({
  generateSpeech: vi.fn(),
}))

const runtime = globalThis as typeof globalThis & {
  __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
}

function bytesToBase64(bytes: number[]) {
  return globalThis.btoa(String.fromCharCode(...bytes))
}

function createWavBytes(pcmBytes = [0, 0, 255, 255], sampleRate = 24000) {
  const headerSize = 44
  const wav = new Uint8Array(headerSize + pcmBytes.length)
  const view = new DataView(wav.buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes.length, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, pcmBytes.length, true)
  wav.set(pcmBytes, headerSize)

  return wav
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

describe('speech-generation', () => {
  afterEach(() => {
    delete runtime.__AIRI_ELECTRON_FETCH_PROXY__
    vi.restoreAllMocks()
  })

  it('detects Alibaba Qwen TTS model ids', () => {
    expect(isAlibabaModelStudioQwenSpeechModel('qwen3-tts-vc-2026-01-22')).toBe(true)
    expect(isAlibabaModelStudioQwenSpeechModel('qwen3-tts-instruct-flash')).toBe(true)
    expect(isAlibabaModelStudioQwenSpeechModel('cosyvoice-v3.5-plus')).toBe(false)
    expect(isAlibabaModelStudioQwenSpeechModel('MiniMax/speech-02-hd')).toBe(false)
  })

  it('detects Alibaba CosyVoice model ids', () => {
    expect(isAlibabaModelStudioCosyVoiceSpeechModel('cosyvoice-v3.5-plus')).toBe(true)
    expect(isAlibabaModelStudioCosyVoiceSpeechModel('CosyVoice-V2')).toBe(true)
    expect(isAlibabaModelStudioCosyVoiceSpeechModel('qwen3-tts-flash')).toBe(false)
  })

  it('sends Alibaba Qwen cloned voice synthesis through DashScope generation API', async () => {
    const provider = {
      speech: vi.fn(),
    }
    const wavBytes = createWavBytes()
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes('/services/aigc/multimodal-generation/generation')) {
        return new Response(JSON.stringify({
          output: {
            audio: {
              data: bytesToBase64([0, 0, 1, 0]),
              url: 'https://audio.example/qwen.wav',
            },
          },
        }))
      }

      if (String(url) === 'https://audio.example/qwen.wav') {
        return new Response(wavBytes)
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`)
    }) as unknown as typeof fetch

    runtime.__AIRI_ELECTRON_FETCH_PROXY__ = fetchMock

    const audio = await generateConfiguredSpeech({
      providerId: 'alibaba-cloud-model-studio',
      provider,
      providerConfig: {
        apiKey: 'test-api-key',
        baseUrl: 'https://unspeech.hyp3r.link/v1/',
        languageType: 'zh-CN',
      },
      model: 'qwen3-tts-vc-2026-01-22',
      input: '你好，我是 AIRI。',
      voice: 'voice-clone-id',
    })

    expect(provider.speech).not.toHaveBeenCalled()
    expect(new Uint8Array(audio)).toEqual(wavBytes)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
      }),
    )

    const firstRequest = vi.mocked(fetchMock).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(firstRequest.body))).toEqual({
      model: 'qwen3-tts-vc-2026-01-22',
      input: {
        text: '你好，我是 AIRI。',
        voice: 'voice-clone-id',
        language_type: 'Chinese',
      },
    })
  })

  it('sends Alibaba CosyVoice synthesis through DashScope SpeechSynthesizer API', async () => {
    const provider = {
      speech: vi.fn(),
    }
    const wavBytes = createWavBytes()
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes('/services/audio/tts/SpeechSynthesizer')) {
        return new Response(JSON.stringify({
          output: {
            audio: {
              url: 'https://audio.example/cosyvoice.wav',
            },
          },
        }))
      }

      if (String(url) === 'https://audio.example/cosyvoice.wav') {
        return new Response(wavBytes, {
          headers: {
            'content-type': 'audio/wav',
          },
        })
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`)
    }) as unknown as typeof fetch

    runtime.__AIRI_ELECTRON_FETCH_PROXY__ = fetchMock

    const audio = await generateConfiguredSpeech({
      providerId: 'alibaba-cloud-model-studio',
      provider,
      providerConfig: {
        apiKey: 'test-api-key',
        baseUrl: 'https://unspeech.hyp3r.link/v1/',
      },
      model: 'cosyvoice-v3.5-plus',
      input: '你好，我是 AIRI。',
      voice: 'longxiaochun',
    })

    expect(provider.speech).not.toHaveBeenCalled()
    expect(new Uint8Array(audio)).toEqual(wavBytes)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        }),
      }),
    )

    const firstRequest = vi.mocked(fetchMock).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(firstRequest.body))).toEqual({
      model: 'cosyvoice-v3.5-plus',
      input: {
        text: '你好，我是 AIRI。',
        voice: 'longxiaochun',
        format: 'wav',
        sample_rate: 24000,
      },
    })
  })

  it('maps MiniMax volume and pitch percentages to provider-native values', async () => {
    const provider = { speech: vi.fn() }
    const wavBytes = createWavBytes()
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/services/aigc/multimodal-generation/generation')) {
        return new Response(JSON.stringify({
          output: {
            base_resp: { status_code: 0 },
            data: { url: 'https://audio.example/minimax.wav' },
          },
        }))
      }

      if (String(url) === 'https://audio.example/minimax.wav')
        return new Response(wavBytes, { headers: { 'content-type': 'audio/wav' } })

      throw new Error(`Unexpected fetch URL: ${String(url)}`)
    }) as unknown as typeof fetch
    runtime.__AIRI_ELECTRON_FETCH_PROXY__ = fetchMock

    await generateConfiguredSpeech({
      providerId: 'alibaba-cloud-model-studio',
      provider,
      providerConfig: { apiKey: 'test-api-key', volume: 0, pitch: 10 },
      model: 'MiniMax/speech-02-hd',
      input: '你好。',
      voice: 'voice-id',
    })

    const request = vi.mocked(fetchMock).mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body)).input.voice_setting).toMatchObject({ vol: 1, pitch: 1 })
  })

  it('wraps Alibaba CosyVoice PCM URL audio as WAV when PCM format is configured', async () => {
    const provider = {
      speech: vi.fn(),
    }
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes('/services/audio/tts/SpeechSynthesizer')) {
        return new Response(JSON.stringify({
          output: {
            audio: {
              url: 'https://audio.example/cosyvoice.pcm',
            },
          },
        }))
      }

      if (String(url) === 'https://audio.example/cosyvoice.pcm') {
        return new Response(new Uint8Array([0, 0, 255, 255]), {
          headers: {
            'content-type': 'application/octet-stream',
          },
        })
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`)
    }) as unknown as typeof fetch

    runtime.__AIRI_ELECTRON_FETCH_PROXY__ = fetchMock

    const audio = await generateConfiguredSpeech({
      providerId: 'alibaba-cloud-model-studio',
      provider,
      providerConfig: {
        apiKey: 'test-api-key',
        format: 'pcm',
        sampleRate: 16000,
      },
      model: 'cosyvoice-v3.5-plus',
      input: '你好，我是 AIRI。',
      voice: 'longxiaochun',
    })

    const bytes = new Uint8Array(audio)
    const header = String.fromCharCode(...bytes.slice(0, 12))
    expect(header.startsWith('RIFF')).toBe(true)
    expect(header.includes('WAVE')).toBe(true)
    expect(new DataView(audio).getUint32(24, true)).toBe(16000)
    expect(audio.byteLength).toBe(48)
  })

  it('rejects empty speech audio from compatible providers', async () => {
    vi.mocked(generateSpeech).mockResolvedValueOnce(new ArrayBuffer(0))

    await expect(generateConfiguredSpeech({
      providerId: 'openai-audio-speech',
      provider: {
        speech: vi.fn(() => ({
          baseURL: 'https://api.example/v1/',
          model: 'tts-1',
        })),
      },
      providerConfig: {},
      model: 'tts-1',
      input: '你好，我是 AIRI。',
      voice: 'alloy',
    })).rejects.toThrow('Received openai-audio-speech speech audio is empty.')
  })

  it('merges private per-request headers into compatible speech requests', async () => {
    const wav = createWavBytes().buffer
    vi.mocked(generateSpeech).mockResolvedValueOnce(wav)

    await generateConfiguredSpeech({
      providerId: 'official-cloud-speech',
      provider: {
        speech: vi.fn(() => ({
          baseURL: 'https://api.example/v1/',
          headers: { 'x-existing': 'kept' },
          model: 'airi-speech',
        })),
      },
      providerConfig: {},
      model: 'airi-speech',
      requestHeaders: { 'x-airi-speech-turn-id': 'turn-1' },
      input: 'hello',
      voice: 'airi-default',
    })

    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      headers: {
        'x-airi-speech-turn-id': 'turn-1',
        'x-existing': 'kept',
      },
    }))
  })

  it('rejects non-audio payloads downloaded from Alibaba Qwen audio URLs', async () => {
    const provider = {
      speech: vi.fn(),
    }
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes('/services/aigc/multimodal-generation/generation')) {
        return new Response(JSON.stringify({
          output: {
            audio: {
              url: 'https://audio.example/qwen.wav',
            },
          },
        }))
      }

      if (String(url) === 'https://audio.example/qwen.wav') {
        return new Response(JSON.stringify({ message: 'audio url expired' }), {
          headers: {
            'content-type': 'application/json',
          },
        })
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`)
    }) as unknown as typeof fetch

    runtime.__AIRI_ELECTRON_FETCH_PROXY__ = fetchMock

    await expect(generateConfiguredSpeech({
      providerId: 'alibaba-cloud-model-studio',
      provider,
      providerConfig: {
        apiKey: 'test-api-key',
      },
      model: 'qwen3-tts-vc-2026-01-22',
      input: '你好，我是 AIRI。',
      voice: 'voice-clone-id',
    })).rejects.toThrow('Received Alibaba Model Studio Qwen audio is not audio')
  })

  it('wraps Alibaba Qwen data-only PCM audio as WAV', async () => {
    const provider = {
      speech: vi.fn(),
    }
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes('/services/aigc/multimodal-generation/generation')) {
        return new Response(JSON.stringify({
          output: {
            audio: {
              data: bytesToBase64([0, 0, 255, 255]),
            },
          },
        }))
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`)
    }) as unknown as typeof fetch

    runtime.__AIRI_ELECTRON_FETCH_PROXY__ = fetchMock

    const audio = await generateConfiguredSpeech({
      providerId: 'alibaba-cloud-model-studio',
      provider,
      providerConfig: {
        apiKey: 'test-api-key',
      },
      model: 'qwen3-tts-vc-2026-01-22',
      input: '你好，我是 AIRI。',
      voice: 'voice-clone-id',
    })

    const header = String.fromCharCode(...new Uint8Array(audio.slice(0, 12)))
    expect(header.startsWith('RIFF')).toBe(true)
    expect(header.includes('WAVE')).toBe(true)
    expect(audio.byteLength).toBe(48)
  })
})
