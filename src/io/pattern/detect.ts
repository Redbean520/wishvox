// 网格几何检测：从一张图纸图片估计"左上角 / 方格边长 / 行列数"。
//
// 做法（纯函数，可无头测试）：把图纸看成两条一维"边界强度"曲线——
//   列边界强度 `edgeX[x]` = 相邻两列像素在整幅高度上的平均色差；行边界同理。
// 规则网格 ⇒ 这两条曲线是**周期信号**：周期 = 方格边长。于是：
//   ① 对每个候选边长 s，找"最佳相位 φ"（让 φ、φ+s、φ+2s… 落在色差最大的位置），
//      得分 = 边界处平均色差 / 全局平均色差（≈1 = 与随机位置无异，>1.35 = 明显周期）；
//   ② 选**最小**的强周期 s（避免把 2 格当成 1 格）；
//   ③ 若整图没有强周期：≤128×128 时按"1 像素 = 1 格"兜底（原生像素图纸），否则报错让用户手动填行列。
//
// 不依赖格线颜色 / 不依赖纸张为白：只看相邻像素的变化。所以彩色格子图纸、带格线的图纸都适用；
// 符号图纸（格内是数字/符号）会检出网格但取色意义不大——那一路交给 AI 视觉（`ai/pattern-vision.ts`）。

import { PATTERN_LIMITS } from './types'
import type { GridGeometry, RecognizeOptions, RgbaImage, Rgb } from './types'
import { channelDistance, pixelAt } from './types'
import { detectByLattice } from './lattice'

/** 背景色判定阈值（最大通道差）：四边取样的颜色都在它以内 ⇒ 认为是同一种纸质背景 */
const BG_UNIFORM_TOL = 8
/** 裁剪边缘时允许的背景色差 */
const TRIM_TOL = 28
/** 单边最多裁掉的比例：留白之外可能紧挨着"整列同色的图案格"，不设上限会把它们当留白吃掉 */
const MAX_TRIM_RATIO = 0.2
/** 周期得分门槛：边界处平均色差至少是全局平均的 1.35 倍 */
const PERIOD_SCORE_MIN = 1.35
/** 格子内部平均色差 / 全局平均色差的上限：超过它 ⇒ 这个周期把真实格线切进了"格子内部"（多半是 2 倍格长） */
const INTERIOR_SCORE_MAX = 0.5

export type DetectOutcome =
  | {
      readonly ok: true
      readonly geometry: GridGeometry
      readonly background: Rgb | null
      readonly warnings: ReadonlyArray<string>
    }
  | { readonly ok: false; readonly reason: string }

interface Region {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

const clampInt = (v: number, lo: number, hi: number): number => Math.min(Math.max(Math.round(v), lo), hi)

/**
 * 背景色判定：**整圈边框**里绝大多数像素同色才算"纸"。
 * 只看四角/四边中点会被"一半红一半蓝"的窄图骗过（把两种颜色都当背景 ⇒ 全图判空），
 * 所以这里取边框像素的中位色，并要求 ≥90% 的边框像素在容差内。
 */
function borderBackground(img: RgbaImage): Rgb | null {
  const samples: Array<Rgb & { a: number }> = []
  for (let x = 0; x < img.width; x++) {
    samples.push(pixelAt(img, x, 0), pixelAt(img, x, img.height - 1))
  }
  for (let y = 0; y < img.height; y++) {
    samples.push(pixelAt(img, 0, y), pixelAt(img, img.width - 1, y))
  }
  if (samples.length === 0 || samples.some((p) => p.a < 200)) return null
  const pick = (vals: number[]): number => {
    vals.sort((a, b) => a - b)
    return vals[vals.length >> 1]!
  }
  const med: Rgb = { r: pick(samples.map((s) => s.r)), g: pick(samples.map((s) => s.g)), b: pick(samples.map((s) => s.b)) }
  let agree = 0
  for (const p of samples) if (channelDistance(p, med) <= BG_UNIFORM_TOL) agree++
  if (agree / samples.length < 0.9) return null
  return med
}

const isBgColor = (p: { r: number; g: number; b: number; a: number }, bg: Rgb, tol: number): boolean =>
  p.a >= 200 && channelDistance(p, bg) <= tol

/** 裁掉四周"整行/整列都是背景色"的边（图纸留白）。最多裁到剩 1 像素高/宽。 */
function trimUniformBorder(img: RgbaImage, bg: Rgb): Region {
  let left = 0
  let top = 0
  let right = img.width
  let bottom = img.height
  const maxTrimX = Math.floor(img.width * MAX_TRIM_RATIO)
  const maxTrimY = Math.floor(img.height * MAX_TRIM_RATIO)
  const rowIsBg = (y: number): boolean => {
    for (let x = left; x < right; x++) if (!isBgColor(pixelAt(img, x, y), bg, TRIM_TOL)) return false
    return true
  }
  const colIsBg = (x: number): boolean => {
    for (let y = top; y < bottom; y++) if (!isBgColor(pixelAt(img, x, y), bg, TRIM_TOL)) return false
    return true
  }
  while (top < bottom - 1 && top < maxTrimY && rowIsBg(top)) top++
  while (bottom > top + 1 && img.height - bottom < maxTrimY && rowIsBg(bottom - 1)) bottom--
  while (left < right - 1 && left < maxTrimX && colIsBg(left)) left++
  while (right > left + 1 && img.width - right < maxTrimX && colIsBg(right - 1)) right--
  return { left, top, right, bottom }
}

/** 列边界强度（下标 0 对应 left+1 与 left 之间） */
function columnEdges(img: RgbaImage, r: Region): Float64Array {
  const n = Math.max(0, r.right - r.left - 1)
  const out = new Float64Array(n)
  const h = Math.max(1, r.bottom - r.top)
  for (let x = r.left + 1; x < r.right; x++) {
    let sum = 0
    for (let y = r.top; y < r.bottom; y++) sum += channelDistance(pixelAt(img, x - 1, y), pixelAt(img, x, y))
    out[x - r.left - 1] = sum / h
  }
  return out
}

/** 行边界强度（下标 0 对应 top+1 与 top 之间） */
function rowEdges(img: RgbaImage, r: Region): Float64Array {
  const n = Math.max(0, r.bottom - r.top - 1)
  const out = new Float64Array(n)
  const w = Math.max(1, r.right - r.left)
  for (let y = r.top + 1; y < r.bottom; y++) {
    let sum = 0
    for (let x = r.left; x < r.right; x++) sum += channelDistance(pixelAt(img, x, y - 1), pixelAt(img, x, y))
    out[y - r.top - 1] = sum / w
  }
  return out
}

const mean = (arr: ArrayLike<number>): number => {
  if (arr.length === 0) return 0
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i]!
  return s / arr.length
}

/** 候选周期在某相位下的两个读数：边界强度（越大越像格线）/ 内部强度（越小越像格子内部） */
interface PhaseStats {
  readonly phase: number
  readonly boundaryScore: number
  readonly interiorScore: number
}

/**
 * 相位统计。`profile[i]` 是"region.left+i 与 +1 之间"的色差 ⇒ 下标 ≡ phase (mod s) 的位置是
 * 候选格线；其余位置是**格子内部**。正确格长的判据不是"边界最强"，而是
 * "**边界强 + 内部平**"——只比边界强度会系统性地偏向 2 倍格长（两格一格时边界也强，
 * 但它的"内部"横穿一条真实格线）。
 */
function phaseStats(profile: ArrayLike<number>, s: number): PhaseStats {
  const overall = mean(profile)
  if (overall <= 1e-6) return { phase: 0, boundaryScore: 0, interiorScore: 0 }
  // 桶分相位：每个下标只归一次桶 ⇒ 每个候选 s 是 O(len)，而不是 O(s·len)
  // （1600px 图上"s 从 3 扫到 800"是准入条件——否则一次识别要几秒）。
  const boundarySum = new Float64Array(s)
  const boundaryCount = new Int32Array(s)
  let total = 0
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i]!
    total += v
    const bucket = i % s
    boundarySum[bucket] = boundarySum[bucket]! + v
    boundaryCount[bucket] = boundaryCount[bucket]! + 1
  }
  let best: PhaseStats = { phase: 0, boundaryScore: 0, interiorScore: 0 }
  for (let phase = 0; phase < s; phase++) {
    const bc = boundaryCount[phase]!
    const ic = profile.length - bc
    if (bc === 0 || ic === 0) continue
    const stats: PhaseStats = {
      phase,
      boundaryScore: boundarySum[phase]! / bc / overall,
      interiorScore: (total - boundarySum[phase]!) / ic / overall,
    }
    // 先看"内部平"：内部比边界还吵的相位不选；平手时选边界强的
    if (
      stats.interiorScore < best.interiorScore - 1e-9 ||
      (Math.abs(stats.interiorScore - best.interiorScore) <= 1e-9 && stats.boundaryScore > best.boundaryScore)
    ) {
      best = stats
    }
    if (best.boundaryScore === 0 && stats.boundaryScore === 0) best = stats
  }
  return best
}

/** 单轴周期（另一轴没有边界时兜底：例如只有一行格子的图纸） */
function findSinglePeriod(profile: Float64Array): { size: number; score: number } | null {
  let best: { size: number; score: number } | null = null
  for (let s = PATTERN_LIMITS.minCellPx; s <= profile.length; s++) {
    const stats = phaseStats(profile, s)
    if (stats.interiorScore > INTERIOR_SCORE_MAX || stats.boundaryScore < PERIOD_SCORE_MIN) continue
    if (best === null || stats.boundaryScore > best.score + 1e-9) best = { size: s, score: stats.boundaryScore }
  }
  return best
}

/** 在两条边界曲线上共同找方格边长：内部足够平 + 边界足够强，取最强者（同分取短） */
function findCellSize(edgeX: Float64Array, edgeY: Float64Array): { size: number; score: number } | null {
  const maxS = Math.min(edgeX.length, edgeY.length)
  if (maxS < PATTERN_LIMITS.minCellPx * 2) return null
  let best: { size: number; score: number } | null = null
  for (let s = PATTERN_LIMITS.minCellPx; s <= maxS; s++) {
    const sx = phaseStats(edgeX, s)
    const sy = phaseStats(edgeY, s)
    // 两个方向都必须"内部平"（符号图纸 / 拍照图会在这里被挡在门外——那一路走 AI 视觉）
    if (sx.interiorScore > INTERIOR_SCORE_MAX || sy.interiorScore > INTERIOR_SCORE_MAX) continue
    const score = Math.min(sx.boundaryScore, sy.boundaryScore)
    if (score < PERIOD_SCORE_MIN) continue
    if (best === null || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && s < best.size)) {
      best = { size: s, score }
    }
  }
  return best
}

const confidenceOf = (score: number): number => Math.min(1, Math.max(0, (score - 1) / 1.2))

/**
 * 检测网格几何。手动给了行列 ⇒ 直接按手动单元格换算（`source: 'manual'`），不再尝试周期检测。
 * 自动检测失败时：图 ≤128×128 ⇒ 按 1 像素 1 格兜底；否则 `ok:false`（UI 提示手动填行列）。
 */
export function detectGrid(img: RgbaImage, opts: RecognizeOptions = {}): DetectOutcome {
  if (img.width < 4 || img.height < 4) return { ok: false, reason: '图片太小（至少 4×4 像素）' }
  const bg = opts.background ? null : borderBackground(img)
  const warnings: string[] = []
  const manual = opts.manual
  const initial: Region = {
    left: clampInt(manual?.left ?? 0, 0, img.width - 1),
    top: clampInt(manual?.top ?? 0, 0, img.height - 1),
    right: clampInt(manual?.right ?? img.width, 1, img.width),
    bottom: clampInt(manual?.bottom ?? img.height, 1, img.height),
  }
  if (initial.right <= initial.left + 1 || initial.bottom <= initial.top + 1) {
    return { ok: false, reason: '识别区域太小（宽高至少 2 像素）' }
  }
  const region = manual?.cols || manual?.rows ? initial : bg ? trimUniformBorder(img, bg) : initial
  const width = region.right - region.left
  const height = region.bottom - region.top

  if (manual?.cols !== undefined && manual?.rows !== undefined) {
    const cols = Math.round(manual.cols)
    const rows = Math.round(manual.rows)
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
      return { ok: false, reason: '手动行列必须 ≥ 1' }
    }
    if (cols > PATTERN_LIMITS.maxSide || rows > PATTERN_LIMITS.maxSide) {
      return { ok: false, reason: `行列超出上限 ${PATTERN_LIMITS.maxSide}（一张图纸最多 ${PATTERN_LIMITS.maxCells} 格）` }
    }
    return {
      ok: true,
      background: bg,
      warnings,
      geometry: { cols, rows, left: region.left, top: region.top, cellW: width / cols, cellH: height / rows, confidence: 1, source: 'manual' },
    }
  }

  // 通道一：图上画了贯穿全图的格线（带色号文字的印刷图纸几乎都有）⇒ 直接按格线定位。
  // 格线检测比色差周期稳得多：文字会把"内部要平"的周期判据彻底打乱。
  const lattice = detectByLattice(img, { trimBlankEdges: opts.trimBlankEdges === true })
  if (lattice !== null) {
    warnings.push('检测到格线：按格线定位网格（适合带色号/文字的印刷图纸）')
    return {
      ok: true,
      background: bg,
      warnings,
      geometry: {
        cols: lattice.cols,
        rows: lattice.rows,
        left: lattice.left,
        top: lattice.top,
        cellW: lattice.cell,
        cellH: lattice.cell,
        confidence: 0.95,
        source: 'auto',
      },
    }
  }
  // 通道二：纯色块图纸（无格线）⇒ 用边界色差周期估计
  const edgeX = columnEdges(img, region)
  const edgeY = rowEdges(img, region)
  // 两轴都有周期 = 最强证据；只有一轴有（例如 2×1 的单行图纸）⇒ 用该轴格长补齐
  const found = findCellSize(edgeX, edgeY) ?? (findSinglePeriod(edgeX) ?? findSinglePeriod(edgeY))
  if (found === null) {
    // 周期通道也没找到：小图按 1 像素 = 1 格兜底，否则要求手动填行列
    if (width <= PATTERN_LIMITS.maxSide && height <= PATTERN_LIMITS.maxSide) {
      warnings.push('未检测到规则方格：按 1 像素 = 1 格处理（原生像素图纸/无格线图纸）')
      return {
        ok: true,
        background: bg,
        warnings,
        geometry: { cols: width, rows: height, left: region.left, top: region.top, cellW: 1, cellH: 1, confidence: 0.2, source: 'auto' },
      }
    }
    return { ok: false, reason: '未检测到规则方格（可能是拍照倾斜 / 无格线）：请手动填写行列数' }
  }
  // 相位 → 网格原点：edgeX[i] 记的是 region.left+i 与 region.left+i+1 之间的色差，
  // 所以"首个内部边界"在 region.left + φ + 1；网格原点 = 该边界再往左退整数个周期
  // ⇒ 原点偏移 = (φ + 1) mod 周期（φ+1 恰为周期时原点就是 region.left）。
  const period = found.size
  const originX = (phaseStats(edgeX, period).phase + 1) % period
  const originY = (phaseStats(edgeY, period).phase + 1) % period
  const left = Math.min(region.left + originX, region.right - 1)
  const top = Math.min(region.top + originY, region.bottom - 1)
  const cols = clampInt((region.right - left) / found.size, 1, PATTERN_LIMITS.maxSide)
  const rows = clampInt((region.bottom - top) / found.size, 1, PATTERN_LIMITS.maxSide)
  if (cols < 2 || rows < 2) warnings.push('只识别到一行/一列：请确认图纸方向或手动填写行列')
  const geometry: GridGeometry = {
    cols,
    rows,
    left,
    top,
    cellW: (region.right - left) / cols,
    cellH: (region.bottom - top) / rows,
    confidence: confidenceOf(found.score),
    source: 'auto',
  }
  return { ok: true, geometry, background: bg, warnings }
}