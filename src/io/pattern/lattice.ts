// 格线定位（印刷图纸的第二条几何通道）：图上画了格子线时，直接找"线"比找"周期色差"更准。
//
// 为什么需要第二条通道：带色号文字的图纸（拼豆软件导出的图纸）格内密布文字，边界/内部色差都很大，
// "内部要平"的周期判据必然失败（`detect.ts` 会退回 1 像素/格或直接报错）。而这类图纸几乎都画了
// **1px 的浅灰格线**——格线是"与左右邻居都不同"的细长竖向结构，与文字、色块都能区分开。
//
// 做法：
//   ① 逐列统计"与左右邻居色差都 > 阈值"的像素数 ⇒ 线度量；
//   ② 用线度量做梳状拟合（周期 + 相位），得到格边长；
//   ③ 取连续存在格线的一段作为网格范围；
//   ④ 裁掉首/末的"标尺行"（整行是白底 + 数字/色号，用来标列号 1..N）——它不是图案的一部分。
import { PATTERN_LIMITS } from './types'
import type { RgbaImage } from './types'
import { channelDistance, pixelAt } from './types'

/** "与邻居色差都超过它"才算线像素（JPEG 噪点约 ≤6） */
const LINE_PIXEL_TOL = 8
/** 线度量低于它视为没有格线 */
const MIN_LINE_SCORE = 8
/** 格线位置判定：达到本次最佳梳状得分的这个比例 */
const LINE_PRESENCE_RATIO = 0.45

export interface LatticeGeometry {
  readonly left: number
  readonly top: number
  readonly cell: number
  readonly cols: number
  readonly rows: number
  /** 梳状拟合的平均线强度（越大越可信） */
  readonly score: number
}

/** 逐列/逐行的"线像素"计数 */
function lineMetrics(img: RgbaImage): { columns: Int32Array; rows: Int32Array } {
  const columns = new Int32Array(img.width)
  const rows = new Int32Array(img.height)
  for (let x = 1; x < img.width - 1; x++) {
    let n = 0
    for (let y = 0; y < img.height; y++) {
      const c = pixelAt(img, x, y)
      if (Math.min(channelDistance(c, pixelAt(img, x - 1, y)), channelDistance(c, pixelAt(img, x + 1, y))) > LINE_PIXEL_TOL) n++
    }
    columns[x] = n
  }
  for (let y = 1; y < img.height - 1; y++) {
    let n = 0
    for (let x = 0; x < img.width; x++) {
      const c = pixelAt(img, x, y)
      if (Math.min(channelDistance(c, pixelAt(img, x, y - 1)), channelDistance(c, pixelAt(img, x, y + 1))) > LINE_PIXEL_TOL) n++
    }
    rows[y] = n
  }
  return { columns, rows }
}

const maxOf = (arr: Int32Array): number => {
  let m = 0
  for (const v of arr) if (v > m) m = v
  return m
}

/**
 * 用自相关估格边长：格线在度量曲线里是等距脉冲 ⇒ 自相关在"格边长"及其整数倍处出峰。
 * 取**最小的强峰**（≈1 倍格长），再用梳状拟合精修到亚像素。
 * 不用"相邻峰间距中位数"：文字/标尺会产生大量伪峰，中位数会被拖到 5px 这类噪声值。
 */
function autocorrelationPitch(score: ArrayLike<number>): number | null {
  const n = score.length
  if (n < 8) return null
  let mean = 0
  for (let i = 0; i < n; i++) mean += score[i]!
  mean /= n
  const centered = new Float64Array(n)
  for (let i = 0; i < n; i++) centered[i] = score[i]! - mean
  const maxLag = Math.min(60, Math.floor(n / 2))
  const corr = new Float64Array(maxLag + 1)
  let bestLag = 0
  let bestValue = 0
  for (let lag = 4; lag <= maxLag; lag++) {
    let sum = 0
    let a = 0
    let b = 0
    for (let i = 0; i + lag < n; i++) {
      sum += centered[i]! * centered[i + lag]!
      a += centered[i]! * centered[i]!
      b += centered[i + lag]! * centered[i + lag]!
    }
    const denom = Math.sqrt(a * b)
    const r = denom === 0 ? 0 : sum / denom
    corr[lag] = r
    if (r > bestValue) {
      bestValue = r
      bestLag = lag
    }
  }
  if (bestLag === 0 || bestValue < 0.3) return null
  const threshold = Math.max(0.35, bestValue * 0.7)
  for (let lag = 4; lag <= maxLag; lag++) {
    if ((corr[lag] ?? 0) >= threshold) return lag
  }
  return bestLag
}

/** 梳状拟合：在候选周期附近找使"格线位置线度量最大"的 (period, phase) */
function fitComb(score: Int32Array, p0: number): { period: number; phase: number; avg: number } | null {
  let best: { period: number; phase: number; avg: number } | null = null
  for (let p = p0 * 0.85; p <= p0 * 1.15; p += 0.02) {
    for (let phase = 0; phase < p; phase += 0.25) {
      let sum = 0
      let n = 0
      for (let x = phase; x < score.length; x += p) {
        const i = Math.round(x)
        let v = 0
        for (let k = -1; k <= 1; k++) v = Math.max(v, score[i + k] ?? 0)
        sum += v
        n++
      }
      if (n < 2) continue
      const avg = sum / n
      if (best === null || avg > best.avg) best = { period: p, phase, avg }
    }
  }
  return best
}

/** 精修：把梳状拟合的"理论位置"吸附到实际线像素，再最小二乘重估 period/phase */
function refineLattice(score: Int32Array, period: number, phase: number, threshold: number): { period: number; phase: number; positions: number[] } {
  const positions: number[] = []
  const ks: number[] = []
  for (let k = 0; ; k++) {
    const expect = phase + k * period
    if (expect >= score.length + 3) break
    const center = Math.round(expect)
    let bestJ = -1
    let bestV = 0
    for (let j = center - 3; j <= center + 3; j++) {
      if (j <= 0 || j >= score.length - 1) continue
      const v = score[j]!
      if (v > bestV) {
        bestV = v
        bestJ = j
      }
    }
    if (bestJ >= 0 && bestV >= threshold) {
      positions.push(bestJ)
      ks.push(k)
    }
  }
  if (positions.length < 3) return { period, phase, positions }
  // 最小二乘：pos ≈ phase + k·period
  const n = ks.length
  let sumK = 0
  let sumP = 0
  let sumKK = 0
  let sumKP = 0
  for (let i = 0; i < n; i++) {
    sumK += ks[i]!
    sumP += positions[i]!
    sumKK += ks[i]! * ks[i]!
    sumKP += ks[i]! * positions[i]!
  }
  const denom = n * sumKK - sumK * sumK
  if (denom === 0) return { period, phase, positions }
  const p = (n * sumKP - sumK * sumP) / denom
  const phi = (sumP - p * sumK) / n
  // 第二遍：用重估后的 (p, φ) 覆盖整幅图重新吸附（避免粗周期偏一点导致末端格线被漏掉）
  const second: number[] = []
  for (let k = -2; ; k++) {
    const expect = phi + k * p
    if (expect > score.length + 3) break
    if (expect < -3) continue
    const center = Math.round(expect)
    let bestJ = -1
    let bestV = 0
    for (let j = center - 3; j <= center + 3; j++) {
      if (j <= 0 || j >= score.length - 1) continue
      const v = score[j]!
      if (v > bestV) {
        bestV = v
        bestJ = j
      }
    }
    if (bestJ >= 0 && bestV >= threshold) second.push(bestJ)
  }
  return { period: p, phase: phi, positions: second.length >= positions.length ? second : positions }
}

type CellKind = 'empty' | 'label' | 'content'

/**
 * 单格分类：空位 / 标尺（白底数字）/ 内容（彩色或深色块）。
 * 判据与 `sample.ts` 同源：四角处填充色的众数 = 底色；中心区深色像素 = 文字。
 */
function classifyCell(img: RgbaImage, x0: number, y0: number, cell: number): CellKind {
  const size = Math.round(cell)
  const x1 = x0 + size
  const y1 = y0 + size
  if (x1 > img.width || y1 > img.height) return 'content'
  const patch = Math.max(2, Math.min(6, Math.round(size * 0.28)))
  const corners: Array<[number, number]> = [
    [x0 + 2, y0 + 2],
    [x1 - patch - 2, y0 + 2],
    [x0 + 2, y1 - patch - 2],
    [x1 - patch - 2, y1 - patch - 2],
  ]
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const [bx, by] of corners) {
    for (let y = by; y < by + patch; y++) {
      for (let x = bx; x < bx + patch; x++) {
        const p = pixelAt(img, x, y)
        const k = (p.r >> 4) * 256 + (p.g >> 4) * 16 + (p.b >> 4)
        const cur = hist.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
        cur.n++
        cur.r += p.r
        cur.g += p.g
        cur.b += p.b
        hist.set(k, cur)
      }
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const v of hist.values()) if (best === null || v.n > best.n) best = v
  if (best === null) return 'empty'
  const fr = best.r / best.n
  const fg = best.g / best.n
  const fb = best.b / best.n
  const spread = Math.max(fr, fg, fb) - Math.min(fr, fg, fb)
  const nearWhite = (fr + fg + fb) / 3 >= 235 && spread <= 12
  if (!nearWhite) return 'content'
  const cx0 = x0 + Math.round(size * 0.3)
  const cx1 = x1 - Math.round(size * 0.3)
  const cy0 = y0 + Math.round(size * 0.25)
  const cy1 = y1 - Math.round(size * 0.25)
  let dark = 0
  let total = 0
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const p = pixelAt(img, x, y)
      total++
      if (Math.max(p.r, p.g, p.b) < 130) dark++
    }
  }
  return total > 0 && dark / total >= 0.03 ? 'label' : 'empty'
}

/**
 * 标尺条：图纸四周那圈画着行列号的深色条（本图里是 #786464 左右的棕灰）。
 * 判据 = 边带内的格子绝大多数是"边框色"（从内侧边距取样得到），且边框色是低彩度中调色。
 * 图案行也会贴着边距，但格内是豆子颜色而不是边框色 —— 这条把"标尺条"与"图案行"分开。
 */
function bandIsRulerBar(img: RgbaImage, axis: 'row' | 'col', bandStart: number, cell: number, from: number, to: number): boolean {
  const size = Math.round(cell)
  const center = Math.round(bandStart + cell / 2)
  const probe = axis === 'row' ? pixelAt(img, 4, center) : pixelAt(img, center, 4)
  const lum = (probe.r + probe.g + probe.b) / 3
  const spread = Math.max(probe.r, probe.g, probe.b) - Math.min(probe.r, probe.g, probe.b)
  if (lum < 40 || lum > 190 || spread > 30) return false
  let same = 0
  let total = 0
  for (let pos = from; pos + cell <= to + 0.5; pos += cell) {
    const p = Math.round(pos)
    const x0 = axis === 'row' ? p : Math.round(bandStart)
    const y0 = axis === 'row' ? Math.round(bandStart) : p
    // 取格内角块的平均色（与 classifyCell 同源，避免文字干扰）
    const px = pixelAt(img, x0 + 3, y0 + 3)
    const py = pixelAt(img, x0 + size - 4, y0 + size - 4)
    const r = (px.r + py.r) / 2
    const g = (px.g + py.g) / 2
    const b = (px.b + py.b) / 2
    total++
    if (Math.max(Math.abs(r - probe.r), Math.abs(g - probe.g), Math.abs(b - probe.b)) <= 22) same++
  }
  return total > 0 && same / total >= 0.8
}

/** 一整行/列是否"可裁"（全部空位 / 标尺文字 / 标尺条） */
function bandTrimmable(img: RgbaImage, axis: 'row' | 'col', bandStart: number, cell: number, from: number, to: number): boolean {
  if (bandIsRulerBar(img, axis, bandStart, cell, from, to)) return true
  for (let pos = from; pos + cell <= to + 0.5; pos += cell) {
    const p = Math.round(pos)
    const x0 = axis === 'row' ? p : Math.round(bandStart)
    const y0 = axis === 'row' ? Math.round(bandStart) : p
    // 只有"全空白"才裁；白底带字的格子可能是**白豆**（H2 之类），不能当标尺裁掉
    if (classifyCell(img, x0, y0, cell) !== 'empty') return false
  }
  return true
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
  if (right - left < cell * 2 || bottom - top < cell * 2) return null
  // 裁边界：标尺行（顶部列号 "1 2 3 …"）、图例行、以及四周的空白行/列。
  // 只裁"全空位 / 全标尺"的边带 ⇒ 图案本体一格不丢（空白边带本来就不摆块）。
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