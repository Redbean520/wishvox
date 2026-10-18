// 格线定位（印刷图纸的几何通道）：从"与左右邻居都不同"的细线度量出发，估格长/相位并精修，
// 再裁掉行列号标尺条、图例与空白边，产出网格矩形。底层设施在 `lattice-metrics.ts`。
import { PATTERN_LIMITS } from './types'
import type { RgbaImage } from './types'
import {
  LINE_PRESENCE_RATIO,
  MIN_LINE_SCORE,
  autocorrelationPitch,
  bandIsBlueStrip,
  bandIsRulerBar,
  bandTrimmable,
  colBandIsGrid,
  fitComb,
  lineMetrics,
  longestTrueRun,
  maxOf,
  refineLattice,
  rowBandIsGrid,
} from './lattice-metrics'

export interface LatticeGeometry {
  readonly left: number
  readonly top: number
  readonly cell: number
  readonly cols: number
  readonly rows: number
  /** 梳状拟合的平均线强度（越大越可信） */
  readonly score: number
}

/**
 * 用格线定位网格。找不到可靠格线（纯色块图纸 / 拍照图）⇒ null，由周期通道接手。
 */
export function detectByLattice(img: RgbaImage, opts: { readonly trimBlankEdges?: boolean } = {}): LatticeGeometry | null {
  const { columns: colScore, rows: rowScore } = lineMetrics(img)
  const maxCol = maxOf(colScore)
  const maxRow = maxOf(rowScore)
  if (maxCol < MIN_LINE_SCORE || maxRow < MIN_LINE_SCORE) return null
  // 覆盖率门槛：格线是贯穿整幅图的长线（列线占 ≥35% 图高、行线占 ≥35% 图宽）。
  // 只有文字/图案边界时覆盖率很低 ⇒ 交回周期通道，避免"把文字列当格线"。
  if (maxCol / img.height < 0.35 || maxRow / img.width < 0.35) return null

  const axes: Array<{ score: Int32Array; max: number }> = [
    { score: colScore, max: maxCol },
    { score: rowScore, max: maxRow },
  ]
  const fits: Array<{ period: number; phase: number; positions: number[] }> = []
  for (const axis of axes) {
    const p0 = autocorrelationPitch(axis.score)
    if (p0 === null) return null
    const coarse = fitComb(axis.score, p0)
    if (coarse === null) return null
    const refined = refineLattice(axis.score, coarse.period, coarse.phase, Math.max(MIN_LINE_SCORE, axis.max * LINE_PRESENCE_RATIO))
    if (refined.positions.length < 3) return null
    fits.push(refined)
  }
  const [fx, fy] = fits as [{ period: number; phase: number; positions: number[] }, { period: number; phase: number; positions: number[] }]
  // 两个方向格长应接近（像素方格）；差太多 ⇒ 不是规则格线图纸
  if (Math.abs(fx.period - fy.period) > Math.max(1.5, fx.period * 0.12)) return null
  const cell = (fx.period + fy.period) / 2
  if (cell < 4) return null
  let left = fx.positions[0]!
  let right = fx.positions[fx.positions.length - 1]!
  let top = fy.positions[0]!
  let bottom = fy.positions[fy.positions.length - 1]!
  // 网格范围：只保留"带内被垂直/水平格线贯穿"的连续条带——行列号标尺与图例条会被排除。
  const rowFlags: boolean[] = []
  for (let i = 0; i + 1 < fy.positions.length; i++) rowFlags.push(rowBandIsGrid(img, fy.positions[i]!, fy.positions[i + 1]!, fx.positions))
  const colFlags: boolean[] = []
  for (let i = 0; i + 1 < fx.positions.length; i++) colFlags.push(colBandIsGrid(img, fx.positions[i]!, fx.positions[i + 1]!, fy.positions))
  const rowRun = longestTrueRun(rowFlags)
  const colRun = longestTrueRun(colFlags)
  if (rowRun !== null && rowRun.end - rowRun.start >= 2) {
    top = fy.positions[rowRun.start]!
    bottom = fy.positions[rowRun.end + 1]!
  }
  if (colRun !== null && colRun.end - colRun.start >= 2) {
    left = fx.positions[colRun.start]!
    right = fx.positions[colRun.end + 1]!
  }
  if (right - left < cell * 2 || bottom - top < cell * 2) return null
  // 裁边界：标尺行（顶部列号 "1 2 3 …"）、图例行、以及四周的空白行/列。
  // 只裁"全空位 / 全标尺"的边带 ⇒ 图案本体一格不丢（空白边带本来就不摆块）。
  // 蓝底白字的行列号条（MARD 风格）自动裁掉；底部图例条颜色不统一，仍留给"裁边"手动兜底。
  for (let i = 0; i < Math.min(3, Math.floor((bottom - top) / cell / 4)); i++) {
    if (bottom - top <= cell * 2 || !bandIsBlueStrip(img, 'row', top, cell, left, right)) break
    top = top + cell
  }
  for (let i = 0; i < Math.min(3, Math.floor((bottom - top) / cell / 4)); i++) {
    if (bottom - top <= cell * 2 || !bandIsBlueStrip(img, 'row', Math.round(bottom - cell), cell, left, right)) break
    bottom = bottom - cell
  }
  for (let i = 0; i < Math.min(2, Math.floor((right - left) / cell / 4)); i++) {
    if (right - left <= cell * 2 || !bandIsBlueStrip(img, 'col', left, cell, top, bottom)) break
    left = left + cell
  }
  for (let i = 0; i < Math.min(2, Math.floor((right - left) / cell / 4)); i++) {
    if (right - left <= cell * 2 || !bandIsBlueStrip(img, 'col', Math.round(right - cell), cell, top, bottom)) break
    right = right - cell
  }
  // 标尺条（画着行列号的深色条）永远裁掉——它是坐标标注，不是图案。
  const maxTrim = Math.min(12, Math.floor(Math.min((right - left) / cell, (bottom - top) / cell) / 2))
  for (let i = 0; i < maxTrim; i++) {
    if (bottom - top <= cell * 2 || !bandIsRulerBar(img, 'row', top, cell, left, right)) break
    top = top + cell
  }
  for (let i = 0; i < maxTrim; i++) {
    if (bottom - top <= cell * 2 || !bandIsRulerBar(img, 'row', Math.round(bottom - cell), cell, left, right)) break
    bottom = bottom - cell
  }
  for (let i = 0; i < maxTrim; i++) {
    if (right - left <= cell * 2 || !bandIsRulerBar(img, 'col', left, cell, top, bottom)) break
    left = left + cell
  }
  for (let i = 0; i < maxTrim; i++) {
    if (right - left <= cell * 2 || !bandIsRulerBar(img, 'col', Math.round(right - cell), cell, top, bottom)) break
    right = right - cell
  }
  // 可选：再裁掉四周的空白边带（默认关——图纸标注的 80×89 就摆成 80×89，空白格本来不摆块）
  if (opts.trimBlankEdges === true) {
    for (let i = 0; i < maxTrim; i++) {
      if (bottom - top <= cell * 2 || !bandTrimmable(img, 'row', top, cell, left, right)) break
      top = top + cell
    }
    for (let i = 0; i < maxTrim; i++) {
      if (bottom - top <= cell * 2 || !bandTrimmable(img, 'row', Math.round(bottom - cell), cell, left, right)) break
      bottom = bottom - cell
    }
    for (let i = 0; i < maxTrim; i++) {
      if (right - left <= cell * 2 || !bandTrimmable(img, 'col', left, cell, top, bottom)) break
      left = left + cell
    }
    for (let i = 0; i < maxTrim; i++) {
      if (right - left <= cell * 2 || !bandTrimmable(img, 'col', Math.round(right - cell), cell, top, bottom)) break
      right = right - cell
    }
  }
  const cols = Math.round((right - left) / cell)
  const rowCount = Math.round((bottom - top) / cell)
  if (cols < 2 || rowCount < 2) return null
  if (cols > PATTERN_LIMITS.maxSide || rowCount > PATTERN_LIMITS.maxSide) return null
  return { left: Math.round(left), top: Math.round(top), cell, cols, rows: rowCount, score: Math.min(maxCol, maxRow) }
}