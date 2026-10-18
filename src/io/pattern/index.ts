// 拼豆图纸识别模块的公开面。
//   types / detect / sample / recognize = 纯函数（Node 可测）；
//   decode = 浏览器解码（File → RGBA）。
export { PATTERN_LIMITS } from './types'
export type {
  GridGeometry,
  PatternColorStat,
  PatternGrid,
  PatternRecognizeResult,
  RecognizeOptions,
  Rgb,
  RgbaImage,
} from './types'
export { channelDistance, hexRgb, pixelAt } from './types'
export { detectGrid } from './detect'
export type { DetectOutcome } from './detect'
export { sampleGrid } from './sample'
export type { SampleOutcome } from './sample'
export { recognizePattern } from './recognize'
export { loadPatternImage } from './decode'
export type { LoadedPatternImage } from './decode'
