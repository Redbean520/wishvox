// OpenAI 兼容 wire 形状：把本项目的消息面（`ProviderMessage`）与工具面（`AiToolSchema`）
// 转成 Chat Completions 的 JSON 数组。**只做形状转换**——传输、SSE 解析、重试在 `provider.ts`。
//
// 多模态（拼豆图纸识别）：`user` 消息可带 `images`，拼成 content parts
// （`{type:'text'}` + `{type:'image_url'}`）。不带图片时输出与单模态完全一致——
// 既有调用方的 wire 形状不变（视觉通道是纯增量）。
import type { ProviderMessage } from './provider'
import type { AiToolSchema } from './tools'

export function toWireMessages(messages: readonly ProviderMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content ?? null,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      }
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content ?? '' }
    if (m.role === 'user' && m.images !== undefined && m.images.length > 0) {
      const text = m.content ?? ''
      return {
        role: 'user',
        content: [
          ...(text === '' ? [] : [{ type: 'text', text }]),
          ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      }
    }
    return { role: m.role, content: m.content ?? '' }
  })
}

export function toWireTools(tools: readonly AiToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}
