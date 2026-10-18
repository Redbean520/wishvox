import { useEffect, useRef } from 'react'
import { VoxelView } from '../interaction/view'
import { getEditor } from '../app/runtime'
import { syncCameraReadout } from '../edit/camera-sync'
import { setUi, useEditorUi } from '../state/editor-store'
import { NO_HIT_KIND } from '../state/preview-warning'
import { pointOverUi } from './UiInputBoundary'
import type { PickResult } from '../interaction/pick'

// T14：系统 crosshair 在视口背景上不可辨 ⇒ 自绘高对比准星，热点 = 中心 (12,12)。
// T17：底改白 ⇒ 明暗两笔反转（3px 亮描边 + 1px 暗十字）——白底上暗线精确可辨，深色块上亮描边兜底。
const crosshairCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cg stroke='%23f2f5f9' stroke-width='3'%3E%3Cline x1='12' y1='2' x2='12' y2='22'/%3E%3Cline x1='2' y1='12' x2='22' y2='12'/%3E%3C/g%3E%3Cg stroke='%230b0d10' stroke-width='1'%3E%3Cline x1='12' y1='2' x2='12' y2='22'/%3E%3Cline x1='2' y1='12' x2='22' y2='12'/%3E%3C/g%3E%3C/svg%3E") 12 12, crosshair`

// 悬停节流（ms）：预览 raycast 每帧最多一次（pointermove 频率远高于帧率）
const HOVER_THROTTLE_MS = 16

/** 拾取 → 笔刷锚点：放置 = 被点面的相邻格；擦除 / 上色 = 被点方块本体（REQ-055 锚点语义）。
 *  `pick`（吸管，P3）不产生笔刷锚点——它读被点方块本体，见 `Editor.eyedrop`。 */
function anchorOf(hit: PickResult, tool: 'place' | 'erase' | 'paint' | 'pick'): { x: number; y: number; z: number } {
  const [x, y, z] = tool === 'place' ? hit.adjacent : hit.cell
  return { x, y, z }
}

// 视口：挂 VoxelRenderer（相机由渲染层 + Editor 会话态驱动）。
// r02 前半交互（全部鼠标，无键盘——V12）：
//   检视态：左键拖动 = 旋转 · 中键拖动 = 快缩 · 滚轮 = 慢缩 · 右键 = 平移
//   编辑态：左键 = 笔刷（按下→涂抹→松开 = 一笔，V8）· 右键拖动 = 旋转 · 中键拖动 = 快缩 · 滚轮 = 慢缩
// 悬停 = 虚方块预览（V6）；检视态 / 隐藏层无预览（Q7/V10）。
export function Viewport(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const renderer = new VoxelView(el, getEditor().volume, getEditor().parts)
    getEditor().attachRenderer(renderer)
    renderer.onCameraChange = (s) => syncCameraReadout(s)
    syncCameraReadout(renderer.getCameraState()) // 面板初始读数（不等第一次相机变化）

    const resize = (): void => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) renderer.resize(rect.width, rect.height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    // ── 笔刷交互（编辑态）──
    // 覆盖面板（HUD / 层次 / 网格）也是本容器的子节点 ⇒ 只认 canvas 自己的事件（HUD 另有 pointerEvents:none）
    const onCanvas = (e: PointerEvent): boolean => e.target === renderer.renderer.domElement
    let lastAnchorKey = ''
    // `REQ-055`（第三轮 C2）：取消判据看**整笔轨迹**，不只看最终松手坐标。
    // 指针捕获允许离开 canvas 后继续收到事件；一旦活动笔发生 pointerleave，本笔即永久标记为中断，
    // 即使随后回到画布内松手也必须取消并完整还原。
    let strokeLeftCanvas = false
    let lastHoverT = 0

    // `A-07`（PA-49）：**一笔是否进行中只认 Editor 的 StrokeSession**（`edit/stroke.ts#active`）。
    // 本组件原先自持一份 `strokeActive` 副本，与编辑器可被外部打断（切态 / AI 写 / 窗口失焦）的事实不同步
    // ⇒ 副本停在 true 时既不收尾也不放行下一笔。副本删除后，"卡住"在结构上不可能由本组件造成。
    const strokeActive = (): boolean => getEditor().stroke.active

    /** `A-07`：异常收尾（pointercancel / 窗口失焦 / Esc）——取消当前一笔并完整还原，不记账。 */
    const cancelStroke = (): void => {
      if (!strokeActive()) return
      lastAnchorKey = ''
      strokeLeftCanvas = false
      getEditor().strokeCancel()
    }

    /**
     * `A-07`（`R-01`，用户 2026-10-13 裁定「视窗外收尾 = 取消」）：收尾点是否在视窗内。
     * canvas 是渲染层 `domElement`（`width/height: 100%` 铺满容器），其矩形就是用户看到的视口；
     * 用 `clientX/clientY` 与 `getBoundingClientRect()` 比对，与 `pick()` 同一坐标系。
     * 为什么不能只看"事件回到容器"：`setPointerCapture` 会把画布外的 `pointerup` 也送回 canvas，
     * 于是"指针甩出窗口再松手"与"视窗内正常松手"在事件面上长得一样——必须按收尾坐标分辨。
     */
    const isInsideCanvas = (e: PointerEvent): boolean => {
      const el2 = renderer.renderer.domElement
      if (!el2) return false
      const r = el2.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom
    }

    const hover = (e: PointerEvent, force = false): void => {
      if (!onCanvas(e)) return
      const s = useEditorUi.getState()
      if (s.mode !== 'edit' || strokeActive()) return
      const now = performance.now()
      if (!force && now - lastHoverT < HOVER_THROTTLE_MS) return
      lastHoverT = now
      const hit = renderer.pick(e.clientX, e.clientY, s.mode === 'edit' && s.tool === 'place')
      if (!hit) {
        // `D5`：编辑/放置下"没命中"也是预览全无效的一种（`empty`「无落点：开启工作网格或对准模型」）；
        // 擦除/上色没命中则没有方块可作用（`noTarget`）——两者不是同一句话，不许互相顶替。
        getEditor().previewMiss(s.tool === 'place' ? NO_HIT_KIND : 'noTarget')
        return
      }
      if (hit.source === 'plane' && s.tool !== 'place') {
        getEditor().previewMiss('noTarget') // 工作平面只服务放置（T14/A3）
        return
      }
      getEditor().previewAt(anchorOf(hit, s.tool))
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !onCanvas(e)) return
      const s = useEditorUi.getState()
      if (s.mode !== 'edit') return // 检视态左键归相机（旋转）
      // `A-07` 自愈：上一次交互在窗口外 / 失焦中结束、收尾事件始终没到 ⇒ 先就地取消那半笔（还原 + 不记账），
      // 本次点击不落笔、只给出口；下一次按下即可正常开始新一笔（不让遗留活动态挡写入与撤销）。
      if (strokeActive()) {
        cancelStroke()
        setUi({ message: '上一笔未正常收尾，已取消（模型已还原）；请再按一次开始新的一笔' })
        return
      }
      // P3（`REQ-037` · B-03）：吸管 = 只读取色——读最近可见体素的**原始色**，不写模型、不进历史。
      // 平面拾取关掉（`planeY = false`）⇒ 网格与背景不取色；无命中 / 只剩网格 ⇒ 保持当前色并提示。
      if (s.tool === 'pick') {
        const pickHit = renderer.pick(e.clientX, e.clientY, false)
        if (!pickHit || pickHit.source !== 'model') {
          setUi({ message: '此处没有可见方块可取色（网格与背景不取色）——当前色保持不变' })
          return
        }
        getEditor().eyedrop(pickHit.cell[0], pickHit.cell[1], pickHit.cell[2])
        return
      }
      const hit = renderer.pick(e.clientX, e.clientY, s.mode === 'edit' && s.tool === 'place')
      if (!hit) {
        setUi({ message: '未命中可见模型；隔空放置需开启工作网格、选择放置并命中合法工作平面' })
        getEditor().previewMiss(s.tool === 'place' ? NO_HIT_KIND : 'noTarget') // `D5`：短原因进左上黄字
        return
      }
      if (hit.source === 'plane' && s.tool !== 'place') {
        setUi({ message: '空地上没有方块可擦除或改色' })
        getEditor().previewMiss('noTarget')
        return
      }
      const anchor = anchorOf(hit, s.tool)
      if (!getEditor().strokeBegin()) return
      strokeLeftCanvas = false
      // `A-07`：指针捕获——指针移出 canvas / 拖到窗口边缘后，后续事件仍回到 canvas，才能可靠收尾；
      // `REQ-055` 再用事件坐标记录"曾离开"，最终统一取消。合成 PointerEvent 下可能抛 NotFoundError
      // （非活动 pointerId）⇒ 捕获失败不影响交互，窗口级 pointerup / blur 仍兜底。
      try {
        renderer.renderer.domElement.setPointerCapture(e.pointerId)
      } catch {
        /* 捕获不可用（合成事件 / 非活动 pointerId）：靠窗口级 pointerup / blur 兜底 */
      }
      lastAnchorKey = `${anchor.x},${anchor.y},${anchor.z}`
      getEditor().clearPreview() // 落笔后预览隐去（笔刷本身可见）
      getEditor().strokeApply(anchor)
    }

    const onMove = (e: PointerEvent): void => {
      if (!onCanvas(e)) return
      if (strokeActive() && e.buttons & 1) {
        // 指针捕获期间 canvas 外的 move 也可能仍以 canvas 为 target；坐标出界是比 pointerleave 更可靠的轨迹证据。
        // 一旦出界只记中断、不再涂新格；即使随后回内，onUp 也会取消整笔。
        if (!isInsideCanvas(e)) {
          strokeLeftCanvas = true
          return
        }
        // `D1`（architect §5.5）：**活动笔进入 UI 覆盖区**同样是中断——
        // 覆盖层在画布矩形内，坐标判据看不出差别，必须用 UI 边界命中来分辨（否则会在方块底下继续落块）。
        if (pointOverUi(e.clientX, e.clientY)) {
          strokeLeftCanvas = true
          return
        }
        // 涂抹：拖到新锚点各涂一步（同一条补丁内累积，V8 ①）
        const s = useEditorUi.getState()
        const hit = renderer.pick(e.clientX, e.clientY, s.mode === 'edit' && s.tool === 'place')
        if (!hit) return
        if (hit.source === 'plane' && s.tool !== 'place') return
        const anchor = anchorOf(hit, s.tool)
        const key = `${anchor.x},${anchor.y},${anchor.z}`
        if (key === lastAnchorKey) return
        lastAnchorKey = key
        getEditor().strokeApply(anchor)
        return
      }
      if (e.buttons === 0) hover(e)
    }

    const onUp = (e: PointerEvent): void => {
      if (e.button !== 0) return
      if (!strokeActive()) return // 已收尾 / 已取消（含窗口级兜底先到）⇒ 不重复提交
      // `REQ-055`（第三轮 C2）：**只有整笔轨迹始终在视窗内，且收尾点也在内，才提交**。
      // 指针捕获会把画布外事件送回 canvas；若轨迹曾离开，即使最终回到画布内松手也仍是中断笔。
      if (strokeLeftCanvas || !isInsideCanvas(e)) {
        cancelStroke()
        return
      }
      lastAnchorKey = ''
      strokeLeftCanvas = false
      getEditor().strokeCommit()
      hover(e, true) // 松手后恢复预览
    }

    const onCancel = (): void => {
      cancelStroke()
    }

    const onLeave = (): void => {
      if (strokeActive()) strokeLeftCanvas = true
      getEditor().clearPreview()
    }

    // `A-07` 窗口级兜底：容器外 / 窗口外松手与失焦都收尾，不留活动态。
    //  - `pointerup` / `pointercancel`：正常收尾 / 取消（与容器处理器同一实现，谁先到谁生效，`strokeActive()` 去重）；
    //  - `blur`：窗口失焦 = 中断，统一**取消并完整还原**（design §A4），不落账；
    //  - `Escape`：用户显式取消当前一笔（原先全仓无 Escape 处理器）。
    const onWindowUp = (e: PointerEvent): void => {
      if (e.button !== 0) return
      onUp(e)
    }
    const onWindowCancel = (): void => {
      cancelStroke()
    }
    const onWindowBlur = (): void => {
      cancelStroke()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !strokeActive()) return
      e.preventDefault()
      cancelStroke()
    }

    // T16：中键的浏览器默认行为 = 自动滚动（mousedown / auxclick 两处都要拦）；
    // 右键菜单抑制（编辑态右键 = 旋转）。浏览器保留键位清单见轮次 log 2026-10-01 条目（REQ-038 的输入）。
    const blockMiddleDefault = (e: MouseEvent): void => {
      if (e.button === 1) e.preventDefault()
    }
    const blockContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('mousedown', blockMiddleDefault)
    el.addEventListener('auxclick', blockMiddleDefault)
    el.addEventListener('contextmenu', blockContextMenu)
    // `A-07`：窗口级兜底（指针出了容器 / 窗口，指针事件不再回到 el）
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('pointercancel', onWindowCancel)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('mousedown', blockMiddleDefault)
      el.removeEventListener('auxclick', blockMiddleDefault)
      el.removeEventListener('contextmenu', blockContextMenu)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowCancel)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('keydown', onKeyDown)
      observer.disconnect()
      getEditor().detachRenderer()
      renderer.dispose()
    }
  }, [])

  // `D1`：HUD 与层次卡移出本组件（工作区覆盖层，`EditorWorkspace` 装配）——这里只剩渲染器宿主，
  // 尺寸只随工作区改变，展开方块不挤压画布、不触发重建。
  return <div ref={ref} style={{ flex: 1, minHeight: 0, position: 'relative', cursor: crosshairCursor, background: '#0b0d10' }} />
}