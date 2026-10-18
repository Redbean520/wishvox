// 逐格取色（纯函数）：按几何把每一格内部的像素取中位色，再把近色归并成同一色板条目。
//
// 三个"不猜"的细节：
// ① 取**格内中心 50%** 的像素（避开格线 / 边缘抗锯齿），格太小（<3px）退化成中心像素；
// ② 用**中位色**而不是平均色：抗锯齿的边、格角噪点不会把颜色拉偏；
// ③ 与背景同色 / 全透明的格子 `null`（空位）——空位不摆块，这是拼豆"白色是纸还是白豆"的分界，
//    面板上可关掉（`backgroundToEmpty: false` = 白色也当白豆）。
//
// 近色归并 = 单遍 leader 聚类（按出现次数从多到少当中心，最大通道差 ≤ tolerance 归入）：
// 图纸色板常见的"同一色号因压缩略有偏差"由此收敛，但不会把两种明显不同的颜色并掉。

import { rgbToHex } from '../../core/color'
import { channelDistance, pixelAt } from './types'
import type { GridGeometry, PatternColorStat, PatternGrid, RgbaImage, Rgb } from './types'

/** 一个格子内部的取样结论 */
interface CellSample {
  readonly hex: string | null
  /** 格内像素与中位色一致的占比（0–1）——低 = 符号图纸 / 拍照倾斜 */
  readonly uniformity: number
}

export interface SampleOutcome {
  readonly grid: PatternGrid
  readonly palette: ReadonlyArray<PatternColorStat>
  readonly emptyCells: number
  /** 平均格内一致性（0–1） */
  readonly uniformity: number
  readonly warnings: ReadonlyArray<string>
}

/** 中位色（各通道分别取中位数；samples 非空） */
function medianColor(samples: ReadonlyArray<Rgb>): Rgb {
  const pick = (vals: number[]): number => {
    vals.sort((a, b) => a - b)
    const mid = vals.length >> 1
    return vals.length % 2 === 0 ? Math.round((vals[mid - 1]! + vals[mid]!) / 2) : vals[mid]!
  }
  return { r: pick(samples.map((s) => s.r)), g: pick(samples.map((s) => s.g)), b: pick(samples.map((s) => s.b)) }
}

/** 格内取样：中心 50% 区域；返回 null = 整格透明（空位候选） */
function sampleCell(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): CellSample {
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return { hex: null, uniformity: 0 }
  // 中心 50%：左右上下各收 25%（格 <3px 时退化为 1 像素中心）
  const ix = w >= 3 ? Math.max(1, Math.floor(w * 0.25)) : 0
  const iy = h >= 3 ? Math.max(1, Math.floor(h * 0.25)) : 0
  const pts: Rgb[] = []
  let transparent = 0
  let total = 0
  for (let y = y0 + iy; y < y1 - iy; y++) {
    for (let x = x0 + ix; x < x1 - ix; x++) {
      const p = pixelAt(img, x, y)
      total++
      if (p.a < 32) {
        transparent++
        continue
      }
      pts.push({ r: p.r, g: p.g, b: p.b })
    }
  }
  if (total === 0 || pts.length === 0) return { hex: null, uniformity: 1 }
  const med = medianColor(pts)
  let agree = 0
  for (const p of pts) if (channelDistance(p, med) <= 22) agree++
  return { hex: rgbToHex(med), uniformity: agree / total }
}

/** 近色归并：返回 原色 → 归并后中心色 的映射 + 色板统计 */
function mergeNearColors(
  counts: ReadonlyMap<string, number>,
  tolerance: number,
): { map: ReadonlyMap<string, string>; palette: PatternColorStat[] } {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const centers: Array<{ rgb: Rgb; members: string[] }> = []
  const map = new Map<string, string>()
  for (const [hex, count] of entries) {
    const rgb = parseHexRgb(hex)
    if (rgb === null) continue
    let target = centers.find((c) => channelDistance(c.rgb, rgb) <= tolerance)
    if (target === undefined) {
      target = { rgb, members: [] }
      centers.push(target)
    }
    target.members.push(hex)
    void count
  }
  const palette: PatternColorStat[] = []
  for (const center of centers) {
    // 中心色 = 成员按格数加权平均（四舍五入），再把成员逐个映射过去
    let r = 0
    let g = 0
    let b = 0
    let total = 0
    for (const hex of center.members) {
      const rgb = parseHexRgb(hex)
      if (rgb === null) continue
      const n = counts.get(hex) ?? 0
      r += rgb.r * n
      g += rgb.g * n
      b += rgb.b * n
      total += n
    }
    if (total === 0) continue
    const mergedHex = rgbToHex({ r: Math.round(r / total), g: Math.round(g / total), b: Math.round(b / total) })
    for (const hex of center.members) map.set(hex, mergedHex)
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
 * `background`：与它同色（阈值 28）的格子算空位；null = 不按背景判空。
 */
export function sampleGrid(
  img: RgbaImage,
  geometry: GridGeometry,
  opts: { readonly background: Rgb | null; readonly mergeTolerance?: number; readonly backgroundToEmpty?: boolean },
): SampleOutcome {
  const { cols, rows, left, top, cellW, cellH } = geometry
  const raw: Array<CellSample> = []
  const counts = new Map<string, number>()
  let emptyCells = 0
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
      if (hex !== null && opts.backgroundToEmpty !== false && opts.background !== null) {
        const rgb = parseHexRgb(hex)
        if (rgb !== null && channelDistance(rgb, opts.background) <= 22) hex = null
      }
      if (hex === null) emptyCells++
      else counts.set(hex, (counts.get(hex) ?? 0) + 1)
      raw.push({ hex, uniformity: cell.uniformity })
    }
  }
  const tolerance = Math.max(0, Math.min(80, Math.round(opts.mergeTolerance ?? 18)))
  const merged = mergeNearColors(counts, tolerance)
  const cells: Array<string | null> = raw.map((c) => (c.hex === null ? null : (merged.map.get(c.hex) ?? c.hex)))
  const palette = new Map<string, number>()
  for (const hex of cells) if (hex !== null) palette.set(hex, (palette.get(hex) ?? 0) + 1)
  const uniformity = raw.length === 0 ? 0 : uniformSum / raw.length
  const warnings: string[] = []
  if (uniformity < 0.62) warnings.push('格内颜色不一致（可能是符号/色号图纸或拍照倾斜）：参考 AI 识别结果，或手动核对行列')
  if (palette.size > 48) warnings.push(`归并后仍有 ${palette.size} 种颜色：可以调高"颜色归并"阈值再试`)
  return {
    grid: { cols, rows, cells },
    palette: [...palette.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)),
    emptyCells,
    uniformity,
    warnings,
  }
}