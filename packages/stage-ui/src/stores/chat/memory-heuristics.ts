export interface HeuristicRule {
  pattern: RegExp
  importance: 'low' | 'medium' | 'high'
  tags: string[]
  description: string
}

const MEMORY_RULES: HeuristicRule[] = [
  // 高优先级规则 - 个人信息
  {
    pattern: /我([叫是姓]|名字是|的名字是)\s*(.+)/,
    importance: 'high',
    tags: ['个人信息', '姓名'],
    description: '用户告知姓名',
  },
  {
    pattern: /我(喜欢|爱|最爱|偏好|喜爱)\s*(.+)/,
    importance: 'high',
    tags: ['偏好', '兴趣'],
    description: '用户偏好',
  },
  {
    pattern: /我(不喜欢|讨厌|不爱|反感)\s*(.+)/,
    importance: 'high',
    tags: ['偏好', '厌恶'],
    description: '用户厌恶',
  },
  {
    pattern: /记住|别忘了|一定要记得|帮我记一下|记下来/,
    importance: 'high',
    tags: ['明确要求'],
    description: '用户明确要求记住',
  },
  {
    pattern: /生日|出生|年龄|岁/,
    importance: 'high',
    tags: ['个人信息', '生日'],
    description: '生日年龄信息',
  },
  {
    pattern: /电话|手机|联系方式|邮箱|email/i,
    importance: 'high',
    tags: ['个人信息', '联系方式'],
    description: '联系方式',
  },
  {
    pattern: /我是.*(男生|女生|男性|女性)/,
    importance: 'high',
    tags: ['个人信息', '性别'],
    description: '性别信息',
  },

  // 中优先级规则 - 背景信息
  {
    pattern: /我(?:住在|在|来自|老家是)\s*\S+(?:[市省国]|地区)/,
    importance: 'medium',
    tags: ['个人信息', '地理位置'],
    description: '居住地信息',
  },
  {
    pattern: /我(?:[在是做]|从事)\s*\S+(?:工作|职业|公司|行业)/,
    importance: 'medium',
    tags: ['个人信息', '职业'],
    description: '职业信息',
  },
  {
    pattern: /我(?:[学读在是]|毕业于|就读)\s*\S+(?:大学|学校|专业|学院)/,
    importance: 'medium',
    tags: ['个人信息', '教育'],
    description: '教育背景',
  },
  {
    pattern: /明天|下周|下个月|下次|计划|打算|准备/,
    importance: 'medium',
    tags: ['计划', '未来事件'],
    description: '未来计划',
  },
  {
    pattern: /提醒我|别忘了提醒|到时候叫我/,
    importance: 'medium',
    tags: ['任务', '提醒'],
    description: '提醒请求',
  },

  // 低优先级规则 - 临时状态
  {
    pattern: /今天|刚才|现在|此刻/,
    importance: 'low',
    tags: ['当前状态'],
    description: '当前状态描述',
  },
  {
    pattern: /天气|温度|气温/,
    importance: 'low',
    tags: ['环境'],
    description: '天气相关',
  },
]

export interface MemoryAnalysisResult {
  shouldRemember: boolean
  importance: 'low' | 'medium' | 'high'
  matchedRules: HeuristicRule[]
  summary: string
  tags: string[]
}

export function analyzeMessageImportance(message: string): MemoryAnalysisResult {
  const matchedRules: HeuristicRule[] = []

  for (const rule of MEMORY_RULES) {
    if (rule.pattern.test(message)) {
      matchedRules.push(rule)
    }
  }

  if (matchedRules.length === 0) {
    return {
      shouldRemember: false,
      importance: 'low',
      matchedRules: [],
      summary: '',
      tags: [],
    }
  }

  // 取最高优先级
  const highestImportance = matchedRules.some(r => r.importance === 'high')
    ? 'high'
    : matchedRules.some(r => r.importance === 'medium')
      ? 'medium'
      : 'low'

  // 合并标签，去重
  const tags = [...new Set(matchedRules.flatMap(r => r.tags))]

  // 生成摘要（截取前100字，保留完整词语）
  let summary = message
  if (message.length > 100) {
    // 在100字附近找到合适的断点（标点或空格）
    const truncated = message.slice(0, 100)
    const lastPunctuation = Math.max(
      truncated.lastIndexOf('。'),
      truncated.lastIndexOf('，'),
      truncated.lastIndexOf('！'),
      truncated.lastIndexOf('？'),
      truncated.lastIndexOf(' '),
    )
    summary = lastPunctuation > 50 ? truncated.slice(0, lastPunctuation + 1) : `${truncated}...`
  }

  return {
    shouldRemember: highestImportance !== 'low',
    importance: highestImportance,
    matchedRules,
    summary,
    tags,
  }
}
