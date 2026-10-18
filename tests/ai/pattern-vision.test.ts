// 图纸识别的 AI 视觉通道（L1）：模型输出解析（容忍围栏 / 前后说明 / 多种格子写法）+ 端到端请求形状。
import { describe, expect, it } from 'vitest'
import { visionGridPrompt } from '../../src/ai/pattern-vision'
import { parseVisionGrid, recognizePatternWithVision } from '../../src/ai/pattern-vision'
import { makeScriptedAdapter, roundStep } from '../../src/ai/scripted-provider'

const json = (obj: unknown): string => JSON.stringify(obj)

describe('AI-P1 · 解析模型输出', () => {
  it('代码块围栏 + 前后说明 + null / rgb() 写法都能解析', () => {
    const text = `好的，识别结果如下：
\`\`\`json
{"cols": 2, "rows": 2, "cells": [["#c0392b", null], ["#3b6ea5", "rgb(232, 197, 71)"]]}
\`\`\`
以上。`
    const parsed = parseVisionGrid(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.grid.cols).toBe(2)
    expect(parsed.grid.rows).toBe(2)
    expect(parsed.grid.cells).toEqual(['#c0392b', null, '#3b6ea5', '#e8c547'])
  })

  it('空位写法归一：null / "" / "空" / "." / "#c0392bff"（8 位丢 alpha）', () => {
    const parsed = parseVisionGrid(json({ cols: 5, rows: 1, cells: [['null', '', '空', '.', '#C0392BFF']] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.grid.cells).toEqual([null, null, null, null, '#c0392b'])
  })

  it('扁平 cells + cols 也能还原成网格', () => {
    const parsed = parseVisionGrid(json({ cols: 2, rows: 2, cells: ['#aabbcc', null, '#112233', '#445566'] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.grid.cells).toEqual(['#aabbcc', null, '#112233', '#445566'])
  })

  it('模型报告 error ⇒ 可读失败原因', () => {
    const parsed = parseVisionGrid(json({ error: '图片太模糊' }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain('图片太模糊')
  })

  it('行长度不一致 / 超上限 / 不是 JSON ⇒ 失败（不产出半个网格）', () => {
    expect(parseVisionGrid(json({ cells: [['#aabbcc', null], ['#112233']] })).ok).toBe(false)
    const huge = Array.from({ length: 129 }, () => Array.from({ length: 129 }, () => '#aabbcc'))
    expect(parseVisionGrid(json({ cells: huge })).ok).toBe(false)
    expect(parseVisionGrid('没有 JSON').ok).toBe(false)
  })

  it('提示词包含输出契约关键词（列/行/cells/#rrggbb/null/128）', () => {
    const zh = visionGridPrompt('zh')
    for (const key of ['cols', 'rows', 'cells', '#rrggbb', 'null', '128×128']) expect(zh).toContain(key)
    expect(visionGridPrompt('en')).toContain('row-major')
  })
})

describe('AI-P2 · 端到端（脚本化 provider，线级 SSE）', () => {
  it('请求带图片 content parts、不带 tools；响应解析成网格', async () => {
    let captured: Record<string, unknown> | null = null
    const { adapter } = makeScriptedAdapter(
      [roundStep({ text: json({ cols: 1, rows: 2, cells: [['#c0392b'], ['#3b6ea5']] }) })],
      { onRequest: (body) => { captured = body as Record<string, unknown> } },
    )
    const dataUrl = 'data:image/jpeg;base64,AAAA'
    const result = await recognizePatternWithVision({
      dataUrl,
      baseUrl: 'http://scripted.local',
      apiKey: 'test-key',
      model: 'vision-model',
      adapter,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.grid.cells).toEqual(['#c0392b', '#3b6ea5'])

    expect(captured).not.toBeNull()
    const body = captured as unknown as Record<string, unknown>
    expect(body.model).toBe('scripted-model')
    expect(body.tools).toBeUndefined() // 一次性读图请求不发空工具面
    const messages = body.messages as Array<Record<string, unknown>>
    const user = messages.find((m) => m.role === 'user')!
    expect(Array.isArray(user.content)).toBe(true)
    const parts = user.content as Array<Record<string, unknown>>
    expect(parts.some((p) => p.type === 'image_url' && (p.image_url as { url: string }).url === dataUrl)).toBe(true)
    expect(parts.some((p) => p.type === 'text' && String(p.text).includes('cells'))).toBe(true)
  })

  it('未配置 key / 模型 ⇒ ok:false（不出网）', async () => {
    const noKey = await recognizePatternWithVision({ dataUrl: 'data:image/jpeg;base64,AA', baseUrl: 'http://x.local', apiKey: '', model: 'm' })
    expect(noKey.ok).toBe(false)
    if (noKey.ok) return
    expect(noKey.message).toContain('API key')
    const noModel = await recognizePatternWithVision({ dataUrl: 'data:image/jpeg;base64,AA', baseUrl: 'http://x.local', apiKey: 'k', model: '' })
    expect(noModel.ok).toBe(false)
    if (noModel.ok) return
    expect(noModel.message).toContain('视觉模型')
  })

  it('模型返回不可解析文本 ⇒ ok:false 且带原文片段', async () => {
    const { adapter } = makeScriptedAdapter([roundStep({ text: '我看到了一个红色的方块。' })])
    const result = await recognizePatternWithVision({ dataUrl: 'data:image/jpeg;base64,AA', baseUrl: 'http://x.local', apiKey: 'k', model: 'm', adapter })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('无法解析')
  })
})
