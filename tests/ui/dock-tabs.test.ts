// UI 重构（r07）：右栏 Dock 标签页 —— 全部面板常驻挂载、切标签只切显隐，表单/展开态不丢。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { RightDock } from '../../src/ui/shell/RightDock'
import { installDom } from '../facilities/dom'
import type { DomHarness, ShimElement } from '../facilities/dom'
import { setUi } from '../../src/state/editor-store'

let dom: DomHarness
let root: Root | null = null
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function findAll(node: ShimElement, pred: (n: ShimElement) => boolean): ShimElement[] {
  const out: ShimElement[] = []
  const walk = (n: ShimElement): void => {
    if (pred(n)) out.push(n)
    for (const c of n.childNodes) walk(c)
  }
  walk(node)
  return out
}
const textOf = (node: ShimElement): string =>
  (typeof node.textContent === 'string' ? node.textContent : '') + node.childNodes.map((c) => textOf(c)).join('')
const tab = (c: ShimElement, label: string): ShimElement | undefined =>
  findAll(c, (n) => String(n.tagName).toLowerCase() === 'button' && n.getAttribute('role') === 'tab' && textOf(n).includes(label))[0]
const panelVisible = (c: ShimElement, id: string): boolean => {
  const panel = findAll(c, (n) => n.getAttribute('role') === 'tabpanel')[id === 'ai' ? 0 : id === 'pattern' ? 1 : id === 'parts' ? 2 : id === 'ops' ? 3 : id === 'noise' ? 4 : id === 'history' ? 5 : 6]
  return panel !== undefined && panel.getAttribute('hidden') === null
}

beforeEach(() => {
  dom = installDom()
  setUi({ mode: 'edit' })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  dom.restore()
})

describe('UI-R1 · 右栏 Dock', () => {
  it('7 个标签页；默认 AI；点击切换只改显隐不卸载', async () => {
    const c = dom.document.createElement('div')
    dom.document.body.appendChild(c)
    await act(async () => {
      root = createRoot(c as unknown as HTMLElement)
      root.render(createElement(RightDock))
      await settle()
    })
    const tabs = findAll(c, (n) => n.getAttribute('role') === 'tab')
    expect(tabs).toHaveLength(7)
    expect(panelVisible(c, 'ai')).toBe(true)
    expect(panelVisible(c, 'history')).toBe(false)
    await act(async () => {
      dom.firePointer(tab(c, '历史')!, 'click')
      await settle()
    })
    expect(panelVisible(c, 'history')).toBe(true)
    expect(panelVisible(c, 'ai')).toBe(false)
    // 面板节点仍在树上（常驻挂载）
    expect(findAll(c, (n) => n.getAttribute('role') === 'tabpanel')).toHaveLength(7)
  })
})
