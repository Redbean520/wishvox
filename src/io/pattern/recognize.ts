// 识别编排：几何检测 → 逐格取色 → 结果（纯函数，无 DOM、无模型写入）。
import { PATTERN_LIMITS } from './types'
import type { PatternRecognizeResult, RecognizeOptions, RgbaImage, Rgb } from './types'
import { hexRgb } from './types'
import { detectGrid } from './detect'
import { sampleGrid } from './sample'
import { extractLegendPalette } from './legend-palette'

/** 水平镜像（行内左右翻转） */
function mirrorGrid(grid: { cols: number; rows: number; cells: ReadonlyArray<string | null> }): { cols: number; rows: number; cells: Array<string | null> } {
  const cells: Array<string | null> = []
  for (let r = 0; r < grid.rows; r++) {
    for (let c = grid.cols - 1; c >= 0; c--) cells.push(grid.cells[r * grid.cols + c] ?? null)
  }
  return { cols: grid.cols, rows: grid.rows, cells }
}

/**
 * 一张图纸图片 → 颜色网格。`ok:false` 是可判定的失败（图片太小 / 检不出网格 / 超上限），
 * 调用方把 `reason` 原样显示给用户；不抛错 = 面板不必写 try/catch。
 */
export function recognizePattern(img: RgbaImage, opts: RecognizeOptions = {}): PatternRecognizeResult {
  const detected = detectGrid(img, opts)
  if (!detected.ok) return detected
  const { geometry } = detected
  if (geometry.cols * geometry.rows > PATTERN_LIMITS.maxCells) {
    return { ok: false, reason: `格子太多（${geometry.cols}×${geometry.rows} > ${PATTERN_LIMITS.maxCells}）：请把行列调小` }
  }
  let background: Rgb | null = detected.background
  if (opts.background !== undefined && opts.background !== null) {
    background = hexRgb(opts.background)
    if (background === null) return { ok: false, reason: `背景色无效（须为不透明 HEX）：${opts.background}` }
  }
  // 图纸底部的图例色卡：① 作为精确调色板（影响颜色）② 用它把图例区域从网格里裁掉
  const legend = extractLegendPalette(img)
  let geometryWithLegend = geometry
  if (legend !== null) {
    const rowsCap = Math.floor((legend.top - geometry.top - 1) / geometry.cellH)
    if (rowsCap >= 2 && rowsCap < geometry.rows) geometryWithLegend = { ...geometry, rows: rowsCap }
  }
  let cropped = geometryWithLegend
  const crop = opts.crop
  if (crop !== undefined) {
    const cl = Math.max(0, Math.round(crop.left ?? 0))
    const ct = Math.max(0, Math.round(crop.top ?? 0))
    const cr = Math.max(0, Math.round(crop.right ?? 0))
    const cb = Math.max(0, Math.round(crop.bottom ?? 0))
    const cols = geometry.cols - cl - cr
    const rows = geometry.rows - ct - cb
    if (cols < 1 || rows < 1) return { ok: false, reason: '裁边过多：剩余行列不足 1（请缩小裁边格数）' }
    cropped = {
      ...geometry,
      cols,
      rows,
      left: geometry.left + cl * geometry.cellW,
      top: geometry.top + ct * geometry.cellH,
    }
  }
  const sampled = sampleGrid(img, cropped, {
    background,
    mergeTolerance: opts.mergeTolerance,
    backgroundToEmpty: opts.backgroundToEmpty,
    ...(legend !== null ? { palette: legend.colors } : {}),
  })
  const grid = opts.mirrorX === true ? mirrorGrid(sampled.grid) : sampled.grid
  return {
    ok: true,
    geometry: cropped,
    grid,
    palette: sampled.palette,
    backgroundColor: background === null ? null : `rgb(${background.r}, ${background.g}, ${background.b})`,
    emptyCells: sampled.emptyCells,
    warnings: [...detected.warnings, ...sampled.warnings],
  }
}