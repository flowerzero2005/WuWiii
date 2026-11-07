const webglErrorPattern = /webgl|context lost|context creation/i
const mocErrorPattern = /expected exactly one moc file/i
const textureErrorPattern = /textures not found|texture|cannot find file/i
const zipErrorPattern = /end of data|corrupt|invalid zip|can't find end of central directory/i
const jsonErrorPattern = /json|syntaxerror/i

export function displayModelErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  if (webglErrorPattern.test(detail))
    return '图形渲染不可用。请关闭其他占用图形资源的应用后重试。'
  if (mocErrorPattern.test(detail))
    return '压缩包需要包含一个 Live2D 模型文件（.moc3）。'
  if (textureErrorPattern.test(detail))
    return '模型引用的贴图或其他文件缺失，请检查压缩包是否完整。'
  if (zipErrorPattern.test(detail))
    return '压缩包损坏或不是 ZIP 文件，请重新导出后导入。'
  if (jsonErrorPattern.test(detail))
    return '模型配置文件无法读取，请检查 model3.json。'
  return detail || '无法读取模型文件，请重新选择后重试。'
}
