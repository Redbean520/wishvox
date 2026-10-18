// 格线通道（带色号文字的印刷图纸）：合成"格线 + 文字"图，验证几何定位与"白豆 vs 空白"取样。
import { describe, expect, it } from 'vitest'
import { detectByLattice } from '../../src/io/pattern/lattice'
import { hexRgb, pixelAt } from '../../src/io/pattern/types'
import type { RgbaImage } from '../../src/io/pattern/types'
import { sampleGrid } from '../../src/io/pattern/sample'
import { recognizePattern } from '../../src/io/pattern/recognize'

const LINE = '#ebebeb'
const WHITE = '#ffffff'

function canvas(width: number, height: number, fill: (x: number, y: number) => string): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = hexRgb(fill(x, y))!
      const i = (y * width + x) * 4
      data[i] = c.r
      data[i + 1] = c.g
      data[i + 2] = c.b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

/** 造一张"印刷图纸"：cell 像素一格、格线 1px、底部两行是图例/空白（应被裁掉） */
function printedChart(opts: {
  cols: number
  rows: number
  cell: number
  colors: ReadonlyArray<string>
  legendRows?: number
}): RgbaImage {
  const { cols, rows, cell } = opts
  const legendRows = opts.legendRows ?? 0
  // 四周留 1px 白边：格线不贴图像边缘（真实图纸有标尺/边距，边缘格线本来就不好判）
  const width = cols * cell + 3
  const height = (rows + legendRows) * cell + 3
  const totalColsPx = cols * cell
  const totalRowsPx = (rows + legendRows) * cell
  return canvas(width, height, (x, y) => {
    const gx = x - 1
    const gy = y - 1
    // 格线画到闭合边框（含右侧/底部最后一条），与真实图纸一致
    if (gx >= 0 && gy >= 0 && gx <= totalColsPx && gy <= totalRowsPx && (gx % cell === 0 || gy % cell === 0)) return LINE
    if (gx < 0 || gy < 0 || gx >= totalColsPx || gy >= totalRowsPx) return WHITE
    const col = Math.floor(gx / cell)
    const row = Math.floor(gy / cell)
    if (row >= rows) return WHITE // 图例行：白底
    const hex = opts.colors[row * cols + col]
    return hex ?? WHITE
  })
}

describe('IO-L1 · 格线定位（印刷图纸）', () => {
  it('8×6 图纸 / 每格 12px：检出 8 列 6 行、格边长 12', () => {
    const colors = Array.from({ length: 48 }, (_, i) => (i % 2 === 0 ? '#c0392b' : '#3b6ea5'))
    const img = printedChart({ cols: 8, rows: 6, cell: 12, colors })
    const lattice = detectByLattice(img)
    expect(lattice).not.toBeNull()
    expect(lattice!.cols).toBe(8)
    expect(lattice!.rows).toBe(6)
    expect(lattice!.cell).toBeCloseTo(12, 0)
  })

  it('底部多余空白行被裁掉（不算图案）', () => {
    const colors = Array.from({ length: 8 * 3 }, () => '#c0392b')
    const withLegend = detectByLattice(printedChart({ cols: 8, rows: 3, cell: 12, colors, legendRows: 2 }))
    expect(withLegend).not.toBeNull()
    expect(withLegend!.rows).toBe(3)
  })

  it('纯色块、无格线的图 ⇒ 交回周期通道（这里直接返回 null）', () => {
    const img = canvas(40, 30, () => '#c0392b')
    expect(detectByLattice(img)).toBeNull()
  })
})

describe('IO-L2 · 白豆 vs 空白（白底 + 深色文字 = 白豆）', () => {
  const cell = 12

  it('白底带色号 ⇒ #ffffff；纯白 ⇒ 空位', () => {
    const img = canvas(cell * 3, cell, (x, y) => {
      const col = Math.floor(x / cell)
      if (col === 0) return '#c0392b'
      if (col === 1) {
        // 白底 + 中心深色"文字"（3×3 黑块）
        const lx = x % cell
        const ly = y % cell
        return lx >= 5 && lx <= 7 && ly >= 5 && ly <= 7 ? '#111111' : WHITE
      }
      return WHITE
    })
    const out = sampleGrid(img, { cols: 3, rows: 1, left: 0, top: 0, cellW: cell, cellH: cell, confidence: 1, source: 'manual' }, { background: hexRgb(WHITE), backgroundToEmpty: true })
    expect(out.grid.cells).toEqual(['#c0392b', '#ffffff', null])
    expect(pixelAt(img, 1, 1)).toBeDefined()
  })
})
describe('IO-L3 · 带色号文字的图纸端到端（格线通道 + 白豆/空白区分）', () => {
  it('彩色格 + 白底色号格 + 纯白格：识别成对应颜色网格', () => {
    const cell = 14
    const cols = 3
    const rows = 2
    const width = cols * cell + 3
    const height = rows * cell + 3
    // 第 0 行：红、白豆、红；第 1 行：蓝、纯白（空）、蓝
    const kinds = ['red', 'whiteBead', 'red', 'blue', 'empty', 'blue']
    const img = canvas(width, height, (x, y) => {
      const gx = x - 1
      const gy = y - 1
      // 先画格线（含闭合边框），再让越界区域为白
      if (gx >= 0 && gy >= 0 && gx <= cols * cell && gy <= rows * cell && (gx % cell === 0 || gy % cell === 0)) return LINE
      if (gx < 0 || gy < 0 || gx >= cols * cell || gy >= rows * cell) return WHITE
      const col = Math.floor(gx / cell)
      const row = Math.floor(gy / cell)
      const kind = kinds[row * cols + col]
      if (kind === 'red') return '#c0392b'
      if (kind === 'blue') return '#3b6ea5'
      // 白豆 / 空白：白底；白豆在中心画 3×3 深色"色号"像素
      if (kind === 'whiteBead') {
        const lx = gx % cell
        const ly = gy % cell
        return lx >= 6 && lx <= 8 && ly >= 5 && ly <= 7 ? '#111111' : WHITE
      }
      return WHITE
    })
    const rec = recognizePattern(img, { mergeTolerance: 18 })
    expect(rec.ok).toBe(true)
    if (!rec.ok) return
    expect([rec.geometry.cols, rec.geometry.rows]).toEqual([cols, rows])
    expect(rec.grid.cells).toEqual(['#c0392b', '#ffffff', '#c0392b', '#3b6ea5', null, '#3b6ea5'])
    expect(rec.emptyCells).toBe(1)
  })
})