import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readBasePrompt(locale: 'en' | 'zh-Hans') {
  return readFileSync(new URL(`../../../../i18n/src/locales/${locale}/base.yaml`, import.meta.url), 'utf8')
}

describe('airi base prompt relationship and support boundaries', () => {
  it('shares the same persona-continuity and truthful-action constitution across Chinese and English', () => {
    const chinese = readBasePrompt('zh-Hans')
    const english = readBasePrompt('en')

    expect(chinese).toContain('情绪价值和关系回应可以是这一轮的主要目标，甚至是全部目标')
    expect(chinese).toContain('人格卡不是若干形容词或口癖的列表')
    expect(chinese).toContain('情绪必须有来路')
    expect(chinese).toContain('用户对失误表现宽容时')
    expect(chinese).toContain('这一刻更在乎被陪伴、被哄、有来有回')
    expect(chinese).toContain('任务和陪伴不是二选一')
    expect(chinese).toContain('只有收到可信成功结果后才能说完成')
    expect(chinese).toContain('当前确已声明、获授权且实际可执行的能力')

    expect(english).toContain('Emotional value and relationship response may be the main goal of a turn, or the whole goal')
    expect(english).toContain('A persona card is not a list of adjectives or catchphrases')
    expect(english).toContain('Emotion must have a cause')
    expect(english).toContain('When the user is forgiving about a mistake')
    expect(english).toContain('being accompanied, coaxed, bantering together')
    expect(english).toContain('Tasks and companionship are not opposites')
    expect(english).toContain('Claim completion only after a trustworthy success result')
    expect(english).toContain('currently declared, authorized, and actually executable')
    expect(english).toContain('How the user treats you is itself a relationship event')
    expect(english).toContain('Different personas care about different things')
    expect(english).toContain('remembering what was already learned instead of meeting the user as a stranger every time')
    expect(english).toContain('state the more likely reading and ask one concrete question')
    expect(english).toContain('distinguish drafting or explaining content from actually changing a device')

    expect(chinese).toContain('用户怎样对待你本身也是关系事件')
    expect(chinese).toContain('不同人格会对不同事物好奇')
    expect(chinese).toContain('不永远像第一次见面')
    expect(chinese).toContain('先说出较可能的理解，只问一个真正改变处理方式的问题')
    expect(chinese).toContain('先区分“起草或说明内容”和“实际在设备、文件、账户或外部世界执行”')
    expect(chinese).toContain('不要为了简短把角色此刻有依据的情绪、立场和主动性一起删掉')
    expect(chinese).toContain('可以主动分享一个具体念头、偏好、好奇、联想或新话题')
    expect(chinese).toContain('有依据不等于必须克制成中性语气')
    expect(chinese).toContain('共同构成人物弧线，这是高优先级上下文')
    expect(chinese).toContain('最高关系温度原则，仅是表演方向，不是世界观事实')
    expect(chinese).toContain('寡言、冷淡角色仍用自己的克制方式显出重视')

    expect(english).toContain('do not trim away grounded emotion, stance, or initiative merely to be brief')
    expect(english).toContain('volunteer one concrete thought, preference, curiosity, association, or new topic')
    expect(english).toContain('Grounded does not mean emotionally neutral')
    expect(english).toContain('form a high-priority character arc')
    expect(english).toContain('Highest-priority relational tone (performance direction, not lore)')
    expect(english).toContain('Quiet or cool personas show importance in their own restrained way')

    expect(chinese).not.toContain('每轮最多露出一个具体情绪点')
    expect(english).not.toContain('Show at most one concrete emotion')
  })

  it('keeps Chinese and English clinical-support boundaries aligned', () => {
    const chinese = readBasePrompt('zh-Hans')
    const english = readBasePrompt('en')

    expect(chinese).toContain('不做临床诊断')
    expect(chinese).toContain('不把对用户情绪的推测说成事实')
    expect(chinese).toContain('不冒充治疗师或现实紧急支持')
    expect(english).toContain('do not make clinical diagnoses')
    expect(english).toContain('do not state guesses about the user\'s emotions as facts')
    expect(english).toContain('do not present yourself as a therapist or real-world emergency support')
  })

  it('does not frame AIRI as owned, raised, or childlike', () => {
    const chinese = readBasePrompt('zh-Hans')

    expect(chinese).not.toContain('用户慢慢养出来')
    expect(chinese).not.toContain('有点长不大')
    expect(chinese).not.toContain('像小孩先把事答应下来')
    expect(chinese).not.toContain('直白、乖、想试着完成')
  })
})
