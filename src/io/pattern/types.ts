// 拼豆图纸 → 体素网格：**数据契约与边界数字**（纯类型 + 颜色距离工具，无 DOM）。
//
// 本目录只负责"图片像素 → 二维颜色网格"（识别）；把网格写进模型在 `edit/pattern-apply.ts`，
// 把图片交给视觉模型在 `ai/pattern-vision.ts`。三层各自可无头测试。
//
// 为什么形状是"行优先的一串颜色"而不是二维数组：与 `core/types.ts` 的扁平化风格一致，
// 序列化 / 断言 / 上限检查都只需要一维长度 `rows × cols`。

import { canonicalHex } from '../../core/color'

/** 上限（数字锚定：128×128 = 16384 格，与 AI 单调用全域上限同量级；再大就不是"拼豆图纸"了）。 */
export const PATTERN_LIMITS = {
  /** 单边最大格数 */
  maxSide: 128,
  /** 单张图纸最大格数（= maxSide²） */
  maxCells: 128 * 128,
  /** 自动识别允许的最小方格边长（像素）：再小就按 1 像素 = 1 格处理 */
  minCellPx: 3,
  /** 解码后的像素上限（超大照片先按侧边缩到这个量级再识别） */
  maxDecodeSide: 1600,
  /** 送给视觉模型的长边上限（控制图片 token） */
  maxVisionSide: 1024,
} as const

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** 解码后的 RGBA 像素缓冲（`Uint8ClampedArray` 与 `ImageData.data` 同型，无拷贝即可喂给算法）。 */
export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** 网格几何：卡片像素坐标 + 每格尺寸（cellW/cellH 允许非整数——整图宽度未必被格数整除）。 */
export interface GridGeometry {
  readonly cols: number
  readonly rows: number
  /** 网格左上角像素坐标 */
  readonly left: number
  readonly top: number
  readonly cellW: number
  readonly cellH: number
  /** 0–1：自动识别的把握程度（手动指定 = 1） */
  readonly confidence: number
  readonly source: 'auto' | 'manual'
}

/** 识别结果：行优先，`cells[r * cols + c]`；null = 空位（不摆块）。 */
export interface PatternGrid {
  readonly cols: number
  readonly rows: number
  readonly cells: ReadonlyArray<string | null>
}

export interface PatternColorStat {
  readonly hex: string
  /** 该颜色占用的格数 */
  readonly count: number
}

export interface RecognizeOptions {
  /** 手动指定网格（行列必同时给；left/top/right/bottom 可裁剪识别区域，缺省 = 整图） */
  readonly manual?: {
    readonly cols?: number
    readonly rows?: number
    readonly left?: number
    readonly top?: number
    readonly right?: number
    readonly bottom?: number
  }
  /** 近色归并阈值（最大通道差，0–80；默认 18）——图纸色板的重心差异通常小于它 */
  readonly mergeTolerance?: number
  /** 裁掉四周"整行/整列都是空白或标尺条"的边带（默认 false = 保留图纸标称的整张网格） */
  readonly trimBlankEdges?: boolean
  /** 手动裁边（单位：格）：自动识别之后再去掉四边若干格（用来裁图例 / 残留标尺） */
  readonly crop?: {
    readonly left?: number
    readonly top?: number
    readonly right?: number
    readonly bottom?: number
  }
  /** 水平镜像：图纸标注「镜像」或与实物左右相反时勾选 */
  readonly mirrorX?: boolean
  /** 与背景同色的格子算空位（默认 true） */
  readonly backgroundToEmpty?: boolean
  /** 全透明格子算空位（默认 true） */
  readonly alphaToEmpty?: boolean
  /** 指定背景色（缺省从图片四边取；四边颜色不统一 ⇒ 视为无背景色） */
  readonly background?: string | null
}

export type PatternRecognizeResult =
  | {
      readonly ok: true
      readonly geometry: GridGeometry
      readonly grid: PatternGrid
      readonly palette: ReadonlyArray<PatternColorStat>
      readonly backgroundColor: string | null
      readonly emptyCells: number
      readonly warnings: ReadonlyArray<string>
    }
  | { readonly ok: false; readonly reason: string }

/** 两色"最大通道差"（0–255）。比欧氏距离更贴人眼对单一通道偏移的容忍，也更好写测试。 */
export function channelDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
}

/** 规范 HEX → Rgb（非法 / 带透明度 ⇒ null；这里只认核心色板的口径） */
export function hexRgb(hex: string): Rgb | null {
  const c = canonicalHex(hex)
  if (c === null) return null
  return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) }
}

/** 像素读取（越界返回全透明黑——调用方负责裁剪） */
export function pixelAt(img: RgbaImage, x: number, y: number): { r: number; g: number; b: number; a: number } {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return { r: 0, g: 0, b: 0, a: 0 }
  const i = (y * img.width + x) * 4
  return { r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]!, a: img.data[i + 3]! }
}