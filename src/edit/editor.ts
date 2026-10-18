// r04 T6（B-1）：编辑器服务——类骨架 + 一行委托面（数据流：UI → PatchLog → Volume → 渲染 → 自动保存）。
// 实现分家（facade 不变 ⇒ 239 例断言零改动；详细文档在各实现文件）：笔刷/预览 → stroke.ts（D1/D2 合并）·
// 会话态 → session-view.ts · 写 API → model-api.ts · 历史 → history.ts · 构件组合 → structure.ts ·
// 项目 → project.ts · AI 写 → ai-write.ts · 端口 → render-port.ts · 投影 → state/projections.ts · 相机 → interaction/camera-sync.ts。
import { internBuiltin } from '../core/builtin-palette'
import type { BrushRejections } from '../core/brush/apply'
import type { LayerFilter } from '../core/brush/predicate'
import { CompositionRegistry } from '../core/composition'
import { PatchLog } from '../core/patch-log'
import { PartRegistry } from '../core/parts'
import type { BlockStyle, Coord, Patch, ProgramOp, VoxelChange } from '../core/types'
import { Volume } from '../core/volume'
import { AUTOSAVE_DEBOUNCE_MS, AutoSaver } from '../io/autosave'
import { IdbProjectStore, MemoryProjectStore, createProjectStore } from '../io/project-store'
import type { ProjectStore } from '../io/project-store'
import { setUi, useEditorUi } from '../state/editor-store'
import type { EditorMode, HistoryItem, Tool } from '../state/editor-store'
import type { PreviewRejectKind } from '../state/preview-warning'
import { historyItemsOf, syncUi as syncUiOf } from '../state/projections'
import { applyCameraParams as applyCameraParamsTo, resetCameraView as resetCameraViewOf, syncCameraReadout as pushCameraReadout } from './camera-sync'
import type { EditorRenderer } from './render-port'
import { StrokeSession } from './stroke'
import * as color from './color'
import * as history from './history'
import * as modelApi from './model-api'
import * as aiWrite from './ai-write'
import * as patternApply from './pattern-apply'
import type { PatternApplyArgs, PatternApplyResult } from './pattern-apply'
import * as project from './project'
import * as sessionView from './session-view'
import * as structure from './structure'

export class Editor {
  readonly volume = new Volume()
  readonly parts = new PartRegistry()
  readonly compositions = new CompositionRegistry()
  readonly log: PatchLog
  readonly autosave: AutoSaver
  /** 笔刷一笔状态机（T6-A2）；Editor 的 stroke* / preview* 方法是它的一行委托 */
  readonly stroke: StrokeSession

  // ── @internal：edit 层内共享面（r04 T6-A 拆分；对外正本面仍是公共方法）──
  /** 渲染层实例（装配入口 = attachRenderer / detachRenderer） */
  renderer: EditorRenderer | null = null
  /** 项目存储（project.ts 清档用；浏览器由 adoptBrowserStore 换 IndexedDB） */
  store: ProjectStore
  /** 项目元数据（project.ts 读写） */
  meta = project.freshMeta()
  /** 内置色板身份 → 键（currentKey / project / 投影共用） */
  builtinKeys = new Map<string, number>()
  /** 当前方块体系（视图态，进存档） */
  blockStyle: BlockStyle = 'color'
  /** 当前选中构件（D-B ③：手工放置归属）与选中组合（高亮集合）——互斥 */
  selectedPartId: string | null = null
  selectedCompositionId: string | null = null
  /** 缺项身份清单（updateAppearance 重算） */
  missing: string[] = []

  constructor(store: ProjectStore = new MemoryProjectStore()) {
    this.store = store
    this.log = new PatchLog(this.volume, this.parts, this.compositions) // r03：传组合注册表（ADR-19 undo/redo 直属键镜像）
    this.autosave = new AutoSaver(
      this.store,
      () => project.buildFile(this),
      AUTOSAVE_DEBOUNCE_MS,
      (s) => setUi({ saveState: s }),
    )
    this.builtinKeys = internBuiltin(this.volume.palette)
    this.stroke = new StrokeSession(this)
  }

  /** 浏览器环境把存储换成 IndexedDB（bootstrap 调一次；测试保持内存存储） */
  async adoptBrowserStore(): Promise<void> {
    if (!IdbProjectStore.supported()) return
    this.store = await createProjectStore()
    this.autosave.setStore(this.store)
  }

  /** 启动：从存储恢复（REQ-001 ②③ 刷新不丢的入口）；无存档 ⇒ 首运行载入展示件（REQ-062），
   *  展示件不可用 ⇒ 退回 3×3×3 坯料；恢复失败 ⇒ 保持新项目并提示（装载分支见 project.ts#loadOrSeed） */
  async init(): Promise<void> {
    const file = await this.store.load()
    await project.loadOrSeed(this, file)
    this.renderer?.rebuildAll()
    this.renderer?.frameModel()
    this.updateAppearance()
    this.syncUi()
  }

  // ── 渲染层挂接 ──

  attachRenderer(renderer: EditorRenderer): void {
    this.renderer = renderer
    this.updateAppearance()
    renderer.rebuildAll()
    // 会话态视图随挂接恢复（层次 / 网格 / 交互模式——store 是唯一状态源，REQ-054 口径）
    const s = useEditorUi.getState()
    renderer.setLayerFilter?.(this.currentLayerFilter())
    renderer.setGrid?.({ base: s.gridBase, layer: s.gridLayer, y: s.workGridY })
    renderer.setInteractionMode?.(s.mode)
  }

  detachRenderer(): void {
    this.renderer = null
  }

  // ── 会话态视图（实现 = session-view.ts）──

  setLayerView(mode: LayerFilter['mode'] | 'all', y: number): void {
    sessionView.setLayerView(this, mode, y)
  }

  setGridView(base: boolean, layer: boolean): void {
    sessionView.setGridView(this, base, layer)
  }

  setWorkGridY(y: number): void {
    sessionView.setWorkGridY(this, y)
  }

  /** `D3`：参考网格独立 y（只读参考平面：可设高度，不提供放置 / 不参与命中） */
  setRefGridY(y: number): void { sessionView.setRefGridY(this, y) }

  /** `D3`：网格「参数跟随」（跟层次滑块当前层实际 y；默认关；取消恢复勾选前独立值） */
  setGridFollow(which: 'work' | 'ref', on: boolean): void { sessionView.setGridFollow(this, which, on) }

  setMode(mode: EditorMode): void {
    sessionView.setMode(this, mode)
  }

  setBrushSize(size: { x: number; y: number; z: number }): void {
    sessionView.setBrushSize(this, size)
  }

  setOverridePlace(on: boolean): void {
    sessionView.setOverridePlace(this, on)
  }

  setTool(tool: Tool): void {
    sessionView.setTool(this, tool)
  }

  setCurrentIdentity(identity: string): void { setUi({ currentIdentity: identity }) }

  /** P3 颜色闭环（`REQ-027` 门四 / `REQ-037` · B-01–B-08；实现 = session-view.ts）· 一行委托 */
  setCurrentColor(hex: string, identity?: string): boolean { return sessionView.setCurrentColor(this, hex, identity) }
  /** 吸管：读原始体素色并更新当前色（不改模型与历史；网格 / 背景不取色） */
  eyedrop(x: number, y: number, z: number): boolean { return sessionView.eyedrop(this, x, y, z) }

  /** @internal：层次过滤快照（stroke 宿主端口） */
  currentLayerFilter(): LayerFilter | null {
    const s = useEditorUi.getState()
    return s.layerMode === 'all' ? null : { mode: s.layerMode, y: s.layerY }
  }

  // ── 笔刷一笔与预览（实现 = stroke.ts；V8 / V10 的断言面）──

  strokeBegin(): boolean {
    return this.stroke.begin()
  }

  strokeApply(anchor: Coord): number {
    return this.stroke.apply(anchor)
  }

  strokeCommit(): void {
    this.stroke.commit()
  }

  strokeCancel(): void {
    this.stroke.cancel()
  }

  previewAt(anchor: Coord): Coord[] {
    return this.stroke.previewAt(anchor)
  }

  clearPreview(): void {
    this.stroke.clearPreview()
  }

  /** `D5`：没命中（射线没打到可见模型 / 工作平面）时的左上短原因——见 `StrokeSession.previewMiss` */
  previewMiss(kind: PreviewRejectKind): void { this.stroke.previewMiss(kind) }

  // ── 写操作（REQ-016：一次操作 = 一条补丁；实现 = model-api.ts）。
  //    place/erase/paint 是模型级 API（r01 兼容面，测试与工具直调）；
  //    界面编辑入口 = strokeBegin / runOp——检视态门（V10）只挡后者。──

  /** D-B ③（r02）：手工放置归当前选中构件；未选中 ⇒ 无归属（手工块） */
  place(x: number, y: number, z: number): void {
    modelApi.place(this, x, y, z)
  }

  erase(x: number, y: number, z: number): void {
    modelApi.erase(this, x, y, z)
  }

  /** 改色：只对已有块生效（before>0 → after>0 的替换） */
  paint(x: number, y: number, z: number): void {
    modelApi.paint(this, x, y, z)
  }

  /** r02 手动调用面：程序化操作只走 runProgramOp + PatchLog.applyPlanned；空范围 / 非法参数明确反馈不记账。 */
  runOp(op: ProgramOp): boolean {
    return modelApi.runOp(this, op)
  }

  // ── F12：撤销历史（实现 = history.ts；跳转 = 逐步 undo/redo 的循环 ⇒ 与单步路径天然等价，V13）──

  historyItems(): HistoryItem[] {
    return historyItemsOf(this.log)
  }

  /** 点击历史某行 = 跳到该笔应用后的状态（undo(n) / redo(n)） */
  historyJump(seq: number): void {
    history.historyJump(this, seq)
  }

  undo(): void {
    history.undo(this)
  }

  redo(): void {
    history.redo(this)
  }

  // ── AI 写路径接缝（r03 · plan §2.3 接口 1；实现 = ai-write.ts，模型级调用面与 place/erase/paint 同口径）──

  /** AI 程序化操作：返回补丁；null = 零变化（不记账）；`{busy}` = 人工一笔进行中（零修改，A-09）；
   *  参数校验异常向上抛（AI 执行器转教学式回执）。 */
  aiProgramOp(op: ProgramOp): Patch | null | { busy: true } {
    return aiWrite.aiProgramOp(this, op)
  }

  /** AI 笔刷一笔（D1 合并后与人手路径同源）。返回拒绝计数（含 y<0 越界——REQ-059 回执来源）；
   *  人工一笔进行中 ⇒ `busy`（不写入、不取消人工笔，A-09）。 */
  aiBrush(args: aiWrite.AiBrushArgs): { patch: Patch | null; rejected: BrushRejections; busy?: true } {
    return aiWrite.aiBrush(this, args)
  }

  /** AI 逐块清单兜底（set_cells）：显式坐标差分 → 恰好 1 条 stroke 补丁（V1）；人工一笔中 ⇒ `{busy}`（A-09）。 */
  aiSetCells(args: { cells: ReadonlyArray<{ x: number; y: number; z: number; key: number }>; label?: string }): Patch | null | { busy: true } {
    return aiWrite.aiSetCells(this, args)
  }

  /** 图纸导入（本地识别 / AI 识别 → 预览 → 确认写入）：一次 = 一条补丁；实现 = pattern-apply.ts。
   *  与 place/erase/paint 同口径的模型级写面（检视态门在 UI 命令层）。 */
  applyPattern(args: PatternApplyArgs): PatternApplyResult {
    return patternApply.applyPattern(this, args)
  }

  /** AI undo/redo（带 job 开始地板——退不进 job 开始前用户的编辑，PetitMaker ①-23 先例）。 */
  aiUndo(steps: number, floorPatchCount: number): { done: number; reason?: string } {
    return aiWrite.aiUndo(this, steps, floorPatchCount)
  }

  aiRedo(steps: number): number {
    return aiWrite.aiRedo(this, steps)
  }

  // ── 视图（不改模型 ⇒ 不进自动保存，除非 blockStyle 进存档）──

  setBlockStyle(style: BlockStyle): void {
    this.blockStyle = style
    this.updateAppearance()
    this.autosave.notifyChange() // blockStyle 进存档（plan §1.3 要点 6）
    this.syncUi()
  }

  // ── F9 相机三方法（实现 = interaction/camera-sync.ts，T6-A7）──

  applyCameraParams(p: { fov?: number; rotateSpeed?: number; damping?: number; distance?: number }): void {
    applyCameraParamsTo(this.renderer, p)
  }

  /** F9：复位视角（回到"对准模型 AABB 中心的初始机位"） */
  resetCameraView(): void {
    resetCameraViewOf(this.renderer)
  }

  /** 渲染层 → store 的相机读回（Viewport 挂接 renderer.onCameraChange 时调用） */
  syncCameraReadout(read: { target: [number, number, number]; distance: number; fov: number; rotateSpeed: number; damping: number }): void {
    pushCameraReadout(read)
  }

  // ── 构件与组合（实现 = structure.ts；REQ-018 / REQ-023 / REQ-051）──

  selectPart(partId: string | null): void {
    structure.selectPart(this, partId)
  }

  /** 新建空构件并选中（后续手工放置归它；D-B ③） */
  newPart(): void {
    structure.newPart(this)
  }

  renamePart(partId: string, name: string): void {
    structure.renamePart(this, partId, name)
  }

  /** D-D：删除构件 = 解除归属（块留下、成为手工块） */
  dissolvePart(partId: string): void {
    structure.dissolvePart(this, partId)
  }

  /** 回退到某构件创建时（REQ-023 ②） */
  rollbackToPart(partId: string): void {
    structure.rollbackToPart(this, partId)
  }

  createComposition(name?: string): void {
    structure.createComposition(this, name)
  }

  renameComposition(id: string, name: string): void {
    structure.renameComposition(this, id, name)
  }

  addPartToComposition(compId: string, partId: string): void {
    structure.addPartToComposition(this, compId, partId)
  }

  removePartFromComposition(compId: string, partId: string): void {
    structure.removePartFromComposition(this, compId, partId)
  }

  /** 把当前全部手工块并入组合 */
  addManualBlocksToComposition(compId: string): void {
    structure.addManualBlocksToComposition(this, compId)
  }

  /** 拆除组合（视图消失；块与 part 归属不变） */
  dissolveComposition(id: string): void {
    structure.dissolveComposition(this, id)
  }

  /** 选中组合 ⇒ 视口高亮其块集合（REQ-051 ②） */
  selectComposition(id: string | null): void {
    structure.selectComposition(this, id)
  }

  // ── 项目（实现 = project.ts；REQ-001 / REQ-003 · F6：新建 = 3³ 坯料）──

  newProject(): void {
    project.newProject(this)
  }

  exportFile(): string {
    return project.exportFile(this)
  }

  /** 导入要么完整成功、要么明确失败且当前场景不变（REQ-003 / NFR-006） */
  importFile(text: string): { ok: true } | { ok: false; error: string } {
    return project.importFile(this, text)
  }

  // ── @internal：edit 层内共享的服务面（拆分模块与 StrokeSession 的宿主端口）──

  /** @internal 颜色键三读点（`REQ-027` 门四）：写入键 / 可判失败写入键 / 预览键（预览不分配键） */
  currentKey(): number { return color.internCurrentColorOrThrow(this) }
  tryCurrentKey(): color.InternResult { return color.internCurrentColor(this) }
  previewColorKey(): number { return color.previewColorKey(this) }

  /** @internal：渲染层增量重建（applyChanges + onModelChanged；F1 目标点重算） */
  renderChanges(changes: readonly VoxelChange[]): void {
    this.renderer?.applyChanges(changes)
    this.renderer?.onModelChanged?.()
  }

  /** @internal：外观与 UI 投影刷新（不改模型 ⇒ 不进自动保存） */
  refreshViews(): void { this.updateAppearance(); this.syncUi() }

  /** @internal：推外观给渲染层（`REQ-022` color-only：无第二套体系 ⇒ 无"缺映射"；模型零写入） */
  updateAppearance(): void {
    // 去贴图化后恒无缺项（投影字段 / `Appearance` 形状保留，UI 不再展示缺项清单）
    this.missing = []
    this.renderer?.setAppearance({
      style: this.blockStyle,
      missing: new Set(this.missing),
    })
  }

  /** @internal：正向写收尾（渲染 + 目标点重算 + 外观 + 自动保存 + UI 投影） */
  afterChange(changes: readonly VoxelChange[]): void {
    this.renderChanges(changes)
    this.updateAppearance() // 缺项清单随模型变化刷新
    this.autosave.notifyChange()
    this.syncUi()
  }

  /** @internal：模型 → store 全量投影（实现 = state/projections.ts）+ 渲染层层次过滤对齐（debug-261007） */
  syncUi(): void { syncUiOf(this); sessionView.syncLayerView(this) }
}

// r04 T5（A9/F1）：应用级单例已摘除——装配移到组合根 app/runtime（getEditor() 惰性单例）；
// 浏览器由 bootstrap() 换 IndexedDB 存储；测试自建实例的口径不变。