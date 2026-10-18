// 图纸预览：把识别出的网格按 1 格 = 1 像素画到 canvas 上（CSS 放大 + pixelated）。
// 预览画的是**将要生成的方块颜色**（不是原图）——所以它是"识别是否正确"的判据，而不是装饰。
import type { PatternGrid } from '../io/pattern/types'

/** 空位在预览里画成"淡棋盘格"：一眼能看出这是"不摆块的格子"，而不是识别失败的黑洞 */
const EMPTY_COLOR_A = '#171e28'
const EMPTY_COLOR_B = '#11161f'

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
      ctx.fillStyle = hex ?? ((row + col) % 2 === 0 ? EMPTY_COLOR_A : EMPTY_COLOR_B)
      ctx.fillRect(col, row, 1, 1)
    }
  }
}