// 浏览器侧解码（本目录唯一碰 DOM 的文件）：File → RGBA 像素 + 两张缩略图 data URL。
//
// 解码是"传输"不是"算法"：识别算法（detect/sample/recognize）只吃 RGBA 缓冲，可在 Node 里用
// 合成像素测试；这里只负责把真实图片文件变成那个缓冲。
import { PATTERN_LIMITS } from './types'
import type { RgbaImage } from './types'

export interface LoadedPatternImage {
  readonly rgba: RgbaImage
  /** 预览缩略图（≤512px，JPEG data URL） */
  readonly previewDataUrl: string
  /** 送给视觉模型的图（≤1024px，JPEG data URL） */
  readonly visionDataUrl: string
}

/** 建一个 2D 画布：主线程优先 `<canvas>`（toDataURL 同步可用、兼容面最大），worker 里退回 OffscreenCanvas */
function makeCanvas(width: number, height: number): { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; canvas: HTMLCanvasElement | OffscreenCanvas } {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) return { ctx, canvas }
  }
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx) return { ctx, canvas }
  }
  throw new Error('当前浏览器无法创建 2D 画布')
}

function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function drawScaled(bitmap: ImageBitmap, maxSide: number): { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; canvas: HTMLCanvasElement | OffscreenCanvas; width: number; height: number } {
  const size = scaledSize(bitmap.width, bitmap.height, maxSide)
  const { ctx, canvas } = makeCanvas(size.width, size.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  return { ctx, canvas, ...size }
}

function canvasDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): string {
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) return canvas.toDataURL('image/jpeg', quality)
  const off = canvas as OffscreenCanvas
  if (typeof off.convertToBlob !== 'function') return ''
  // 同步 API 不可得时由调用方降级；这里返回空串（面板会提示"预览不可用"但不影响识别）
  return ''
}

async function canvasDataUrlAsync(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<string> {
  const sync = canvasDataUrl(canvas, quality)
  if (sync !== '') return sync
  const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality })
  return blobToDataUrl(blob)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

/** 解码一张图纸图片（超尺寸先缩小再取像素：识别不需要原图分辨率）。 */
export async function loadPatternImage(file: File): Promise<LoadedPatternImage> {
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
    throw new Error('请选择图片文件（PNG / JPEG / WebP）')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const base = drawScaled(bitmap, PATTERN_LIMITS.maxDecodeSide)
    const imageData = base.ctx.getImageData(0, 0, base.width, base.height)
    const rgba: RgbaImage = { width: base.width, height: base.height, data: new Uint8ClampedArray(imageData.data) }
    const preview = drawScaled(bitmap, 512)
    const vision = drawScaled(bitmap, PATTERN_LIMITS.maxVisionSide)
    return {
      rgba,
      previewDataUrl: await canvasDataUrlAsync(preview.canvas, 0.82),
      visionDataUrl: await canvasDataUrlAsync(vision.canvas, 0.85),
    }
  } finally {
    bitmap.close()
  }
}