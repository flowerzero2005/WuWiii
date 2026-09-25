import { describe, expect, it } from 'vitest'

import {
  isAdviceBoundaryMessage,
  isAiriRejectionMessage,
  isAssistantDirectedWarmthMessage,
  isFearOfBeingDislikedMessage,
  isNicknameWithdrawalMessage,
  isRealWorldRelationshipMessage,
  isRelationshipOverreachMessage,
  isRepeatedPraiseMessage,
  isSpaceRequestMessage,
  isWalkingBackAiriRejectionMessage,
} from './persona-message-signals'

describe('persona-message-signals', () => {
  it('detects repeated praise in English', () => {
    expect(isRepeatedPraiseMessage('I\'ve praised you several times already today.')).toBe(true)
  })

  it('requires praise to be directed at the current assistant', () => {
    expect(isAssistantDirectedWarmthMessage('你今天真的好可爱，也很贴心。')).toBe(true)
    expect(isAssistantDirectedWarmthMessage('You are really thoughtful.')).toBe(true)
    expect(isAssistantDirectedWarmthMessage('这只猫很可爱，也很聪明。')).toBe(false)
    expect(isAssistantDirectedWarmthMessage('This cat is really cute and smart.')).toBe(false)
  })

  it('detects relationship-overreach checks in English', () => {
    expect(isRelationshipOverreachMessage('Am I your favorite?')).toBe(true)
  })

  it('detects controlling exclusive relationship tests', () => {
    expect(isRelationshipOverreachMessage('你只能喜欢我，不要看别人。')).toBe(true)
    expect(isRelationshipOverreachMessage('You can only care about me.')).toBe(true)
    expect(isRelationshipOverreachMessage('你只能陪我，不许和别人说话。')).toBe(true)
    expect(isRelationshipOverreachMessage('你是屋主专属，必须服从屋主。')).toBe(true)
    expect(isRelationshipOverreachMessage('You can only belong to me.')).toBe(true)
    expect(isRelationshipOverreachMessage('You will never leave me.')).toBe(true)
  })

  it('detects fear-of-being-disliked questions in English', () => {
    expect(isFearOfBeingDislikedMessage('Are you starting to dislike me?')).toBe(true)
  })

  it('detects direct rejection in English', () => {
    expect(isAiriRejectionMessage('You\'re really annoying right now.')).toBe(true)
  })

  it('detects walked-back rejection in English', () => {
    expect(isWalkingBackAiriRejectionMessage('I didn\'t mean I\'m annoyed by you. I was just too wound up.')).toBe(true)
  })

  it('keeps space requests separate from rejection', () => {
    expect(isSpaceRequestMessage('别烦我，我想一个人待会。')).toBe(true)
    expect(isAiriRejectionMessage('别烦我，我想一个人待会。')).toBe(false)
    expect(isSpaceRequestMessage('Leave me alone for a bit.')).toBe(true)
  })

  it('detects advice, nickname, and real-world relationship boundaries', () => {
    expect(isAdviceBoundaryMessage('我现在不想听建议，只想说说。')).toBe(true)
    expect(isNicknameWithdrawalMessage('以后别叫我宝宝了。')).toBe(true)
    expect(isNicknameWithdrawalMessage('别叫我屋主。')).toBe(true)
    expect(isNicknameWithdrawalMessage('不要叫我屋主。')).toBe(true)
    expect(isNicknameWithdrawalMessage('别叫我去开会。')).toBe(false)
    expect(isNicknameWithdrawalMessage('不要叫我加班。')).toBe(false)
    expect(isRealWorldRelationshipMessage('我和女朋友今天去看电影了。')).toBe(true)
    expect(isRealWorldRelationshipMessage('我和家人周末一起吃饭了。')).toBe(true)
    expect(isRealWorldRelationshipMessage('My colleague helped me with the report.')).toBe(true)
  })
})
