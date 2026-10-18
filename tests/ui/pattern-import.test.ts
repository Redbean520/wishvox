// UI 冒烟（垫片 DOM）：图纸导入面板挂载 / 展开 / 空态提示 / 识别结果投影到预览文案。
// 不上真浏览器：这里只钉"接线与文案"，识别算法本身由 tests/io/pattern-recognize.test.ts 用合成像素验证。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { PatternImport } from '../../src/ui/PatternImport'
import { resetPatternDraft, usePatternStore } from '../../src/state/pattern-store'
import { setUi } from '../../src/state/editor-store'
import { installDom } from '../facilities/dom'
import type { DomHarness, ShimElement } from '../facilities/dom'

let dom: DomHarness
let root: Root | null = null

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 垫片没有 querySelector / 聚合 textContent：自己遍历 */
function findAllDeep(node: ShimElement, pred: (n: ShimElement) => boolean): ShimElement[] {
  const out: ShimElement[] = []
  const walk = (n: ShimElement): void => {
    if (pred(n)) out.push(n)
    for (const c of n.childNodes) walk(c)
  }
  walk(node)
  return out
}

const textOf = (node: ShimElement): string => {
  const own = typeof node.textContent === 'string' ? node.textContent : ''
  return own + node.childNodes.map((c) => textOf(c)).join('')
}

const findButton = (node: ShimElement, needle: string): ShimElement | undefined =>
  findAllDeep(node, (n) => String(n.tagName).toLowerCase() === 'button' && String(n.textContent ?? '').includes(needle))[0]

async function mount(): Promise<ShimElement> {
  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as unknown as HTMLElement)
    root.render(createElement(PatternImport))
    await settle()
  })
  return container
}

async function expand(c: ShimElement): Promise<void> {
  const head = findAllDeep(c, (n) => String(n.className).split(/\s+/).includes('panel-head'))[0]!
  await act(async () => {
    dom.firePointer(head, 'click')
    await settle()
  })
}

beforeEach(() => {
  dom = installDom()
  setUi({ mode: 'edit' })
  resetPatternDraft()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  dom.restore()
  resetPatternDraft()
})

describe('UI-P1 · 图纸导入面板（接线与空态）', () => {
  it('默认折叠：标题「图纸 → 方块」+ 摘要「未选图纸」', async () => {
    const c = await mount()
    const heads = findAllDeep(c, (n) => String(n.className).split(/\s+/).includes('panel-head'))
    expect(heads).toHaveLength(1)
    expect(String(heads[0]!.getAttribute('title'))).toContain('图纸 → 方块')
    expect(textOf(c)).toContain('未选图纸')
    expect(findAllDeep(c, (n) => String(n.className).split(/\s+/).includes('panel-body'))).toHaveLength(0)
  })

  it('展开：选择图纸 / AI 识别 / 生成方块三个入口都在；无网格时「生成方块」禁用', async () => {
    const c = await mount()
    await expand(c)
    expect(findAllDeep(c, (n) => String(n.className).split(/\s+/).includes('panel-body'))).toHaveLength(1)
    const text = textOf(c)
    expect(text).toContain('选择图纸')
    expect(text).toContain('AI 识别')
    expect(text).toContain('生成方块')
    const apply = findButton(c, '生成方块')
    expect(apply).toBeDefined()
    expect(apply!.getAttribute('disabled')).toBe('')
  })

  it('没选图片就点 AI 识别 ⇒ 明确提示（不出网、不崩）', async () => {
    const c = await mount()
    await expand(c)
    const aiButton = findButton(c, 'AI 识别')
    expect(aiButton).toBeDefined()
    await act(async () => {
      dom.firePointer(aiButton!, 'click')
      await settle()
    })
    expect(usePatternStore.getState().message ?? '').toContain('先选择一张图纸')
  })

  it('识别结果投影到预览文案：2×2 · 2 色 · 空 2 格', async () => {
    const c = await mount()
    act(() => {
      usePatternStore.setState({
        status: 'ready',
        grid: { cols: 2, rows: 2, cells: ['#c0392b', null, '#3b6ea5', null] },
        palette: [
          { hex: '#c0392b', count: 1 },
          { hex: '#3b6ea5', count: 1 },
        ],
        emptyCells: 2,
        message: '本地识别：2×2（把握 100%）',
      })
    })
    await expand(c)
    const text = textOf(c)
    expect(text).toContain('2×2 格')
    expect(text).toContain('2 色')
    expect(text).toContain('空 2 格')
    expect(text).toContain('本地识别：2×2')
  })

  it('检视态：面板仍可打开，但给出「只读」提示（编辑入口灰掉）', async () => {
    setUi({ mode: 'inspect' })
    const c = await mount()
    await expand(c)
    expect(textOf(c)).toContain('检视态只读')
  })
})
