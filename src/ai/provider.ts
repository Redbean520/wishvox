// r03 · T3 provider 适配器（D-A：OpenAI 兼容 Chat Completions + 流式；DeepSeek 默认端点）。
// 容错数字照抄 PetitMaker（ai-flow-research §③-3"先例数字，不发明"）：
// · 重试梯：每逻辑轮 ≤5 次适配器尝试，退避 1000ms×2^n 封顶 30s，抖动 ×[0.75,1]（retry.ts:7-24）
// · 空流超时：首事件 300s / 事件间 120s（stream-idle.ts:8-10）
// · 错误三态分诊（①-32 收缩）：retryable / fatal / overflow——分类决定处置
import type { AiToolSchema } from './tools'

interface ProviderToolCall {
  readonly id: string
  readonly name: string
  readonly args: Record<string, unknown>
}

export interface ProviderMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  /** 多模态图片（data URL / http URL）。仅 `user` 角色会拼进 content parts——
   *  拼豆图纸识别（`ai/pattern-vision.ts`）用；不带图片时 wire 形状与单模态完全一致。 */
  readonly images?: readonly string[]
  /** assistant 消息的工具调用批 */
  readonly toolCalls?: readonly ProviderToolCall[]
  /** tool 消息对应的调用 id */
  readonly toolCallId?: string
}

export interface ChatRequest {
  readonly messages: readonly ProviderMessage[]
  readonly tools: readonly AiToolSchema[]
  readonly signal?: AbortSignal
}

export interface ChatResult {
  readonly text: string
  readonly calls: readonly ProviderToolCall[]
  readonly finishReason?: string
  readonly usage?: { promptTokens?: number; completionTokens?: number }
  /** 半截 / 畸形参数的调用（①-34）：不执行，由 loop 回"请重发完整参数" */
  readonly badCalls?: readonly ProviderToolCall[]
}

export interface ProviderAdapter {
  readonly id: string
  chat(req: ChatRequest): Promise<ChatResult>
}

/** T8（§4 件一）：线级状态快照（重试梯每级 + 首字节/字节间空闲翻转）；定义在 provider.ts 同文件内，
 *  sse 复用文件内的 SseParseStats（Q6：不替它单开跨文件导出）。 */
export interface WireState {
  readonly phase: 'connecting' | 'streaming' | 'idle-wait' | 'retrying' | 'done' | 'error'
  readonly attempt?: number // 适配器尝试序号（重试梯上报）
  readonly sse?: SseParseStats // SSE 解析统计（畸形行 / 事件计数）
  readonly elapsedMs: number // 自本轮请求开始的毫秒数
}

// ── 错误分类（三态；①-32）──

type ErrorKind = 'retryable' | 'fatal' | 'overflow'

export class ProviderError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    /** Retry-After 头换算的毫秒数（有则遵守） */
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

export function classifyHttpError(status: number, bodyText: string): ProviderError {
  const body = bodyText.slice(0, 400)
  if (status === 401 || status === 403) return new ProviderError('fatal', `鉴权失败（${status}）：${body}`)
  if (status === 402 || (status === 403 && /quota|余额/i.test(bodyText))) return new ProviderError('fatal', `配额不足（${status}）：${body}`)
  if (status === 404) return new ProviderError('fatal', `模型或端点不存在（404）：${body}`)
  if (status === 400) return new ProviderError('fatal', `请求被拒（400）：${body}`)
  if (status === 429) return new ProviderError('retryable', `限流（429）：${body}`)
  if (status >= 500) return new ProviderError('retryable', `服务端错误（${status}）：${body}`)
  return new ProviderError('retryable', `HTTP ${status}：${body}`)
}

function classifyContextOverflow(text: string): boolean {
  return /context length|maximum context|too many tokens|上下文长度/i.test(text)
}

// ── 空流超时（照抄 300s / 120s；测试可注入）──

export const IDLE_TIMEOUTS = { firstEventMs: 300_000, betweenEventsMs: 120_000 } as const

interface TimeoutDeps {
  readonly now?: () => number
  readonly setTimeoutFn?: (fn: () => void, ms: number) => { cancel: () => void }
}

/** 流读包裹：每段数据带截止时间；超时 ⇒ 可重试的 network 类错误 */
/** onChunk 返回 true = 上层已见 [DONE] ⇒ 立即停止读流（续单 §7.2 次要加固：
 *  真实服务 / 代理在 [DONE] 后不断流时，不再干等到 120s 间隔超时）。 */
async function readStreamWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (text: string) => boolean,
  timeouts: IdleTimeouts = IDLE_TIMEOUTS,
  deps: TimeoutDeps = {},
  onWait?: () => void,
): Promise<void> {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimeoutFn ?? ((fn, ms) => {
    const t = setTimeout(fn, ms)
    return { cancel: () => clearTimeout(t) }
  })
  let deadline = now() + timeouts.firstEventMs
  for (;;) {
    const remaining = deadline - now()
    if (remaining <= 0) throw new ProviderError('retryable', `空流超时：${timeouts.firstEventMs}ms 内没有任何流事件`)
    onWait?.() // T8 件一：等待下一段（首字节 / 字节间）⇒ idle-wait 翻转
    const timer = setTimer(() => {
      try {
        reader.cancel().catch(() => undefined)
      } catch {
        // ignore
      }
    }, remaining)
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } finally {
      timer.cancel()
    }
    if (chunk.done) return
    if (chunk.value && onChunk(new TextDecoder().decode(chunk.value, { stream: true }))) {
      void reader.cancel().catch(() => undefined) // [DONE] 收手：不再消费底层流
      return
    }
    deadline = now() + timeouts.betweenEventsMs
  }
}

// ── SSE 解析（半截 / 畸形行容错：跳过坏行计数，不崩——I5 / V2）──

interface SseParseStats {
  malformedLines: number
  events: number
}

/** 累积器：把 SSE 文本喂进来，得到最终 ChatResult。畸形行跳过并计数（降级产物之一） */
export class StreamAccumulator {
  text = ''
  private readonly calls = new Map<number, { id: string; name: string; argsText: string }>()
  finishReason: string | undefined
  usage: { promptTokens?: number; completionTokens?: number } = {}
  readonly stats: SseParseStats = { malformedLines: 0, events: 0 }
  private buffer = ''
  private doneSeen = false

  /** 喂一段 SSE 文本；返回 true = 已见 [DONE]（调用方应停止读流） */
  feed(chunk: string): boolean {
    if (this.doneSeen) return true
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? '' // 最后一段可能是不完整行——留到下一包（半截容错）
    for (const raw of lines) {
      const line = raw.trim()
      if (line === '' || line.startsWith(':')) continue // 注释/心跳行
      if (!line.startsWith('data:')) continue // 非数据行（event:/id:/retry:）忽略
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        this.doneSeen = true
        continue
      }
      let evt: unknown
      try {
        evt = JSON.parse(payload)
      } catch {
        this.stats.malformedLines++ // 畸形行：跳过不崩（V2 注入项之一）
        continue
      }
      this.stats.events++
      this.consume(evt as Record<string, unknown>)
    }
    return this.doneSeen
  }

  private consume(evt: Record<string, unknown>): void {
    const choices = evt.choices as Array<Record<string, unknown>> | undefined
    const delta = choices?.[0]?.delta as Record<string, unknown> | undefined
    if (typeof delta?.content === 'string') this.text += delta.content
    const toolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const index = typeof tc.index === 'number' ? tc.index : 0
        const fn = tc.function as Record<string, unknown> | undefined
        const cur = this.calls.get(index) ?? { id: '', name: '', argsText: '' }
        if (typeof tc.id === 'string' && tc.id !== '') cur.id = tc.id
        if (typeof fn?.name === 'string' && fn.name !== '') cur.name += fn.name === cur.name ? '' : fn.name
        if (typeof fn?.arguments === 'string') cur.argsText += fn.arguments
        this.calls.set(index, cur)
      }
    }
    const fr = choices?.[0]?.finish_reason
    if (typeof fr === 'string') this.finishReason = fr
    const usage = evt.usage as Record<string, unknown> | undefined
    if (usage) {
      if (typeof usage.prompt_tokens === 'number') this.usage.promptTokens = usage.prompt_tokens
      if (typeof usage.completion_tokens === 'number') this.usage.completionTokens = usage.completion_tokens
    }
  }

  /** 汇总：工具调用参数按 JSON 解析；半截 JSON（I5）⇒ 标记 badCall，由调用方回"重发完整参数" */
  result(): ChatResult & { badCalls: ProviderToolCall[] } {
    const calls: ProviderToolCall[] = []
    const badCalls: ProviderToolCall[] = []
    for (const [, c] of [...this.calls.entries()].sort((a, b) => a[0] - b[0])) {
      const id = c.id || `call_bad_${calls.length + badCalls.length}`
      if (c.name === '') {
        badCalls.push({ id, name: '(missing-name)', args: { _raw: c.argsText } })
        continue
      }
      if (c.argsText.trim() === '') {
        calls.push({ id, name: c.name, args: {} })
        continue
      }
      try {
        calls.push({ id, name: c.name, args: JSON.parse(c.argsText) as Record<string, unknown> })
      } catch {
        badCalls.push({ id, name: c.name, args: { _raw: c.argsText } }) // 半截 JSON：不执行、要求重发（①-34）
      }
    }
    return { text: this.text, calls, finishReason: this.finishReason, usage: this.usage, badCalls }
  }
}

// ── OpenAI 兼容适配器 ──
// （wire 形状转换在 `wire.ts`：messages / tools 的 Chat Completions 数组，含多模态 content parts）
import { toWireMessages, toWireTools } from './wire'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

interface IdleTimeouts {
  readonly firstEventMs: number
  readonly betweenEventsMs: number
}

interface OpenAiCompatOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly fetchImpl?: FetchLike
  readonly timeouts?: IdleTimeouts
  readonly timeoutDeps?: TimeoutDeps
  /** 测试钩子：拿到响应后、解析流前（注入 5xx 等场景不需要；保留给 harness） */
  readonly temperature?: number
  readonly onWireState?: (s: WireState) => void // T8 件一：流式 / 空闲翻转（可选，不改请求语义）
}


/** OpenAI 兼容 Chat Completions（流式 SSE）。fetch 可注入（tests / harness 的脚本化 provider） */
export class OpenAiCompatAdapter implements ProviderAdapter {
  readonly id: string

  constructor(private readonly opts: OpenAiCompatOptions) {
    this.id = `openai-compat:${opts.model}`
    if (opts.baseUrl && !/^https?:\/\//.test(opts.baseUrl)) {
      throw new ProviderError('fatal', `baseURL 必须是 http(s) 地址（收到 ${opts.baseUrl}）`)
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const doFetch = this.opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined)
    if (!doFetch) throw new ProviderError('fatal', '当前环境没有 fetch（浏览器或 Node ≥18 自带）')
    if (!this.opts.apiKey) throw new ProviderError('fatal', '未配置 API key（设置面板填入 BYOK key）')
    let response: Response
    try {
      response = await doFetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          messages: toWireMessages(req.messages),
          // 空工具面不发送（视觉识别是一次性读图请求：部分 OpenAI 兼容端点拒收 "tools": []）
          ...(req.tools.length > 0 ? { tools: toWireTools(req.tools) } : {}),
          stream: true,
          ...(this.opts.temperature !== undefined ? { temperature: this.opts.temperature } : {}),
        }),
        signal: req.signal,
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new ProviderError('fatal', '已中止')
      throw new ProviderError('retryable', `网络错误：${(e as Error).message}`)
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const retryAfter = Number(response.headers.get('retry-after') ?? '')
      const err = classifyHttpError(response.status, body)
      if (Number.isFinite(retryAfter) && retryAfter > 0) throw new ProviderError(err.kind, err.message, retryAfter * 1000)
      throw err
    }
    if (!response.body) throw new ProviderError('retryable', '响应没有流 body（非流式端点？）')
    const acc = new StreamAccumulator()
    const now = this.opts.timeoutDeps?.now ?? Date.now
    const startedAt = now()
    const wire = (phase: WireState['phase']): void => this.opts.onWireState?.({ phase, elapsedMs: now() - startedAt, sse: acc.stats })
    await readStreamWithIdleTimeout(
      response.body.getReader(),
      (t) => { const done = acc.feed(t); wire('streaming'); return done },
      this.opts.timeouts,
      this.opts.timeoutDeps,
      () => wire('idle-wait'),
    )
    const result = acc.result()
    if (acc.stats.events === 0) throw new ProviderError('retryable', `空流：0 个流事件（畸形行 ${acc.stats.malformedLines} 个）`)
    if (classifyContextOverflow(result.text)) throw new ProviderError('overflow', '上下文超限')
    return {
      text: result.text,
      calls: result.calls,
      finishReason: result.finishReason,
      usage: result.usage,
      ...(result.badCalls.length > 0 ? { badCalls: result.badCalls } : {}),
    }
  }
}

// ── 重试梯（照抄：≤5 次尝试 / 指数退避封顶 30s / 抖动 [0.75,1] / Retry-After 优先）──

export const RETRY_LADDER = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30_000, jitter: [0.75, 1] as const } as const

interface RetryDeps {
  readonly sleep: (ms: number) => Promise<void>
  readonly random?: () => number
  readonly now?: () => number
  readonly onWireState?: (s: WireState) => void // T8 件一：重试梯每级 + 终态
}

interface RetryOutcome {
  readonly result?: ChatResult
  readonly error?: ProviderError
  readonly attempts: number
}

/** 每逻辑轮的适配器尝试梯：只有 retryable 走梯；fatal / overflow 立即出。 */
export async function chatWithRetry(adapter: ProviderAdapter, req: ChatRequest, deps: RetryDeps): Promise<RetryOutcome> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const wire = (phase: WireState['phase'], attempt: number): void => deps.onWireState?.({ phase, attempt, elapsedMs: now() - startedAt })
  let attempt = 0
  for (;;) {
    attempt++
    wire(attempt === 1 ? 'connecting' : 'retrying', attempt)
    try {
      const result = await adapter.chat(req)
      wire('done', attempt)
      return { result, attempts: attempt }
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('retryable', (e as Error).message)
      if (err.kind !== 'retryable' || attempt >= RETRY_LADDER.maxAttempts) {
        wire('error', attempt)
        return { error: err, attempts: attempt }
      }
      let delay = Math.min(RETRY_LADDER.baseDelayMs * 2 ** (attempt - 1), RETRY_LADDER.maxDelayMs)
      if (err.retryAfterMs !== undefined) delay = Math.min(Math.max(err.retryAfterMs, delay), RETRY_LADDER.maxDelayMs * 2)
      const rand = deps.random ?? Math.random
      delay = Math.round(delay * (RETRY_LADDER.jitter[0] + rand() * (RETRY_LADDER.jitter[1] - RETRY_LADDER.jitter[0])))
      await deps.sleep(delay)
    }
  }
}

// ── 本地预检 screen()（①-3：空指令 / 纯聊天不过网即可拒单）──

const GREETING_RE = /^(你好|您好|hi|hello|hey|在吗|嗨)[!！。.~\s]*$/i

export function screen(orderText: string): { pass: true } | { pass: false; reason: string } {
  const text = orderText.trim()
  if (text === '') return { pass: false, reason: '空指令——请输入要怎么改模型' }
  // 寒暄（"你好"两字也是寒暄）先于"太短"判——更具体的口径在前
  if (GREETING_RE.test(text)) return { pass: false, reason: '这句像纯聊天，没有编辑指令——不出网不调用模型' }
  if (text.length <= 2 && !/[\d]/.test(text)) return { pass: false, reason: '指令太短——说清要改什么（例："把屋顶改成红色"）' }
  return { pass: true }
}