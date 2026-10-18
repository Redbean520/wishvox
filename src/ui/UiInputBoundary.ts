// UI 覆盖层的可识别 DOM 标记与边界查询（原 `ui/floating/UiInputBoundary`，随悬浮块体系移除而上提）。
// React 事件与原生监听（Viewport 的 canvas 指针族、App 的窗口快捷键）共用同一份判据——
// 必须"标记 + 查询"而不是各处 stopPropagation：canvas 有 pointer capture、App 的 Ctrl+Z 挂在 window。
export const UI_BOUNDARY_ATTR = 'data-ui-boundary'

interface BoundaryNode {
  getAttribute?: (name: string) => string | null
  parentNode?: unknown
}

/** 事件目标是否落在 UI 边界内（含边界根本身）。垫片 DOM 无 `closest` ⇒ 手工向上走 parentNode。 */
export function isUiEventTarget(target: unknown): boolean {
  let node = target as BoundaryNode | null | undefined
  let guard = 0
  while (node && guard++ < 64) {
    if (typeof node.getAttribute === 'function' && node.getAttribute(UI_BOUNDARY_ATTR) !== null) return true
    node = node.parentNode as BoundaryNode | null | undefined
  }
  return false
}

/** 屏幕点是否落在某个 UI 边界之上（活动笔经过覆盖区时用）。
 *  环境无 `elementFromPoint`（无头垫片 / 老浏览器）⇒ 返回 false，退化为"只看坐标出界"的收尾判据。 */
export function pointOverUi(clientX: number, clientY: number): boolean {
  const doc = (globalThis as { document?: { elementFromPoint?: (x: number, y: number) => unknown } }).document
  if (!doc || typeof doc.elementFromPoint !== 'function') return false
  return isUiEventTarget(doc.elementFromPoint(clientX, clientY))
}
