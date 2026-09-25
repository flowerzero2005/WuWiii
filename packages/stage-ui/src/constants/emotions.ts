import { Emotion } from '@proj-airi/stage-shared/emotions'

export {
  Emotion,
  EMOTION_EmotionMotionName_value,
  EMOTION_VALUES,
  EmotionAngryMotionName,
  EmotionAwkwardMotionName,
  EmotionCuriousMotionName,
  EmotionHappyMotionName,
  EmotionNeutralMotionName,
  EmotionQuestionMotionName,
  EmotionSadMotionName,
  EmotionSurpriseMotionName,
  EmotionThinkMotionName,
} from '@proj-airi/stage-shared/emotions'

export type { EmotionPayload } from '@proj-airi/stage-shared/emotions'

export const EMOTION_VRMExpressionName_value = {
  [Emotion.Happy]: 'happy',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: 'think',
  [Emotion.Surprise]: 'surprised',
  [Emotion.Awkward]: 'neutral',
  [Emotion.Question]: 'think',
  [Emotion.Neutral]: 'neutral',
  [Emotion.Curious]: 'think',
} satisfies Record<Emotion, string | undefined>
