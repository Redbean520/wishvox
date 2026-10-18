// 图纸导入面板的草稿态（**会话态**：不进项目文件、不进补丁日志、不进撤销栈）。
//
// 拆成独立 store 的原因：面板折叠会卸载正文（Section 的约定），而"已识别的网格 + 摆放参数"
// 必须在折叠→展开后还在；命令表（commands.ts）也要能读到它——store 是两者唯一共享点。
// 大对象（RGBA 像素缓冲）留在 store 内存里，刷新即丢；真正落盘的是生成出来的方块补丁。
import { create } from 'zustand'
import type { GridGeometry, PatternColorStat, PatternGrid, RgbaImage } from '../io/pattern/types'

export type PatternStatus = 'idle' | 'loading' | 'ready' | 'recognizing' | 'error'

export type PatternPlaneOption = 'xz' | 'xy'

export interface PatternOptions {
  /** 摆放平面：地上铺（xz）/ 墙上挂（xy） */
  plane: PatternPlaneOption
  /** 网格左上角对应的体素坐标 */
  origin: { x: number; y: number; z: number }
  /** 厚度（沿平面法线复制 1–8 层） */
  thickness: number
  /** 空格子也清除目标区域 */
  clearEmpty: boolean
  /** 手动行列（null = 自动检测） */
  manualCols: number | null
  manualRows: number | null
  /** 近色归并阈值（最大通道差 0–80） */
  mergeTolerance: number
  /** 裁掉四周空白边带（默认 false = 保留图纸标称整张网格） */
  trimBlankEdges: boolean
  /** 与背景同色 = 空位 */
  backgroundToEmpty: boolean
}

export interface PatternUiState {
  readonly status: PatternStatus
  readonly message: string | null
  readonly imageName: string | null
  readonly imageWidth: number
  readonly imageHeight: number
  readonly previewDataUrl: string | null
  readonly visionDataUrl: string | null
  readonly rgba: RgbaImage | null
  readonly grid: PatternGrid | null
  readonly geometry: GridGeometry | null
  readonly palette: ReadonlyArray<PatternColorStat>
  readonly warnings: ReadonlyArray<string>
  readonly emptyCells: number
  readonly recognizedBy: 'local' | 'ai' | null
  readonly options: PatternOptions
}

export const DEFAULT_PATTERN_OPTIONS: PatternOptions = {
  plane: 'xz',
  origin: { x: 0, y: 0, z: 0 },
  thickness: 1,
  clearEmpty: false,
  manualCols: null,
  manualRows: null,
  mergeTolerance: 18,
  trimBlankEdges: false,
  backgroundToEmpty: true,
}

const initial = (): PatternUiState => ({
  status: 'idle',
  message: null,
  imageName: null,
  imageWidth: 0,
  imageHeight: 0,
  previewDataUrl: null,
  visionDataUrl: null,
  rgba: null,
  grid: null,
  geometry: null,
  palette: [],
  warnings: [],
  emptyCells: 0,
  recognizedBy: null,
  options: DEFAULT_PATTERN_OPTIONS,
})

export const usePatternStore = create<PatternUiState>(initial)

export function patchPattern(patch: Partial<PatternUiState>): void {
  usePatternStore.setState(patch)
}

export function setPatternOptions(patch: Partial<PatternOptions>): void {
  usePatternStore.setState((s) => ({ options: { ...s.options, ...patch } }))
}

export function resetPatternDraft(): void {
  usePatternStore.setState({ ...initial(), options: usePatternStore.getState().options })
}

/** 折叠态摘要（Section 要求可折叠块必须给 hint） */
export function patternHint(s: PatternUiState): string {
  if (s.status === 'loading') return '解码中…'
  if (s.status === 'recognizing') return 'AI 识别中…'
  if (s.status === 'error') return s.message ?? '出错了'
  if (s.grid === null) return '未选图纸'
  const colors = s.palette.length
  return `${s.grid.cols}×${s.grid.rows} 格 · ${colors} 色${s.emptyCells > 0 ? ` · 空 ${s.emptyCells}` : ''}`
}