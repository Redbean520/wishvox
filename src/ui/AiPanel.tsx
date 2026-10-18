import { useEffect, useRef, useState } from 'react'
import { getAiSession } from '../app/runtime'
import { useAiUi } from '../state/ai-store'
import { AiGateCard } from './AiGateCard'
import { AiSession } from './AiSession'
import { AiSettings } from './AiSettings'
import { Pane } from './Pane'

// r05 T4（末批）· **AI 工作台**（规格 §1.2「AI 工作台」行 · §1.4-2 的三段拆件 · `REQ-060`/`061`）：
//   件一 `AiSettings`  = 二级折叠「🔌 AI 连接」（设置面，未配置时默认展开）
//   件二 `AiSession`   = 会话流 + 相位行 + 错态出口 + 输入与「发送」
//   件三 `AiGateCard`  = **常显闸门卡**（挂 `pinned` 区 ⇒ 不随折叠收起，§3.2 / `REQ-061`）
//   本件 = 装配 + 折叠态**状态投影**（§2.3）。
// 折叠摘要口径（§1.2 / §2.3）：`{忙/等/错摘要} · {N 条指令｜空会话}`；**`pendingGate` 期间固定
// 「⚠️ 等待闸门批准」**（等态黄）——非「可操作」态必须投影进摘要，否则折叠后用户看不到"为什么没反应"。

export function AiPanel(): JSX.Element {
  const view = useAiUi((s) => s.view)
  const running = useAiUi((s) => s.running)
  const error = useAiUi((s) => s.error)
  const wire = useAiUi((s) => s.wire)
  const roundsUsed = useAiUi((s) => s.roundsUsed)
  const [text, setText] = useState('')
  const bootedRef = useRef(false)

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    getAiSession().pushView()
    void getAiSession().resumeIfPending() // 刷新后：未答闸门重入而非重问（V4）
  }, [])

  const send = (): void => {
    const t = text.trim()
    if (t === '' || running) return
    setText('')
    void getAiSession().sendOrder(t)
  }

  const lastJob = view?.jobs[view.jobs.length - 1]
  const canRetry = !running && lastJob?.outcome?.outcome === 'incident'
  const jobCount = view?.jobs.length ?? 0
  const pendingGate = view?.pendingGate ?? null

  // 状态短语（§2.3-1）：等 > 错 > 忙 > 无（可操作态不写状态词）。
  const statePhrase = pendingGate
    ? { text: '⚠️ 等待闸门批准', color: 'var(--warn)' }
    : wire?.phase === 'error'
      ? { text: '请求失败', color: 'var(--err)' }
      : running
        ? { text: '进行中…', color: 'var(--ok)' }
        : null

  return (
    <Pane
      id="ai"
      summary={
        <>
          {statePhrase && <span style={{ color: statePhrase.color }}>{statePhrase.text} · </span>}
          {jobCount === 0 ? '空会话' : `${jobCount} 条指令`}
        </>
      }
      accessory={<AiGateCard />}
    >
      <AiSettings />
      <AiSession
        view={view}
        running={running}
        roundsUsed={roundsUsed}
        error={error}
        canRetry={canRetry}
        text={text}
        setText={setText}
        send={send}
      />
    </Pane>
  )
}