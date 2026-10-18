// 逐格取色（纯函数）：按几何把每一格内部的像素取"填充色"，再把近色归并成同一色板条目。
//
// 四种图纸，一套取色：
// ① 纯色块图纸：格内一种颜色 → 四角取样 = 格内颜色；
// ② 带格线的图纸：取样内缩 2px，避开格线；
// ③ 带色号文字的图纸（拼豆软件导出）：文字压在格中央，取**四角小方块**的众数色 = 底色，
//    文字色被绕开（这是"取中位色"做不到的：17px 的格子里两字符文字能盖住中心一大半）；
// ④ 白底 + 深色文字的格子 = 白色豆（`H2` 之类）：填充色是白的、但**中心有文字** ⇒ 不算空位；
//    纯白且无文字的格子才是空位。这条区分让"白豆"与"空白纸"不再混为一谈。
//
// 近色归并 = 单遍 leader 聚类（按出现次数从多到少当中心，最大通道差 ≤ tolerance 归入）：
// 图纸色板常见的"同一色号因压缩略有偏差"由此收敛，但不会把两种明显不同的颜色并掉。

import { rgbToHex } from '../../core/color'
import { channelDistance, pixelAt } from './types'
import type { GridGeometry, PatternColorStat, PatternGrid, RgbaImage, Rgb } from './types'

/** 与填充色差 ≤ 它算"同一颜色"（用于一致性 / 文字占比） */
const FILL_TOLERANCE = 26
/** 文字占比 ≥ 它算该格内印了色号（白底 + 文字 = 白豆） */
const TEXT_RATIO = 0.045
/** "纸白"判据：亮度高且几乎无彩度 */
const PAPER_LUM = 235
const PAPER_SPREAD = 12

interface CellSample {
  /** 格子填充色（null = 空位） */
  readonly hex: string | null
  /** 格内是否有色号文字（用来区分"白豆"与"空白纸"） */
  readonly text: boolean
  /** 近色像素占比（0–1）——低 = 格内颜色杂乱（拍照 / 水印 / 符号） */
  readonly uniformity: number
}

/**
 * 逐格取样：**边圈中位色 + 内部众数色** 两路互验。
 * - 边圈（格里侧外沿一圈）几乎总是底色：中位色精度高、不受压缩噪声影响；
 * - 但 9px 小格里的 4 字色号可能贴到格边，边圈被文字染白/染黑 ⇒ 此时改用**内部众数色**
 *   （底色像素占多数，文字/水印是少数派）。
 * 两路差异 > 45 且众数色占比 ≥ 40% 时以众数色为准；否则用更精确的边圈中位色。
 */
function sampleCell(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): CellSample {
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return { hex: null, text: false, uniformity: 0 }
  if (w < 4 || h < 4) {
    const p = pixelAt(img, Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2))
    if (p.a < 32) return { hex: null, text: false, uniformity: 0 }
    return { hex: rgbToHex(p), text: false, uniformity: 1 }
  }
  const inset = Math.max(1, Math.min(3, Math.round(Math.min(w, h) * 0.18)))
  const bx0 = x0 + inset
  const by0 = y0 + inset
  const bx1 = x1 - inset
  const by1 = y1 - inset
  const ring = Math.max(1, Math.min(3, Math.round(Math.min(w, h) * 0.16)))
  const ringSamples: Rgb[] = []
  const push = (x: number, y: number): void => {
    const p = pixelAt(img, x, y)
    if (p.a < 32) return
    ringSamples.push({ r: p.r, g: p.g, b: p.b })
  }
  for (let t = 0; t < ring; t++) {
    for (let x = bx0; x < bx1; x++) {
      push(x, by0 + t)
      push(x, by1 - 1 - t)
    }
  }
  for (let t = 0; t < ring; t++) {
    for (let y = by0 + ring; y < by1 - ring; y++) {
      push(bx0 + t, y)
      push(bx1 - 1 - t, y)
    }
  }
  if (ringSamples.length === 0) return { hex: null, text: false, uniformity: 0 }
  const median = (vals: number[]): number => {
    const s = [...vals].sort((a, b) => a - b)
    return s[s.length >> 1] ?? 0
  }
  const ringMedian: Rgb = {
    r: median(ringSamples.map((p) => p.r)),
    g: median(ringSamples.map((p) => p.g)),
    b: median(ringSamples.map((p) => p.b)),
  }
  // 内部众数色（高低 4 位量化）
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  let total = 0
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const p = pixelAt(img, x, y)
      if (p.a < 32) continue
      const key = ((p.r >> 4) << 8) | ((p.g >> 4) << 4) | (p.b >> 4)
      const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      cur.n++
      cur.r += p.r
      cur.g += p.g
      cur.b += p.b
      buckets.set(key, cur)
      total++
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const v of buckets.values()) if (best === null || v.n > best.n) best = v
  const modeFill: Rgb | null = best === null ? null : { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) }
  const modeShare = best === null || total === 0 ? 0 : best.n / total
  const fill: Rgb =
    modeFill !== null && modeShare >= 0.4 && channelDistance(ringMedian, modeFill) > 45 ? modeFill : ringMedian
  // 一致性 / 文字占比
  let near = 0
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const p = pixelAt(img, x, y)
      if (p.a < 32) continue
      if (channelDistance(p, fill) <= FILL_TOLERANCE) near++
    }
  }
  const uniformity = total === 0 ? 0 : near / total
  const inkRatio = 1 - uniformity
  const lum = (fill.r + fill.g + fill.b) / 3
  const spread = Math.max(fill.r, fill.g, fill.b) - Math.min(fill.r, fill.g, fill.b)
  const nearWhite = lum >= PAPER_LUM && spread <= PAPER_SPREAD
  if (nearWhite) {
    return inkRatio >= TEXT_RATIO ? { hex: '#ffffff', text: true, uniformity } : { hex: null, text: false, uniformity }
  }
  return { hex: rgbToHex(fill), text: inkRatio >= TEXT_RATIO, uniformity }
}

export interface SampleOutcome {
  readonly grid: PatternGrid
  readonly palette: ReadonlyArray<PatternColorStat>
  readonly emptyCells: number
  /** 平均格内一致性（0–1） */
  readonly uniformity: number
  readonly warnings: ReadonlyArray<string>
}

/** 近色归并：原色 → 归并中心色 + 色板统计 */
function mergeNearColors(
  counts: ReadonlyMap<string, number>,
  tolerance: number,
): { map: ReadonlyMap<string, string>; palette: PatternColorStat[] } {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const centers: Array<{ rgb: Rgb; members: Array<readonly [string, number]> }> = []
  const map = new Map<string, string>()
  for (const [hex, count] of entries) {
    const rgb = parseHexRgb(hex)
    if (rgb === null) continue
    let target = centers.find((c) => channelDistance(c.rgb, rgb) <= tolerance)
    if (target === undefined) {
      target = { rgb, members: [] }
      centers.push(target)
    }
    target.members.push([hex, count])
  }
  const palette: PatternColorStat[] = []
  for (const center of centers) {
    let r = 0
    let g = 0
    let b = 0
    let total = 0
    for (const [hex, n] of center.members) {
      const rgb = parseHexRgb(hex)
      if (rgb === null) continue
      r += rgb.r * n
      g += rgb.g * n
      b += rgb.b * n
      total += n
    }
    if (total === 0) continue
    const mergedHex = rgbToHex({ r: Math.round(r / total), g: Math.round(g / total), b: Math.round(b / total) })
    for (const [hex] of center.members) map.set(hex, mergedHex)
    palette.push({ hex: mergedHex, count: total })
  }
  return { map, palette: palette.sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)) }
}

function parseHexRgb(hex: string): Rgb | null {
  if (hex.length !== 7) return null
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  return { r, g, b }
}

/**
 * 逐格取色 + 近色归并。
 * `background`：与它同色（且格内无文字）的格子算空位；null = 不按背景判空。
 */
export function sampleGrid(
  img: RgbaImage,
  geometry: GridGeometry,
  opts: { readonly background: Rgb | null; readonly mergeTolerance?: number; readonly backgroundToEmpty?: boolean },
): SampleOutcome {
  const { cols, rows, left, top, cellW, cellH } = geometry
  const samples: CellSample[] = []
  const counts = new Map<string, number>()
  let emptyCells = 0
  let whiteBeads = 0
  let uniformSum = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round(left + c * cellW)
      const y0 = Math.round(top + r * cellH)
      const x1 = Math.round(left + (c + 1) * cellW)
      const y1 = Math.round(top + (r + 1) * cellH)
      const cell = sampleCell(img, x0, y0, x1, y1)
      uniformSum += cell.uniformity
      let hex = cell.hex
      if (hex !== null && cell.text && hex === '#ffffff') whiteBeads++
      if (hex !== null && opts.backgroundToEmpty !== false && opts.background !== null && !cell.text) {
        const rgb = parseHexRgb(hex)
        if (rgb !== null && channelDistance(rgb, opts.background) <= 22) hex = null
      }
      if (hex === null) emptyCells++
      else counts.set(hex, (counts.get(hex) ?? 0) + 1)
      samples.push({ hex, text: cell.text, uniformity: cell.uniformity })
    }
  }
  const tolerance = Math.max(0, Math.min(80, Math.round(opts.mergeTolerance ?? 18)))
  const merged = mergeNearColors(counts, tolerance)
  const cells: Array<string | null> = samples.map((c) => (c.hex === null ? null : (merged.map.get(c.hex) ?? c.hex)))
  const palette = new Map<string, number>()
  for (const hex of cells) if (hex !== null) palette.set(hex, (palette.get(hex) ?? 0) + 1)
  const uniformity = samples.length === 0 ? 0 : uniformSum / samples.length
  const warnings: string[] = []
  if (uniformity < 0.62) warnings.push('格内颜色不一致（可能是符号/色号图纸或拍照倾斜）：参考 AI 识别结果，或手动核对行列')
  if (whiteBeads > 0) warnings.push(`检测到 ${whiteBeads} 格"白底 + 色号"的白色豆：按白豆处理（纯白无文字的格子才是空位）`)
  if (palette.size > 48) warnings.push(`归并后仍有 ${palette.size} 种颜色：可以调高"颜色归并"阈值再试`)
  return {
    grid: { cols, rows, cells },
    palette: [...palette.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)),
    emptyCells,
    uniformity,
    warnings,
  }
}