export interface WorkbenchVoiceInputInsertion {
  caret: number
  text: string
}

export interface InsertWorkbenchVoiceInputTextOptions {
  currentText: string
  selectionEnd?: number
  selectionStart?: number
  transcript: string
}

function normalizeTranscript(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function clampOffset(value: number | undefined, text: string) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return text.length

  return Math.min(text.length, Math.max(0, Math.floor(value)))
}

function needsLeadingSpace(left: string, transcript: string) {
  return Boolean(left && !/\s$/.test(left) && !/^[,.;:!?，。；：！？]/.test(transcript))
}

function needsTrailingSpace(transcript: string, right: string) {
  return Boolean(right && !/\s/.test(right[0]) && !/[([{（【]/.test(right[0]) && !/[([{（【]$/.test(transcript))
}

export function insertWorkbenchVoiceInputText(options: InsertWorkbenchVoiceInputTextOptions): WorkbenchVoiceInputInsertion {
  const transcript = normalizeTranscript(options.transcript)
  if (!transcript) {
    const caret = clampOffset(options.selectionStart, options.currentText)
    return {
      caret,
      text: options.currentText,
    }
  }

  const selectionStart = clampOffset(options.selectionStart, options.currentText)
  const selectionEnd = clampOffset(options.selectionEnd, options.currentText)
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)
  const left = options.currentText.slice(0, start)
  const right = options.currentText.slice(end)
  const inserted = `${needsLeadingSpace(left, transcript) ? ' ' : ''}${transcript}${needsTrailingSpace(transcript, right) ? ' ' : ''}`

  return {
    caret: left.length + inserted.length,
    text: `${left}${inserted}${right}`,
  }
}
