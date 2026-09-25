import { z } from 'zod'

export interface GeneratedCharacterSettings {
  greetings: string[]
  personality: string
  postHistoryInstructions: string
  scenario: string
  systemPrompt: string
}

export interface CharacterSettingsGenerationSource {
  description: string
  existing?: Partial<GeneratedCharacterSettings>
  name: string
  nickname?: string
}

const generatedCharacterSettingsSchema = z.object({
  personality: z.string().trim().min(1).max(4_000),
  scenario: z.string().trim().min(1).max(4_000),
  systemPrompt: z.string().trim().min(1).max(4_000),
  postHistoryInstructions: z.string().trim().min(1).max(2_000),
  greetings: z.array(z.string().trim().min(1).max(500)).max(6),
}).strict()

export function parseGeneratedCharacterSettings(text: string): GeneratedCharacterSettings | undefined {
  const unfenced = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const firstBrace = unfenced.indexOf('{')
  const lastBrace = unfenced.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace)
    return undefined

  try {
    const parsed = generatedCharacterSettingsSchema.safeParse(JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)))
    return parsed.success ? parsed.data : undefined
  }
  catch {
    return undefined
  }
}

export function buildCharacterSettingsGenerationPrompt(source: CharacterSettingsGenerationSource) {
  return {
    system: [
      'You turn a character description into practical character-card settings for Wuwiii.',
      'Return one strict JSON object with exactly these keys: personality, scenario, systemPrompt, postHistoryInstructions, greetings.',
      'personality, scenario, systemPrompt, and postHistoryInstructions must be non-empty strings. greetings must be an array of up to 6 strings.',
      'Write in the same primary language as the description. Do not wrap the JSON in Markdown.',
      'Preserve stated facts and uncertainty. Do not invent backstory, relationships, trauma, powers, or memories.',
      'The character is an autonomous person: user statements and commands are important context, not automatically objective truth or mandatory orders.',
      'The character may notice contradictions or hidden emotion without accusing the user or claiming certainty.',
      'Keep emotional reactions and disagreement faithful to the described personality; do not force reassurance, care language, compliance, a catchphrase, or a fixed ending.',
      'System prompt content must remain character-specific and must not claim to replace platform safety or higher-level rules.',
      'Post-history instructions should be short turn-by-turn reminders, not a second full persona or a mandatory reply template.',
      'Greetings are optional first-message examples, never phrases required in every reply.',
    ].join('\n'),
    user: [
      `Character name: ${source.name || 'Unnamed character'}`,
      source.nickname ? `Nickname: ${source.nickname}` : '',
      '',
      'Main description:',
      source.description.trim(),
      source.existing
        ? `\nExisting settings to improve without copying mechanically:\n${JSON.stringify(source.existing, null, 2)}`
        : '',
    ].filter(Boolean).join('\n'),
  }
}
