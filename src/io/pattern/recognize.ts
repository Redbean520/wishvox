// 识别编排：几何检测 → 逐格取色 → 结果（纯函数，无 DOM、无模型写入）。
import { PATTERN_LIMITS } from './types'
import type { PatternRecognizeResult, RecognizeOptions, RgbaImage, Rgb } from './types'
import { hexRgb } from './types'
import { detectGrid } from './detect'
import { sampleGrid } from './sample'

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
  const sampled = sampleGrid(img, geometry, {
    background,
    mergeTolerance: opts.mergeTolerance,
    backgroundToEmpty: opts.backgroundToEmpty,
  })
  return {
    ok: true,
    geometry,
    grid: sampled.grid,
    palette: sampled.palette,
    backgroundColor: background === null ? null : `rgb(${background.r}, ${background.g}, ${background.b})`,
    emptyCells: sampled.emptyCells,
    warnings: [...detected.warnings, ...sampled.warnings],
  }
}
