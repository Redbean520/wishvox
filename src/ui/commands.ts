import type { ScopeRef } from '../core/types'
import { parseColorInput, parseRgbInput } from '../core/color'
import { getEditor } from '../app/runtime'
import { applyCameraParams, resetCameraView } from '../edit/camera-sync'
import { setUi, useEditorUi } from '../state/editor-store'
import { patchPattern, usePatternStore } from '../state/pattern-store'
import type { EditorUiState, Tool } from '../state/editor-store'
import { askClearLocalData, askResetChoice, clearLocalDataAndReload, runShowcaseReset } from './showcase-actions'

// 具名命令（kickoff 实现纪律 ①）：**每个界面按钮 = 一个具名命令对象（名 / 入口 / 可用性）**，
// 不写匿名 onClick——这是 r05 快捷键表与 r03 AI 工具表的共同地基。
// 可用性统一从同一状态源（UI store）求值：检视态灰掉一切编辑入口（REQ-054），面板灰掉不消失。

type CommandAvailability = (s: EditorUiState) => boolean

export interface AppCommand<P = void> {
  /** 命令名（稳定标识——r03 AI 工具表直接引用它） */
  readonly id: string
  /** 按钮文案 */
  readonly label: string | ((s: EditorUiState) => string)
  /** 入口（哪个面板/哪一行） */
  readonly entry: string
  readonly available: CommandAvailability
  /** 参数可选 ⇒ 无参命令 run() / 参数化命令 run(arg) 都合法 */
  readonly run: (args?: P) => void
}

const editing: CommandAvailability = (s) => s.mode === 'edit'
const always: CommandAvailability = () => true

/**
 * 检视态只读提示的**唯一文案**（r05 · 规格 §2.2「检视态提示（各编辑块黄字）→ 等（黄）」）。
 * 单点承载：左栏三键 `title` 后缀与整句黄字、右栏各编辑块的黄字 / `title` 后缀共用本常量
 * ——`T3` 起右栏块也走这里，避免同一句在各件各写一遍（措辞漂移会让 §2.2 的判据无法抽查）。
 */
export const INSPECT_READONLY = '检视态只读：顶栏「👁 检视态」点击切回编辑'

export const cmd = {
  // ── 顶栏 ──
  toggleMode: {
    id: 'mode.toggle',
    label: (s) => (s.mode === 'edit' ? '切到检视' : '切到编辑'),
    entry: '顶栏',
    available: always,
    run: () => getEditor().setMode(useEditorUi.getState().mode === 'edit' ? 'inspect' : 'edit'),
  } satisfies AppCommand,
  newProject: {
    id: 'project.new',
    label: '新建',
    entry: '顶栏',
    available: always,
    run: () => {
      if (window.confirm('新建项目？当前项目与本地存档将被清除（新建后得到 3×3×3 坯料）。')) getEditor().newProject()
    },
  } satisfies AppCommand,
  /** `REQ-067`：清理本地数据（二次确认 → 三项恰好清空 → 立即重载 ⇒ 首运行展示件）。
   *  `available = always`：非编辑动作，检视态可点（不在 `REQ-054` 编辑入口灰置范围）。 */
  cleanLocalData: {
    id: 'project.clearLocalData',
    label: '清理本地数据',
    entry: '顶栏',
    available: always,
    run: () => {
      if (askClearLocalData()) void clearLocalDataAndReload()
    },
  } satisfies AppCommand,
  /** `REQ-068`：回到默认展示件（先问是否保存当前工作；取消 ⇒ 零修改）。
   *  `available = always`：非编辑动作，检视态可点。 */
  showcaseReset: {
    id: 'project.resetShowcase',
    label: '回到默认展示件',
    entry: '顶栏',
    available: always,
    run: () => {
      void runShowcaseReset(askResetChoice())
    },
  } satisfies AppCommand,
  undo: {
    id: 'history.undo',
    label: '撤销',
    entry: '顶栏',
    available: (s) => s.canUndo && editing(s),
    run: () => getEditor().undo(),
  } satisfies AppCommand,
  redo: {
    id: 'history.redo',
    label: '重做',
    entry: '顶栏',
    available: (s) => s.canRedo && editing(s),
    run: () => getEditor().redo(),
  } satisfies AppCommand,
  // ── 左栏：工具与笔刷 ──
  tool: (tool: Tool): AppCommand => ({
    id: `tool.${tool}`,
    label: tool === 'place' ? '放置' : tool === 'erase' ? '擦除' : tool === 'paint' ? '上色' : '吸管',
    entry: '左栏·工具',
    available: editing,
    run: () => getEditor().setTool(tool),
  }),
  overridePlace: {
    id: 'brush.override',
    label: '替换添加（Override）',
    entry: '左栏·笔刷',
    available: editing,
    run: () => getEditor().setOverridePlace(!useEditorUi.getState().overridePlace),
  } satisfies AppCommand,
  // ── 视口右侧：层次与网格 ──
  layerMode: (mode: 'below' | 'single' | 'all'): AppCommand => ({
    id: `layer.mode.${mode}`,
    label: mode === 'all' ? '显示全部' : mode === 'below' ? '渲染以下' : '渲染单层',
    entry: '视口右侧·层次',
    available: always,
    run: () => getEditor().setLayerView(mode, useEditorUi.getState().layerY),
  }),
  gridBase: {
    id: 'grid.base.toggle',
    label: 'y=0 网格',
    entry: '视口右侧·网格',
    available: always,
    run: () => {
      const s = useEditorUi.getState()
      getEditor().setGridView(!s.gridBase, s.gridLayer)
    },
  } satisfies AppCommand,
  gridLayer: {
    id: 'grid.layer.toggle',
    label: '独立工作网格',
    entry: '视口右侧·网格',
    available: always,
    run: () => {
      const s = useEditorUi.getState()
      getEditor().setGridView(s.gridBase, !s.gridLayer)
    },
  } satisfies AppCommand,
  /** `D3`（2026-10-16）：网格「参数跟随」——勾选后该网格 y 实时 = 层次滑块当前层实际 y；
   *  取消勾选恢复**勾选前**的独立 y（独立值全程未被覆盖）。两个网格各一条、互不影响。 */
  gridFollow: (which: 'work' | 'ref'): AppCommand => ({
    id: `grid.follow.${which}`,
    label: which === 'work' ? '工作网格参数跟随' : '参考网格参数跟随',
    entry: '层次块·网格',
    available: always,
    run: () => {
      const s = useEditorUi.getState()
      getEditor().setGridFollow(which, which === 'work' ? !s.followLayerWork : !s.followLayerRef)
    },
  }),
  /** 图纸导入（AI 工作台 · 图纸 → 方块）：把已识别/已核对的网格写成方块。
   *  一次 = 一条补丁（`edit/pattern-apply.ts`）；空网格 / 越界 / 色板满都在模型零改动下给出原因。 */
  patternApply: {
    id: 'pattern.apply',
    label: '生成方块',
    entry: 'AI·图纸导入',
    available: editing,
    run: () => {
      const s = usePatternStore.getState()
      if (s.grid === null) {
        patchPattern({ status: 'error', message: '先选择图纸并识别，再生成方块' })
        return
      }
      const result = getEditor().applyPattern({
        grid: s.grid,
        plane: s.options.plane,
        origin: s.options.origin,
        thickness: s.options.thickness,
        clearEmpty: s.options.clearEmpty,
        label: `图纸·${s.grid.cols}×${s.grid.rows}`,
      })
      patchPattern({ status: result.ok ? 'ready' : 'error', message: result.message })
    },
  } satisfies AppCommand,
  // ── 右栏：相机面板 ──
  cameraReset: {
    id: 'camera.reset',
    label: '复位视角',
    entry: '右栏·相机面板',
    available: always,
    run: () => resetCameraView(getEditor().renderer),
  } satisfies AppCommand,
  // ── 右栏：结构树（参数化命令工厂）──
  partNew: {
    id: 'part.new',
    label: '＋新构件',
    entry: '右栏·结构树',
    available: editing,
    run: () => getEditor().newPart(),
  } satisfies AppCommand,
  compositionNew: {
    id: 'composition.new',
    label: '＋组合',
    entry: '右栏·结构树',
    available: editing,
    run: () => getEditor().createComposition(),
  } satisfies AppCommand,
  partSelect: (partId: string): AppCommand => ({
    id: 'part.select',
    label: '选中构件',
    entry: '右栏·结构树',
    available: always,
    run: () => getEditor().selectPart(partId === useEditorUi.getState().selectedPartId ? null : partId),
  }),
  partRollback: (partId: string): AppCommand => ({
    id: 'part.rollback',
    label: '回退',
    entry: '右栏·结构树',
    available: editing,
    run: () => getEditor().rollbackToPart(partId),
  }),
  partDissolve: (partId: string): AppCommand => ({
    id: 'part.dissolve',
    label: '删除',
    entry: '右栏·结构树',
    available: editing,
    run: () => {
      const p = useEditorUi.getState().parts.find((x) => x.id === partId)
      if (p && window.confirm(`删除构件「${p.name}」= 解除归属：${p.count} 个方块保留在场景里（成为手工块）。不会删除任何方块。确定？`)) {
        getEditor().dissolvePart(partId)
      }
    },
  }),
  compositionSelect: (compId: string): AppCommand => ({
    id: 'composition.select',
    label: '选中组合',
    entry: '右栏·结构树',
    available: always,
    run: () => getEditor().selectComposition(compId === useEditorUi.getState().selectedCompositionId ? null : compId),
  }),
  compositionDissolve: (compId: string): AppCommand => ({
    id: 'composition.dissolve',
    label: '拆除',
    entry: '右栏·结构树',
    available: editing,
    run: () => getEditor().dissolveComposition(compId),
  }),
  compositionAddManual: (compId: string): AppCommand => ({
    id: 'composition.addManualBlocks',
    label: '＋手工块',
    entry: '右栏·结构树',
    available: editing,
    run: () => getEditor().addManualBlocksToComposition(compId),
  }),
  // ── 右栏：撤销历史（F12：点击某行 = undo(n)/redo(n) 跳转）──
  historyJump: (seq: number): AppCommand => ({
    id: 'history.jump',
    label: `跳到补丁 ${seq} 之后`,
    entry: '右栏·撤销历史',
    available: editing,
    run: () => getEditor().historyJump(seq),
  }),
} as const

/** 命令按钮的公共小助手：拿当前态求可用性（面板渲染 disabled 用） */
export function commandEnabled(c: AppCommand): boolean {
  return c.available(useEditorUi.getState())
}

/** 笔刷尺寸调整（左栏数字输入；尺寸变化后预览随之重算） */
export function setBrushAxis(axis: 'x' | 'y' | 'z', value: number): void {
  const s = useEditorUi.getState()
  const v = Math.min(8, Math.max(1, Math.round(value) || 1))
  getEditor().setBrushSize({ ...s.brushSize, [axis]: v })
}

/** 层滑块拖动（视口右侧垂直滑块） */
export function setLayerY(y: number): void {
  const s = useEditorUi.getState()
  getEditor().setLayerView(s.layerMode, y)
}

/** 相机面板输入（即时生效；会话态） */
export function setCameraField(field: 'fov' | 'rotateSpeed' | 'damping' | 'distance', value: number): void {
  applyCameraParams(getEditor().renderer, { [field]: value })
}

/** 调色板选色（左栏色块）——只改当前色身份（内置色以内置色值为准），不写模型 */
export function pickPalette(identity: string): void {
  getEditor().setCurrentIdentity(identity)
}

// ── P3（`REQ-027` · B-01/B-02/B-08）：取色器输入面 ──

/** HEX / `rgb()` 文本输入：等价色值归一到同一规范色值；非法输入保留上次有效色并给原因 */
export function commitHexColor(text: string, okPrefix: string): boolean {
  const parsed = parseColorInput(text)
  if (!parsed.ok) {
    setUi({ message: `颜色输入无效：${parsed.reason}——已保留上次有效色` })
    return false
  }
  const ok = getEditor().setCurrentColor(parsed.hex)
  if (ok) setUi({ message: `${okPrefix}（规范值 ${parsed.hex}）` })
  return ok
}

/** R/G/B 通道输入（整数 0..255）：越界 / 小数 / 空值一律拒绝且保留上次有效色 */
export function commitRgbColor(r: number, g: number, b: number): boolean {
  const parsed = parseRgbInput(r, g, b)
  if (!parsed.ok) {
    setUi({ message: `RGB 输入无效：${parsed.reason}——已保留上次有效色` })
    return false
  }
  const ok = getEditor().setCurrentColor(parsed.hex)
  if (ok) setUi({ message: `已选择颜色 ${parsed.hex}（R${r} G${g} B${b}）` })
  return ok
}

/** 点选模型已用色：只改当前色（不批量改模型、不进历史） */
export function pickUsedColor(color: string, identity: string): boolean {
  const ok = getEditor().setCurrentColor(color, identity)
  if (ok) setUi({ message: `已选择模型已用色 ${color}` })
  return ok
}

/** 噪声模块（F8）：一次生成 = 一条补丁；参数从 NoisePanel 自身表单读 */
export interface NoiseFormState {
  scopeKind: 'all' | 'manual' | 'part' | 'composition'
  scopeId: string
  amplitude: number
  density: number
  seed: number
  dirs: { px: boolean; nx: boolean; py: boolean; ny: boolean; pz: boolean; nz: boolean }
  identity: string
}

export function runNoiseSculpt(form: NoiseFormState): void {
  const s = useEditorUi.getState()
  const key = s.paletteItems.find((p) => p.identity === form.identity)?.key ?? 1
  const scopeRef: ScopeRef =
    form.scopeKind === 'all'
      ? { kind: 'all' }
      : form.scopeKind === 'manual'
        ? { kind: 'manual' }
        : form.scopeKind === 'part'
          ? { kind: 'part', partId: form.scopeId }
          : { kind: 'composition', compositionId: form.scopeId }
  getEditor().runOp({
    type: 'program',
    name: 'noiseSculpt',
    params: { scope: scopeRef, amplitude: form.amplitude, density: form.density, seed: form.seed, dirs: form.dirs, key },
  })
}