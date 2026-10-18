// 验证设施：**最小 DOM 垫片**（无 jsdom 依赖——项目 `vitest` 为 `environment: 'node'`，明文不引 DOM 库）。
// 为什么需要它：`A-07` 的两条缺陷（`R-01` 视窗外收尾 / `R-02` Esc 幽灵数据）都落在
// `src/ui/Viewport.tsx` 的**指针事件族**上，而既有 `tests/interaction/stroke-interrupt.test.ts` 只覆盖
// `Editor` 状态机、覆盖不到事件接线（原交付件 §10 已声明这条反证缺口）。
// 本垫片只实现 `Viewport` 挂载与事件派发实际用到的那一小块 DOM 面：
//   Element（listener / 冒泡 / pointer capture / 矩形 / 子节点）· document.createElement ·
//   ResizeObserver（空实现）· canvas.getContext（空壳）。
// **不是**通用 DOM 实现；缺口按需补，不追求兼容。
import { vi } from 'vitest'

const NODE_ELEMENT = 1
const NODE_TEXT = 3

class ShimEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly cancelable: boolean
  defaultPrevented = false
  target: ShimElement | null = null
  currentTarget: ShimElement | null = null
  readonly button: number
  readonly buttons: number
  readonly clientX: number
  readonly clientY: number
  readonly pointerId: number
  readonly key: string
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type
    this.bubbles = init.bubbles === true
    this.cancelable = init.cancelable === true
    this.button = typeof init.button === 'number' ? init.button : 0
    this.buttons = typeof init.buttons === 'number' ? init.buttons : 0
    this.clientX = typeof init.clientX === 'number' ? init.clientX : 0
    this.clientY = typeof init.clientY === 'number' ? init.clientY : 0
    this.pointerId = typeof init.pointerId === 'number' ? init.pointerId : 1
    this.key = typeof init.key === 'string' ? init.key : ''
  }

  preventDefault(): void {
    this.defaultPrevented = true
  }

  stopPropagation(): void {
    this.stopped = true
  }

  stopped = false
}

/** 元素垫片（导出为**值**：`vi.mock` 工厂与用例都要用它做类型与 instanceof） */
export class ShimElement {
  readonly nodeType: number = NODE_ELEMENT
  readonly childNodes: ShimElement[] = []
  /** `<select>` 挂载时 react-dom 会读 `node.options` / 写 `node.multiple`——垫片给最小可写面 */
  options: unknown[] = []
  multiple = false
  readonly style: Record<string, string> = {}
  readonly dataset: Record<string, string> = {}
  parentNode: ShimElement | null = null
  ownerDocument: ShimDocument | null = null
  id = ''
  className = ''
  textContent: string | null = null
  /** React DOM 的 host context 读它（`getRootHostContext` / `getChildHostContext`） */
  tagName = 'DIV'
  private listenerMap = new Map<string, Array<(this: ShimElement, e: ShimEvent) => void>>()
  private readonly attrs = new Map<string, string>()
  private readonly rect: { left: number; top: number; width: number; height: number } = { left: 0, top: 0, width: 800, height: 600 }
  private readonly captured = new Set<number>()

  get firstChild(): ShimElement | null {
    return this.childNodes[0] ?? null
  }

  appendChild(child: ShimElement): ShimElement {
    child.parentNode = this
    child.ownerDocument = this.ownerDocument
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: ShimElement, before: ShimElement | null): ShimElement {
    const i = before ? this.childNodes.indexOf(before) : -1
    child.parentNode = this
    child.ownerDocument = this.ownerDocument
    if (i < 0) this.childNodes.push(child)
    else this.childNodes.splice(i, 0, child)
    return child
  }

  removeChild(child: ShimElement): ShimElement {
    const i = this.childNodes.indexOf(child)
    if (i >= 0) this.childNodes.splice(i, 1)
    child.parentNode = null
    return child
  }

  contains(node: ShimElement): boolean {
    if (node === this) return true
    return this.childNodes.some((c) => c.contains(node))
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
    if (name === 'class') this.className = value
    else if (name === 'id') this.id = value
    else if (name === 'style') this.style.cssText = value
    else this.dataset[name] = value
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name)
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name)
    if (name === 'class') this.className = ''
    else if (name === 'id') this.id = ''
    else if (name === 'style') this.style.cssText = ''
    else delete this.dataset[name]
  }

  setAttributeNS(_ns: string | null, name: string, value: string): void {
    this.setAttribute(name, value)
  }

  getAttributeNS(_ns: string | null, name: string): string | null {
    return this.getAttribute(name)
  }

  removeAttributeNS(_ns: string | null, name: string): void {
    this.removeAttribute(name)
  }

  addEventListener(type: string, fn: (this: ShimElement, e: ShimEvent) => void): void {
    const list = this.listenerMap.get(type) ?? []
    list.push(fn)
    this.listenerMap.set(type, list)
  }

  removeEventListener(type: string, fn: (e: ShimEvent) => void): void {
    const list = this.listenerMap.get(type)
    if (!list) return
    const i = list.indexOf(fn as (this: ShimElement, e: ShimEvent) => void)
    if (i >= 0) list.splice(i, 1)
  }

  /** 事件派发：**目标 → 祖先 → window**（DOM 冒泡序）；同元素同类型多个 listener 按注册序 */
  dispatch(event: ShimEvent): void {
    event.target = this
    for (const node of this.pathFromTarget()) {
      if (event.stopped) break
      event.currentTarget = node
      for (const fn of [...(node.listenerMap.get(event.type) ?? [])]) fn.call(node, event)
    }
    event.currentTarget = null
  }

  /** 事件矩形（可被用例改写：`setRect`） */
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number; x: number; y: number } {
    const { left, top, width, height } = this.rect
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
  }

  setRect(rect: { left?: number; top?: number; width?: number; height?: number }): void {
    if (rect.left !== undefined) this.rect.left = rect.left
    if (rect.top !== undefined) this.rect.top = rect.top
    if (rect.width !== undefined) this.rect.width = rect.width
    if (rect.height !== undefined) this.rect.height = rect.height
  }

  getContext(): Record<string, unknown> {
    // 2D 画布空壳：预览绘制（ui/pattern-preview.ts）只用到这两个调用 + fillStyle 赋值
    return { fillStyle: '', fillRect: () => undefined, clearRect: () => undefined }
  }

  setPointerCapture(pointerId: number): void {
    this.captured.add(pointerId)
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId)
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId)
  }

  private pathFromTarget(): ShimElement[] {
    const chain: ShimElement[] = []
    let n: ShimElement | null = this
    while (n) {
      chain.push(n)
      n = n.parentNode
    }
    return chain
  }
}

class ShimText extends ShimElement {
  constructor(text: string) {
    super()
    Object.defineProperty(this, 'nodeType', { value: NODE_TEXT })
    this.textContent = text
  }
}

export class ShimDocument extends ShimElement {
  readonly documentElement = new ShimElement()
  readonly body = new ShimElement()
  activeElement: ShimElement
  constructor() {
    super()
    Object.defineProperty(this, 'nodeType', { value: 9 })
    this.ownerDocument = this
    this.documentElement.ownerDocument = this
    this.body.ownerDocument = this
    this.appendChild(this.documentElement)
    this.appendChild(this.body)
    this.activeElement = this.body
  }

  createElement(tag: string): ShimElement {
    const el = tag === 'canvas' ? new ShimCanvas() : new ShimElement()
    el.ownerDocument = this
    el.tagName = tag.toUpperCase()
    return el
  }

  createTextNode(text: string): ShimText {
    const t = new ShimText(text)
    t.ownerDocument = this
    return t
  }
}

class ShimCanvas extends ShimElement {}

/** React DOM 的 focus/selection 探测按 `win.*Element` 逐类 `instanceof` 判——给空类，命中即 false */
class ShimElementClass {}

class ShimWindow extends ShimElement {
  readonly document: ShimDocument
  readonly HTMLIFrameElement = ShimElementClass
  readonly HTMLInputElement = ShimElementClass
  readonly HTMLTextAreaElement = ShimElementClass
  readonly HTMLSelectElement = ShimElementClass
  readonly HTMLButtonElement = ShimElementClass
  readonly HTMLElement = ShimElement
  readonly Element = ShimElement
  constructor(doc: ShimDocument) {
    super()
    this.document = doc
    this.ownerDocument = doc
  }
}

export interface DomHarness {
  window: ShimWindow
  document: ShimDocument
  /** 派发一个指针事件到目标元素（冒泡到 window） */
  firePointer: (target: ShimElement, type: string, init?: Record<string, unknown>) => ShimEvent
  fireKey: (target: ShimElement, type: string, init?: Record<string, unknown>) => ShimEvent
  /** 断言用的 canvas 元素（`Viewport` 首次 createElement('canvas') 的那个） */
  firstCanvas: () => ShimCanvas
  elementCount: () => number
  restore: () => void
}

class ShimResizeObserver {
  constructor(_cb: unknown) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** 安装垫片到全局；返回句柄。用例结束后应调用 `restore()`（或依赖 vitest 进程隔离）。 */
export function installDom(): DomHarness {
  const doc = new ShimDocument()
  const win = new ShimWindow(doc)
  win.appendChild(doc) // window 的路径根：document 挂在 window 下
  const g = globalThis as Record<string, unknown>
  const saved = new Map<string, unknown>()
  const set = (name: string, value: unknown): void => {
    saved.set(name, g[name])
    g[name] = value
  }
  set('window', win)
  set('document', doc)
  set('ResizeObserver', ShimResizeObserver)
  set('HTMLElement', ShimElement)
  set('Element', ShimElement)
  set('Node', ShimElement)
  // React DOM 的 focus 探测按 `instanceof` 逐类判——垫片里给出空类，命中即 false
  for (const name of [
    'HTMLIFrameElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
    'HTMLAnchorElement',
  ]) {
    set(name, ShimElementClass)
  }
  set('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(0), 0))
  set('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  const createdCanvases: ShimCanvas[] = []
  const createdTags: string[] = []
  const origCreate = doc.createElement.bind(doc)
  doc.createElement = (tag: string): ShimElement => {
    createdTags.push(tag)
    const el = origCreate(tag)
    if (tag === 'canvas') createdCanvases.push(el as ShimCanvas)
    return el
  }
  ;(doc as unknown as { createdTags: string[] }).createdTags = createdTags

  const fire = (target: ShimElement, EventCtor: typeof ShimEvent, type: string, init?: Record<string, unknown>): ShimEvent => {
    const e = new EventCtor(type, { bubbles: true, ...init })
    target.dispatch(e)
    return e
  }

  return {
    window: win,
    document: doc,
    firePointer: (target, type, init) => fire(target, ShimEvent, type, init),
    fireKey: (target, type, init) => fire(target, ShimEvent, type, init),
    firstCanvas: () => {
      if (createdCanvases.length === 0) throw new Error('dom shim: 还没有 canvas 被创建')
      return createdCanvases[0]!
    },
    elementCount: () => createdCanvases.length,
    restore: () => {
      for (const [name, value] of saved) {
        if (value === undefined) delete g[name]
        else g[name] = value
      }
      vi.restoreAllMocks()
    },
  }
}

export type { ShimCanvas }
