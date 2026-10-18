// 图纸预览：把识别出的网格按 1 格 = 1 像素画到 canvas 上（CSS 放大 + pixelated）。
// 预览画的是**将要生成的方块颜色**（不是原图）——所以它是"识别是否正确"的判据，而不是装饰。
import type { PatternGrid } from '../io/pattern/types'

/** 空位在预览里的底色（与视口背景同族，能看出"这些格子不会摆块"） */
const EMPTY_COLOR = '#11161d'

export function drawPatternPreview(canvas: HTMLCanvasElement, grid: PatternGrid | null): void {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return
  if (grid === null) {
    canvas.width = 1
    canvas.height = 1
    ctx.clearRect(0, 0, 1, 1)
    return
  }
  canvas.width = grid.cols
  canvas.height = grid.rows
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const hex = grid.cells[row * grid.cols + col]
      ctx.fillStyle = hex ?? EMPTY_COLOR
      ctx.fillRect(col, row, 1, 1)
    }
  }
}
