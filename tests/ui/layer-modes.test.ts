// `D4`（design §8，2026-10-16）：三档互斥单选 + 当前档 accent 填充强调 + 默认「显示全部」+
// 收起态摘要仍可辨当前档。走**真实 `LayerPanel`**（不是复刻一段逻辑）：强调是呈现判据，只能在 DOM 上读。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { getEditor } from '../../src/app/runtime'
import { LayerPanel } from '../../src/ui/LayerPanel'
import { setUi, useEditorUi } from '../../src/state/editor-store'
import { installDom } from '../facilities/dom'
import type { DomHarness, ShimElement } from '../facilities/dom'

let dom: DomHarness
let root: Root | null = null

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function findAll(node: ShimElement, cls: string): ShimElement[] {
  const out: ShimElement[] = []
  const walk = (n: ShimElement): void => {
    if (String(n.className ?? '').split(/\s+/).includes(cls)) out.push(n)
    for (const c of n.childNodes) walk(c)
  }
  walk(node)
  return out
}

function findByRole(node: ShimElement): ShimElement[] {
  const out: ShimElement[] = []
  const walk = (n: ShimElement): void => {
    if (n.getAttribute('role') === 'radio') out.push(n)
    for (const c of n.childNodes) walk(c)
  }
  walk(node)
  return out
}

/** 递归取文本：垫片里"单文本子节点"由 React 写成 `textContent`，多子节点则没有 ⇒ 两种都要收 */
const text = (els: ShimElement[]): string => els.map((e) => String(e.textContent ?? '')).join('')

async function mountPanel(): Promise<ShimElement> {
  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as unknown as HTMLElement)
    root.render(createElement(LayerPanel))
    await settle()
  })
  return container
}

beforeEach(() => {
  dom = installDom()
  setUi({
    layerMode: 'all',
    layerY: 2,
    layerMinY: 0,
    layerMaxY: 4,
    perLayerCounts: [
      { y: 0, count: 3 },
      { y: 2, count: 2 },
      { y: 4, count: 1 },
    ],
    nonEmpty: 6,
    gridBase: false,
    gridLayer: false,
    workGridY: 0,
    refGridY: 0,
    followLayerWork: false,
    followLayerRef: false,
    mode: 'edit',
    message: null,
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  dom.restore()
})

describe('D4-① 三档互斥单选 + accent 填充强调', () => {
  it('三档都在、恰一个 aria-checked=true，且当前档用 accent 填充 + 深色文字', async () => {
    const c = await mountPanel()
    const radios = findByRole(c)
    expect(radios).toHaveLength(3)
    expect(text(radios)).toContain('显示全部')
    expect(text(radios)).toContain('渲染以下')
    expect(text(radios)).toContain('渲染单层')
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(String(checked[0]!.textContent)).toContain('显示全部') // 默认档 = 显示全部（D4 用户确认）
    expect(String(checked[0]!.style.background)).toContain('--accent')
    expect(String(checked[0]!.style.color)).toBe('#0f1218')
    // 非当前档弱化：不设 accent 背景（走普通灰底按钮）
    for (const r of radios) {
      if (r.getAttribute('aria-checked') === 'true') continue
      expect(String(r.style.background ?? '')).not.toContain('--accent')
    }
  })

  it('点「渲染以下」⇒ 强调转移、store 切档、非当前档不再填充（互斥）', async () => {
    const c = await mountPanel()
    const below = findByRole(c).find((r) => String(r.textContent).includes('渲染以下'))!
    await act(async () => {
      dom.firePointer(below, 'click')
      await settle()
    })
    expect(useEditorUi.getState().layerMode).toBe('below')
    const checked = findByRole(c).filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(String(checked[0]!.textContent)).toContain('渲染以下')
    expect(String(checked[0]!.style.background)).toContain('--accent')
  })

  it('强调只改呈现：切档不改模型块数与历史长度', async () => {
    const ed = getEditor()
    const before = ed.volume.nonEmptyCount
    const patches = ed.log.patches.length
    const c = await mountPanel()
    const single = findByRole(c).find((r) => String(r.textContent).includes('渲染单层'))!
    await act(async () => {
      dom.firePointer(single, 'click')
      await settle()
    })
    expect(ed.volume.nonEmptyCount).toBe(before)
    expect(ed.log.patches.length).toBe(patches)
    expect(useEditorUi.getState().layerMode).toBe('single')
  })
})

describe('D4-② 面板顶部摘要仍可辨当前档（r07：Dock 内为常显摘要行）', () => {
  it('摘要含当前档「显示全部」', async () => {
    const c = await mountPanel()
    expect(text(findAll(c, 'pane-summary'))).toContain('显示全部')
  })

  it('切到「以下 / 单层」后摘要随之改口径（含档位字样与实际 y）', async () => {
    const c = await mountPanel()
    await act(async () => {
      setUi({ layerMode: 'below' })
      await settle()
    })
    expect(text(findAll(c, 'pane-summary'))).toContain('以下')
    await act(async () => {
      setUi({ layerMode: 'single' })
      await settle()
    })
    expect(text(findAll(c, 'pane-summary'))).toContain('单层')
    expect(text(findAll(c, 'pane-summary'))).toContain('y=2')
  })
})

describe('D4-③ 默认档 = 显示全部（初始进入即当前档填充强调可见）', () => {
  it('store 模块默认值 = all（不是 below）', () => {
    expect(useEditorUi.getInitialState().layerMode).toBe('all')
  })
})