import { readFileSync } from 'node:fs'

import ts from 'typescript'

import { describe, expect, it } from 'vitest'

const mainEntrypoint = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const mainSourceFile = ts.createSourceFile('index.ts', mainEntrypoint, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function findNode(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
  if (predicate(root))
    return root

  let result: ts.Node | undefined
  root.forEachChild((child) => {
    result ??= findNode(child, predicate)
  })
  return result
}

describe('desktop startup IPC order', () => {
  it('registers renderer bootstrap IPC handlers before creating the main window', () => {
    const mainWindowProvider = mainEntrypoint.slice(
      mainEntrypoint.indexOf('const mainWindow = injeca.provide(\'windows:main\''),
      mainEntrypoint.indexOf('const butlerReminders = injeca.provide(\'modules:butler-reminders\''),
    )

    expect(mainWindowProvider).toContain('dependsOn: {')
    expect(mainWindowProvider).toContain('commandExecution')
    expect(mainWindowProvider).toContain('pluginHost')
  })

  it('opens secondary surfaces after the main runtime handshake without holding its IPC response', () => {
    expect(mainEntrypoint).toContain('void dependsOn.quickChatWindow.openWindow()')
    expect(mainEntrypoint).not.toContain('await dependsOn.quickChatWindow.openWindow()')
    expect(mainEntrypoint).toContain('void butlerWindow.openWindow()')
    expect(mainEntrypoint).not.toContain('setTimeout(() => {\n        void butlerWindow.openWindow()')
  })

  it('creates the packaged startup window and closes it after renderer bootstrap', () => {
    const whenReadyThen = findNode(mainSourceFile, node => ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'then'
      && node.expression.expression.getText(mainSourceFile) === 'app.whenReady()')
    if (!whenReadyThen || !ts.isCallExpression(whenReadyThen))
      throw new Error('app.whenReady().then callback not found')

    const readyCallback = whenReadyThen.arguments[0]
    if (!readyCallback || (!ts.isArrowFunction(readyCallback) && !ts.isFunctionExpression(readyCallback)))
      throw new Error('app.whenReady().then callback is not a function')

    const startupAssignment = findNode(readyCallback, node => ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.left.getText(mainSourceFile) === 'startupWindow'
      && ts.isConditionalExpression(node.right))
    if (!startupAssignment || !ts.isBinaryExpression(startupAssignment) || !ts.isConditionalExpression(startupAssignment.right))
      throw new Error('packaged startup window assignment not found')

    expect(startupAssignment.right.condition.getText(mainSourceFile)).toBe('app.isPackaged')
    expect(startupAssignment.right.whenTrue.getText(mainSourceFile)).toBe('setupStartupWindow()')
    expect(startupAssignment.right.whenFalse.getText(mainSourceFile)).toBe('undefined')

    const bootstrapBinding = findNode(readyCallback, node => ts.isPropertyAssignment(node)
      && node.name.getText(mainSourceFile) === 'onRendererBootstrapVisible')
    if (!bootstrapBinding || !ts.isPropertyAssignment(bootstrapBinding))
      throw new Error('renderer bootstrap callback binding not found')
    expect(bootstrapBinding.initializer.getText(mainSourceFile)).toBe('signalPrelaunchSplashReady')

    const bootstrapSignal = findNode(mainSourceFile, node => ts.isFunctionDeclaration(node)
      && node.name?.text === 'signalPrelaunchSplashReady')
    if (!bootstrapSignal || !ts.isFunctionDeclaration(bootstrapSignal) || !bootstrapSignal.body)
      throw new Error('renderer bootstrap signal handler not found')
    expect(bootstrapSignal.body.getText(mainSourceFile)).toContain('startupWindow?.close()')
  })
})
