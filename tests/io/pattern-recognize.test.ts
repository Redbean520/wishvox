// 图纸识别（L1 纯函数）：合成像素图 → 网格几何 + 逐格取色 + 近色归并。
// 判据全用解析值（行列 / 颜色 / 空位数），不吃真实图片资产、不依赖浏览器。
import { describe, expect, it } from 'vitest'
import { detectGrid, hexRgb, recognizePattern } from '../../src/io/pattern'
import type { RgbaImage } from '../../src/io/pattern/types'

/** 造一张 RGBA 图：fill 返回 [r,g,b,a?] */
function makeImage(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number?]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a ?? 255
    }
  }
  return { width, height, data }
}

const rgbOf = (hex: string): [number, number, number] => {
  const c = hexRgb(hex)!
  return [c.r, c.g, c.b]
}

/** 造一张"规则方格图纸"：margin 为留白，colors 行优先；null = 留白色（空位） */
function chart(opts: {
  cols: number
  rows: number
  cell: number
  margin: number
  colors: ReadonlyArray<string | null>
  bg?: string
}): RgbaImage {
  const { cols, rows, cell, margin, colors } = opts
  const bg = rgbOf(opts.bg ?? '#ffffff')
  const width = cols * cell + margin * 2
  const height = rows * cell + margin * 2
  return makeImage(width, height, (x, y) => {
    const cx = x - margin
    const cy = y - margin
    if (cx < 0 || cy < 0 || cx >= cols * cell || cy >= rows * cell) return bg
    const col = Math.floor(cx / cell)
    const row = Math.floor(cy / cell)
    const hex = colors[row * cols + col]
    if (hex === null || hex === undefined) return bg
    return rgbOf(hex)
  })
}

const COLORS_4x3 = ['#c0392b', '#3b6ea5', '#e8c547', '#2e8b57', '#d4839b', '#6f6c6a', '#2aa198', '#8d6e63', '#7d5ba6', '#d98324', '#4fc3f7', '#b8b6b3']

describe('IO-P1 · 自动网格检测（彩色格子图纸）', () => {
  it('4×3 / 每格 10px：检出 4 列 3 行、逐格取色一致、无空位', () => {
    const img = chart({ cols: 4, rows: 3, cell: 10, margin: 0, colors: COLORS_4x3 })
    const result = recognizePattern(img)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry.cols).toBe(4)
    expect(result.geometry.rows).toBe(3)
    expect(result.geometry.source).toBe('auto')
    expect(result.geometry.confidence).toBeGreaterThan(0.5)
    expect(result.emptyCells).toBe(0)
    expect(result.grid.cells).toEqual(COLORS_4x3)
    expect(result.palette).toHaveLength(12)
  })

  it('四周留白 12px：先裁掉留白再识别，行列不变、颜色不进网格', () => {
    const img = chart({ cols: 4, rows: 3, cell: 10, margin: 12, colors: COLORS_4x3 })
    const result = recognizePattern(img)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([result.geometry.cols, result.geometry.rows]).toEqual([4, 3])
    expect(result.grid.cells).toEqual(COLORS_4x3)
  })

  it('留白色格子 = 空位（null）：不摆块，也不进色板', () => {
    const colors = ['#c0392b', null, '#3b6ea5', null]
    const img = chart({ cols: 2, rows: 2, cell: 12, margin: 12, colors })
    const result = recognizePattern(img)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.grid.cells).toEqual(['#c0392b', null, '#3b6ea5', null])
    expect(result.emptyCells).toBe(2)
    expect(result.palette).toHaveLength(2)
  })

  it('手动行列优先于自动检测（source = manual，cellW = 区域宽 / 列数）', () => {
    const img = chart({ cols: 4, rows: 3, cell: 10, margin: 0, colors: COLORS_4x3 })
    const result = recognizePattern(img, { manual: { cols: 2, rows: 2 } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry.source).toBe('manual')
    expect(result.geometry.cols).toBe(2)
    expect(result.geometry.rows).toBe(2)
    expect(result.geometry.cellW).toBeCloseTo(20, 5)
  })
})

describe('IO-P2 · 兜底与失败（不猜）', () => {
  it('5×4 的原生像素图（1 像素 = 1 格）：按 1px 兜底并给出警告', () => {
    const img = makeImage(5, 4, (x, y) => (x + y) % 2 === 0 ? [192, 57, 43] : [232, 230, 227])
    const result = recognizePattern(img)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([result.geometry.cols, result.geometry.rows]).toEqual([5, 4])
    expect(result.warnings.join('')).toContain('1 像素 = 1 格')
  })

  it('图片太小 ⇒ ok:false 且原因可读', () => {
    const img = makeImage(2, 2, () => [0, 0, 0])
    const result = recognizePattern(img)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('太小')
  })

  it('手动行列超上限（>128）⇒ ok:false，不产出半张网格', () => {
    const img = makeImage(300, 300, () => [10, 20, 30])
    const result = recognizePattern(img, { manual: { cols: 200, rows: 2 } })
    expect(result.ok).toBe(false)
  })
})

describe('IO-P3 · 近色归并（图纸色板收敛，但不并掉明显不同的颜色）', () => {
  it('两种相差 15 的红在阈值 18 下并成 1 色；阈值 0 时保持 2 色', () => {
    const colors = ['#ff0000', '#f00f00']
    const img = chart({ cols: 2, rows: 1, cell: 10, margin: 0, colors })
    const merged = recognizePattern(img, { mergeTolerance: 18 })
    const exact = recognizePattern(img, { mergeTolerance: 0 })
    expect(merged.ok && merged.palette.length).toBe(1)
    expect(exact.ok && exact.palette.length).toBe(2)
  })

  it('明显不同的两色即使阈值拉高也不并（最大通道差 > 阈值）', () => {
    const colors = ['#ff0000', '#3b6ea5']
    const img = chart({ cols: 2, rows: 1, cell: 10, margin: 0, colors })
    const result = recognizePattern(img, { mergeTolerance: 60 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.palette).toHaveLength(2)
  })
})

describe('IO-P4 · 几何检测口径（detectGrid 独立面）', () => {
  it('留白裁掉后 left/top 落在图案区边缘（不是 0）', () => {
    const img = chart({ cols: 4, rows: 3, cell: 10, margin: 12, colors: COLORS_4x3 })
    const detected = detectGrid(img)
    expect(detected.ok).toBe(true)
    if (!detected.ok) return
    expect(detected.geometry.left).toBe(12)
    expect(detected.geometry.top).toBe(12)
    expect(detected.background).not.toBeNull()
  })
})
describe('IO-P5 · 大图性能（1600px 上界内的一次识别不应卡住面板）', () => {
  it('1200×900 / 每格 20px：正确识别且 < 3s（O(len) 相位扫描）', () => {
    const cols = 45
    const rows = 30
    const cell = 20
    const colors = Array.from({ length: cols * rows }, (_, i) => {
      const palette = ['#c0392b', '#3b6ea5', '#e8c547', '#2e8b57']
      return palette[i % palette.length]!
    })
    const img = chart({ cols, rows, cell, margin: 12, colors })
    const started = performance.now()
    const result = recognizePattern(img)
    const elapsed = performance.now() - started
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([result.geometry.cols, result.geometry.rows]).toEqual([cols, rows])
    expect(result.grid.cells[0]).toBe(colors[0])
    expect(elapsed).toBeLessThan(3000)
  })
})
describe('IO-P6 · 手动裁边与水平镜像（r07）', () => {
  const img = chart({ cols: 3, rows: 2, cell: 10, margin: 0, colors: ['#c0392b', '#3b6ea5', '#e8c547', '#2e8b57', '#d4839b', '#6f6c6a'] })

  it('裁边（单位：格）按格裁掉四边，几何与数据同步收缩', () => {
    const result = recognizePattern(img, { crop: { left: 1, right: 1, top: 1 } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry.cols).toBe(1)
    expect(result.geometry.rows).toBe(1)
    // 裁掉左/右 ⇒ 只剩中间列；裁掉顶部一行 ⇒ 只剩第 2 行
    expect(result.grid.cells).toEqual(['#d4839b'])
  })

  it('裁边过多 ⇒ 明确失败（不返回空网格）', () => {
    const result = recognizePattern(img, { crop: { left: 2, right: 2, top: 2 } })
    expect(result.ok).toBe(false)
  })

  it('mirrorX 行内左右翻转（列数不变）', () => {
    const normal = recognizePattern(img)
    const mirrored = recognizePattern(img, { mirrorX: true })
    expect(normal.ok && mirrored.ok).toBe(true)
    if (!normal.ok || !mirrored.ok) return
    expect(mirrored.grid.cols).toBe(normal.grid.cols)
    for (let r = 0; r < normal.grid.rows; r++) {
      const a = normal.grid.cells.slice(r * normal.grid.cols, (r + 1) * normal.grid.cols)
      const b = mirrored.grid.cells.slice(r * mirrored.grid.cols, (r + 1) * mirrored.grid.cols)
      expect(b).toEqual([...a].reverse())
    }
  })
})