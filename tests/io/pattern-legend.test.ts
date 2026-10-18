// 图例色卡提取（L1）：合成"色卡条"图片，验证能读出色卡颜色与上沿。
import { describe, expect, it } from 'vitest'
import { extractLegendPalette } from '../../src/io/pattern/legend-palette'
import { hexRgb } from '../../src/io/pattern/types'
import type { RgbaImage } from '../../src/io/pattern/types'

function makeImage(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

describe('IO-LG · 图例色卡提取', () => {
  it('读出 8 个色卡的颜色与上沿；图案格子（带文字）不会被误当色卡', () => {
    const swatchColors = ['#f9f1c8', '#c5d3f2', '#fcd0ba', '#e2b382', '#cf8f66', '#9a5a40', '#697d7f', '#010101']
    const swatchW = 24
    const gap = 8
    const top = 160
    const height = 200
    const width = 20 + swatchColors.length * (swatchW + gap)
    const img = makeImage(width, height, (x, y) => {
      if (y >= top && y < top + 22) {
        const idx = Math.floor((x - 20) / (swatchW + gap))
        const local = (x - 20) % (swatchW + gap)
        if (idx >= 0 && idx < swatchColors.length && local < swatchW) return hexRgb(swatchColors[idx]!) ? [hexRgb(swatchColors[idx]!)!.r, hexRgb(swatchColors[idx]!)!.g, hexRgb(swatchColors[idx]!)!.b] : [255, 255, 255]
      }
      return [255, 255, 255]
    })
    const legend = extractLegendPalette(img)
    expect(legend).not.toBeNull()
    expect(legend!.colors.length).toBeGreaterThanOrEqual(6)
    for (const hex of swatchColors.slice(0, 6)) {
      const rgb = hexRgb(hex)!
      const found = legend!.colors.some((c) => {
        const p = hexRgb(c)!
        return Math.max(Math.abs(p.r - rgb.r), Math.abs(p.g - rgb.g), Math.abs(p.b - rgb.b)) <= 12
      })
      expect(found, `缺少色卡颜色 ${hex}`).toBe(true)
    }
    expect(legend!.top).toBeGreaterThanOrEqual(top - 2)
  })

  it('纯白图片（没有色卡）⇒ null', () => {
    const img = makeImage(200, 150, () => [255, 255, 255])
    expect(extractLegendPalette(img)).toBeNull()
  })
})
