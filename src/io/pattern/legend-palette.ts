// 图例色卡提取：图纸底部的一排色卡（代码 + 色块 + 数量）。
//
// 色卡是**大块纯色**（远大于 9–14px 的图纸格子），比格子里的底色好取：先找到这一排，再把每个
// 方块的内缩区域取中位色，就得到图纸使用的**精确调色板**。之后每格像素"投票"到最近的调色板颜色，
// 色号文字/水印/JPEG 噪声就不再影响色调（投票是众数，均值才会被拉偏），两张不同来源的同一张图纸
// 也能得到一致的颜色。
import { canonicalHex, rgbToHex } from '../../core/color'
import { channelDistance, pixelAt } from './types'
import type { RgbaImage } from './types'

export interface LegendPalette {
  /** 去重后的色卡颜色（规范 HEX） */
  readonly colors: ReadonlyArray<string>
  /** 色卡条上沿（用于把图例从识别范围里裁掉） */
  readonly top: number
}

const MIN_BLOCK_W = 8
const MAX_BLOCK_W = 70
const MIN_BLOCK_H = 10
const MAX_BLOCK_H = 60
const MIN_BLOCKS = 6
const MAX_GAP = 50

/** 纸白（色卡之间的间隔 / 图纸空白）：很亮且几乎无彩度 */
const isPaper = (r: number, g: number, b: number): boolean => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  // JPEG 会把纯白间隔压到 245 左右；色卡里的浅色（如奶油 #f9f1c8）min 通道 ~200，不会被误判
  return mn >= 232 && mx - mn <= 14
}

interface Block {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
  readonly color: string
  readonly uniformity: number
}

/** 单行扫描：非纸白色的横向连续段，再纵向扩展成"色块" */
function blocksAtRow(img: RgbaImage, y: number): Block[] {
  const runs: Array<{ x0: number; x1: number; color: string }> = []
  let x = 0
  while (x < img.width) {
    const p = pixelAt(img, x, y)
    if (isPaper(p.r, p.g, p.b)) {
      x++
      continue
    }
    const x0 = x
    while (x < img.width) {
      const q = pixelAt(img, x, y)
      if (isPaper(q.r, q.g, q.b)) break
      x++
    }
    const x1 = x - 1
    const w = x1 - x0 + 1
    if (w < MIN_BLOCK_W || w > MAX_BLOCK_W) continue
    const c = pixelAt(img, Math.round((x0 + x1) / 2), y)
    runs.push({ x0, x1, color: rgbToHex({ r: c.r, g: c.g, b: c.b }) })
  }
  if (runs.length < MIN_BLOCKS) return []
  for (let i = 1; i < runs.length; i++) if (runs[i]!.x0 - runs[i - 1]!.x1 > MAX_GAP) return []
  const blocks: Block[] = []
  for (const run of runs) {
    const w = run.x1 - run.x0 + 1
    const cx = Math.round((run.x0 + run.x1) / 2)
    const center = pixelAt(img, cx, y)
    const similar = (yy: number): boolean => {
      if (yy < 0 || yy >= img.height) return false
      let hit = 0
      let total = 0
      for (let xx = run.x0 + 1; xx < run.x1; xx++) {
        total++
        const p2 = pixelAt(img, xx, yy)
        if (channelDistance(p2, center) <= 50) hit++
      }
      return total > 0 && hit / total >= 0.6
    }
    let y0 = y
    let y1 = y
    let miss = 0
    while (y0 > 0) {
      if (similar(y0 - 1)) {
        y0--
        miss = 0
      } else if (++miss > 2) break
      else y0--
    }
    miss = 0
    while (y1 < img.height - 1) {
      if (similar(y1 + 1)) {
        y1++
        miss = 0
      } else if (++miss > 2) break
      else y1++
    }
    const h = y1 - y0 + 1
    if (h < MIN_BLOCK_H || h > MAX_BLOCK_H) continue
    const ix = Math.max(1, Math.round(w * 0.2))
    const iy = Math.max(1, Math.round(h * 0.2))
    const rs: number[] = []
    const gs: number[] = []
    const bs: number[] = []
    for (let yy = y0 + iy; yy <= y1 - iy; yy++) {
      for (let xx = run.x0 + ix; xx <= run.x1 - ix; xx++) {
        const p2 = pixelAt(img, xx, yy)
        rs.push(p2.r)
        gs.push(p2.g)
        bs.push(p2.b)
      }
    }
    if (rs.length === 0) continue
    const med = (vals: number[]): number => {
      const s = [...vals].sort((a, b) => a - b)
      return s[s.length >> 1] ?? 0
    }
    const fill = { r: med(rs), g: med(gs), b: med(bs) }
    let uniform = 0
    for (let i = 0; i < rs.length; i++) {
      if (Math.max(Math.abs(rs[i]! - fill.r), Math.abs(gs[i]! - fill.g), Math.abs(bs[i]! - fill.b)) <= 30) uniform++
    }
    blocks.push({ x0: run.x0, x1: run.x1, y0, y1, color: rgbToHex(fill), uniformity: uniform / rs.length })
  }
  return blocks
}

/** 颜色去重（容差内视为同色） */
export function dedupeColors(colors: ReadonlyArray<string>, tolerance = 14): string[] {
  const out: string[] = []
  for (const hex of colors) {
    const c = canonicalHex(hex) ?? hex
    const rgb = { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) }
    const dup = out.some((h) => {
      const o = { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }
      return channelDistance(o, rgb) <= tolerance
    })
    if (!dup) out.push(c)
  }
  return out
}

/**
 * 提取图例色卡（单行/多行都会合并）。找不到 ⇒ null（取样退回"边圈 + 众数"经验法）。
 */
export function extractLegendPalette(img: RgbaImage): LegendPalette | null {
  const startY = Math.floor(img.height * 0.6)
  let best: { blocks: Block[] } | null = null
  let bestDistinct = 0
  for (let y = startY; y < img.height; y++) {
    const blocks = blocksAtRow(img, y)
    if (blocks.length === 0) continue
    const solid = blocks.filter((b) => b.uniformity >= 0.85)
    // eslint-disable-next-line no-console
    if ((globalThis as { __LEGEND_DEBUG__?: boolean }).__LEGEND_DEBUG__ === true) console.log('[legend]', y, 'blocks', blocks.length, 'solid', solid.length, 'heights', blocks.slice(0, 4).map((b) => b.y1 - b.y0 + 1))
    if (solid.length < MIN_BLOCKS) continue
    const distinct = dedupeColors(solid.map((b) => b.color), 15)
    if (distinct.length < MIN_BLOCKS) continue
    if (distinct.length > bestDistinct) {
      bestDistinct = distinct.length
      best = { blocks: solid }
    }
    y = Math.max(...solid.map((b) => b.y1))
  }
  if (best === null) return null
  const colors = dedupeColors(best.blocks.map((b) => b.color), 12)
  if (colors.length < MIN_BLOCKS) return null
  return { colors, top: Math.min(...best.blocks.map((b) => b.y0)) }
}