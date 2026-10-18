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

/** 四角小方块的边长占比（格内 28%，上限 6px） */
const CORNER_RATIO = 0.28
const CORNER_MAX = 6
/** 角块取样内缩：躲开 1px 格线与抗锯齿 */
const INSET = 2
/** 中心区文字判定：与填充明度相反的那一端像素占比 */
const TEXT_RATIO = 0.03

interface CellSample {
  /** 格子填充色（null = 空位） */
  readonly hex: string | null
  /** 中心区是否有色号文字（用于区分"白豆"与"空白纸"） */
  readonly text: boolean
  /** 角块众数色的占比（0–1）——低 = 格内有多种颜色（拍照/倾斜） */
  readonly uniformity: number
}

const bucketKey = (r: number, g: number, b: number): number => (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)

/** 逐格取样：角块众数色（填充色）+ 中心区文字检测 */
function sampleCell(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): CellSample {
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return { hex: null, text: false, uniformity: 0 }
  if (w < 6 || h < 6) {
    const p = pixelAt(img, Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2))
    if (p.a < 32) return { hex: null, text: false, uniformity: 1 }
    return { hex: rgbToHex(p), text: false, uniformity: 1 }
  }
  const patch = Math.max(2, Math.min(CORNER_MAX, Math.round(Math.min(w, h) * CORNER_RATIO)))
  const corners: Array<[number, number]> = [
    [x0 + INSET, y0 + INSET],
    [x1 - patch - INSET, y0 + INSET],
    [x0 + INSET, y1 - patch - INSET],
    [x1 - patch - INSET, y1 - patch - INSET],
  ]
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>()
  let samples = 0
  for (const [bx, by] of corners) {
    for (let y = by; y < by + patch; y++) {
      for (let x = bx; x < bx + patch; x++) {
        const p = pixelAt(img, x, y)
        samples++
        if (p.a < 32) continue
        const k = bucketKey(p.r, p.g, p.b)
        const cur = hist.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
        cur.n++
        cur.r += p.r
        cur.g += p.g
        cur.b += p.b
        hist.set(k, cur)
      }
    }
  }
  if (samples === 0) return { hex: null, text: false, uniformity: 0 }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const v of hist.values()) if (best === null || v.n > best.n) best = v
  if (best === null) return { hex: null, text: false, uniformity: 0 }
  const fill: Rgb = { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) }
  const uniformity = best.n / samples
  const lum = (fill.r + fill.g + fill.b) / 3
  const spread = Math.max(fill.r, fill.g, fill.b) - Math.min(fill.r, fill.g, fill.b)
  // 中心区：与填充明度相反的一端出现得足够多 ⇒ 有文字
  let dark = 0
  let light = 0
  let total = 0
  const cx0 = x0 + Math.round(w * 0.3)
  const cx1 = x1 - Math.round(w * 0.3)
  const cy0 = y0 + Math.round(h * 0.25)
  const cy1 = y1 - Math.round(h * 0.25)
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const p = pixelAt(img, x, y)
      if (p.a < 32) continue
      total++
      const mx = Math.max(p.r, p.g, p.b)
      const mn = Math.min(p.r, p.g, p.b)
      if (mx < 130) dark++
      if (mn > 235) light++
    }
  }
  const ratio = total === 0 ? 0 : lum < 128 ? light / total : dark / total
  const text = ratio >= TEXT_RATIO
  // "纸白"：亮度高且几乎无彩度（JPEG 抖动会让白格落在 235–255，不能要求三通道都 ≥243；
  //  米白豆（如 #fbf2ec）彩度差 15 ⇒ 不算纸白，仍是内容）
  const nearWhite = lum >= 235 && spread <= 12
  if (nearWhite) {
    return text ? { hex: '#ffffff', text: true, uniformity } : { hex: null, text: false, uniformity }
  }
  return { hex: rgbToHex(fill), text, uniformity }
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