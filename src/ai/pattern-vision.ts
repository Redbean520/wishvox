// 图纸识别的视觉通道：图片 + 结构化提示词 → 颜色网格（一次性读图，不进 agent 循环）。
//
// 为什么独立成"一次性读图"而不是 agent 工具：识别是**只读**动作（不写模型、不过闸门），
// 产出是给人核对/微调的预览——人点"生成方块"才真正写入。AI 因此没有获得任何人类没有的写能力
// （与 `rules/pre`、`edit` 的同一纪律：写路径只有人也能走的那几条）。
//
// 输出契约与本地识别（`io/pattern/recognize.ts`）同型：
//   {"cols": N, "rows": N, "cells": [["#rrggbb"|null, ...], ...]}
// 解析器先严格、再容错：代码块围栏、前后说明文字都能救回来；救不回来给可读原因，绝不猜半个网格。
import { canonicalHex } from '../core/color'
import { PATTERN_LIMITS } from '../io/pattern/types'
import type { PatternGrid } from '../io/pattern/types'
import { OpenAiCompatAdapter, chatWithRetry } from './provider'
import type { ProviderAdapter } from './provider'

export type VisionGridParse =
  | { readonly ok: true; readonly grid: PatternGrid; readonly note: string | null }
  | { readonly ok: false; readonly reason: string }

const EMPTY_TOKENS = new Set(['', 'null', 'none', 'nil', 'air', 'empty', 'transparent', '空', '无', '透明'])

/** 单格取值 → 规范 HEX / null（空）/ undefined（非法） */
function normalizeCell(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value === 'number') return undefined
  if (typeof value !== 'string') return undefined
  const raw = value.trim().toLowerCase()
  if (EMPTY_TOKENS.has(raw)) return null
  // rgba(...) / rgb(...) 形式（少数模型会这么写）
  const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/)
  if (rgb) {
    const hex = '#' + [rgb[1]!, rgb[2]!, rgb[3]!].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
    return canonicalHex(hex)
  }
  // 8 位带 alpha 的十六进制：丢掉 alpha（图纸底色透明 = 空位，由 null 表达）
  const long = raw.match(/^#?([0-9a-f]{8})$/)
  if (long) return canonicalHex('#' + long[1]!.slice(0, 6))
  return canonicalHex(raw) ?? undefined
}

/** 从模型输出里取出第一个完整 JSON 对象（容忍代码块围栏 / 前后说明） */
export function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```[a-zA-Z]*/g, '')
  const start = cleaned.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return cleaned.slice(start, i + 1)
    }
  }
  return null
}

interface RawVisionGrid {
  readonly cols?: unknown
  readonly rows?: unknown
  readonly cells?: unknown
  readonly note?: unknown
  readonly legend?: unknown
  readonly error?: unknown
}

/** 解析视觉模型的输出（纯函数，可无头测试） */
export function parseVisionGrid(text: string): VisionGridParse {
  const json = extractJsonObject(text)
  if (json === null) return { ok: false, reason: '输出里没有 JSON 对象' }
  let obj: RawVisionGrid
  try {
    obj = JSON.parse(json) as RawVisionGrid
  } catch (e) {
    return { ok: false, reason: `JSON 解析失败：${(e as Error).message}` }
  }
  if (typeof obj.error === 'string' && obj.error.trim() !== '') return { ok: false, reason: `模型报告无法识别：${obj.error.trim().slice(0, 200)}` }
  if (!Array.isArray(obj.cells)) return { ok: false, reason: '缺少 cells 数组' }

  // 支持三种形状：二维数组 / 扁平数组 / 每格对象（{"color":"#rrggbb"}）
  const pickCell = (v: unknown): string | null | undefined => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>
      return normalizeCell(rec.color ?? rec.hex ?? rec.fill ?? rec.value)
    }
    return normalizeCell(v)
  }

  let matrix: Array<Array<string | null | undefined>>
  if (obj.cells.every((row) => Array.isArray(row))) {
    matrix = (obj.cells as unknown[][]).map((row) => row.map(pickCell))
  } else {
    const flat = (obj.cells as unknown[]).map(pickCell)
    const cols = typeof obj.cols === 'number' ? Math.round(obj.cols) : 0
    if (cols < 1 || flat.length % cols !== 0) return { ok: false, reason: '扁平 cells 需要能整除的 cols' }
    matrix = []
    for (let i = 0; i < flat.length; i += cols) matrix.push(flat.slice(i, i + cols))
  }

  const declaredCols = typeof obj.cols === 'number' ? Math.round(obj.cols) : null
  const declaredRows = typeof obj.rows === 'number' ? Math.round(obj.rows) : null
  const rows = matrix.length
  const cols = matrix[0]?.length ?? 0
  if (rows < 1 || cols < 1) return { ok: false, reason: 'cells 为空' }
  if (matrix.some((row) => row.length !== cols)) return { ok: false, reason: 'cells 各行长度不一致' }
  if (rows > PATTERN_LIMITS.maxSide || cols > PATTERN_LIMITS.maxSide) {
    return { ok: false, reason: `图纸太大（${cols}×${rows}，上限 ${PATTERN_LIMITS.maxSide}×${PATTERN_LIMITS.maxSide}）` }
  }

  const cells: Array<string | null> = []
  for (const row of matrix) {
    for (const cell of row) {
      // 有些模型会把"没识别出的格子"写成问号或符号：按空位降级（并在 note 里说明），不整单失败
      cells.push(cell === undefined ? null : cell)
    }
  }
  const invalid = cells.filter((c) => c === null).length
  const notes: string[] = []
  if (typeof obj.note === 'string' && obj.note.trim() !== '') notes.push(obj.note.trim().slice(0, 300))
  if (typeof obj.legend === 'object' && obj.legend !== null) notes.push('模型附带了一份颜色图例')
  if (declaredCols !== null && declaredCols !== cols) notes.push(`模型声明的 cols=${declaredCols}，实际 ${cols}（以实际为准）`)
  if (declaredRows !== null && declaredRows !== rows) notes.push(`模型声明的 rows=${declaredRows}，实际 ${rows}（以实际为准）`)
  void invalid
  return { ok: true, grid: { cols, rows, cells }, note: notes.length === 0 ? null : notes.join('；') }
}

export type VisionRecognizeResult =
  | { readonly ok: true; readonly grid: PatternGrid; readonly note: string | null; readonly raw: string }
  | { readonly ok: false; readonly message: string }

export interface VisionRecognizeOptions {
  readonly dataUrl: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly language?: 'zh' | 'en'
  readonly signal?: AbortSignal
  /** 测试注入（不传则按设置构造真适配器） */
  readonly adapter?: ProviderAdapter
  readonly sleep?: (ms: number) => Promise<void>
}

/** 提示词（中文为主；`en` 时换英文版——模型对语言的偏好不同，但输出契约相同） */
export function visionGridPrompt(language: 'zh' | 'en' = 'zh'): string {
  if (language === 'en') {
    return [
      'This image is a perler-bead (fuse-bead) pattern, or pixel art that should become one.',
      'Convert it into a grid of colors. Output ONLY one JSON object:',
      '{"cols": <number>, "rows": <number>, "cells": [[...], ...]}',
      'Rules:',
      '1. cells is rows × cols, row-major from the top-left corner; every cell is "#rrggbb".',
      '2. Blank / paper / transparent cells that should not get a bead are null.',
      '3. If the chart uses symbols or color codes with a legend, translate each symbol to its color using the legend; never output symbols in cells.',
      '4. cols/rows are grid counts (not pixels), at most 128×128.',
      '5. If you truly cannot recognize it, output {"error":"reason"}.',
      '6. Output only the JSON object: no prose, no markdown fences.',
    ].join('\n')
  }
  return [
    '这张图片是一张拼豆图纸（也可能是需要转成拼豆的像素画）。请还原成网格颜色数据，只输出一个 JSON 对象：',
    '{"cols": 列数, "rows": 行数, "cells": [[...], ...]}',
    '规则：',
    '1. cells 是 rows 行 × cols 列，从图纸左上角开始逐行填写；每格写颜色 #rrggbb。',
    '2. 空白 / 纸色 / 透明 / 不摆豆的格子写 null。',
    '3. 如果图纸用符号、编号或色号加图例表示颜色，请先按图例把符号翻译成对应颜色再输出；cells 里不要出现符号。',
    '4. cols / rows 是格数（不是像素），最大 128×128。',
    '5. 实在无法识别时输出 {"error":"原因"}。',
    '6. 只输出这个 JSON 对象：不要解释，不要 markdown 代码块。',
  ].join('\n')
}

/**
 * 调一次视觉模型识别图纸。`ok:false` 一律是**可读的失败原因**（未配置 / 网络 / 模型输出不可解析），
 * 不抛错——面板把 message 原样显示，模型与历史零改动。
 */
export async function recognizePatternWithVision(opts: VisionRecognizeOptions): Promise<VisionRecognizeResult> {
  if (opts.adapter === undefined && (opts.baseUrl === '' || opts.apiKey === '')) {
    return { ok: false, message: 'AI 识别未配置：先在「AI 连接」里填 baseURL 与 API key' }
  }
  if (opts.adapter === undefined && opts.model === '') {
    return { ok: false, message: 'AI 识别未配置：先在「AI 连接」里填「视觉模型」（支持图片输入的模型名）' }
  }
  let adapter: ProviderAdapter
  try {
    adapter = opts.adapter ?? new OpenAiCompatAdapter({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model })
  } catch (e) {
    return { ok: false, message: `视觉模型配置无效：${(e as Error).message}` }
  }
  const language = opts.language ?? 'zh'
  const outcome = await chatWithRetry(
    adapter,
    {
      messages: [
        { role: 'system', content: language === 'en' ? 'You convert bead-pattern charts into JSON color grids.' : '你把拼豆图纸转换成 JSON 颜色网格。' },
        { role: 'user', content: visionGridPrompt(language), images: [opts.dataUrl] },
      ],
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      tools: [],
    },
    { sleep: opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))) },
  )
  if (outcome.error) return { ok: false, message: `视觉模型请求失败：${outcome.error.message}` }
  const text = outcome.result?.text ?? ''
  if (text.trim() === '') return { ok: false, message: '视觉模型没有返回内容（空响应）' }
  const parsed = parseVisionGrid(text)
  if (!parsed.ok) {
    return { ok: false, message: `模型输出无法解析：${parsed.reason}（原文前 160 字：${text.trim().slice(0, 160)}）` }
  }
  return { ok: true, grid: parsed.grid, note: parsed.note, raw: text }
}
