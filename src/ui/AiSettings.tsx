import { getAiSession } from '../app/runtime'
import { PROVIDER_PRESETS } from '../ai/settings'
import type { AiSettings } from '../ai/settings'
import { useAiUi } from '../state/ai-store'
import { isUnconfigured, WireLine } from './AiWire'
import { Section } from './Section'

// r05 T4 件一 · 设置块（规格 §1.4-2 的三段之一 / §1.2「↳ AI 连接」行）：
// AI 工作台内的二级折叠——**默认收起，未配置（无 baseUrl + apiKey）时默认展开**（等用户填入 ⇒ 首次引导）。
// 折叠态摘要 = 件一的 `WireLine`（`{preset|custom} · {wireText}` / 「未连接 · 先连上再聊」）。
// REQ-004 五项（端点 / baseURL / 模型 / key / 档位 + 语言）与 REQ-013（key 只存本地、无服务端）语义未变。
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0', fontSize: 12 }
const inputStyle: React.CSSProperties = { flex: 1 }

export function AiSettings(): JSX.Element {
  const settings = useAiUi((s) => s.settings)
  const upd = (patch: Partial<AiSettings>): void => {
    getAiSession().setSettings(patch)
  }
  // r04 T5（D7 消重）：settings 首值由 bootstrap 的 pushView 种入；null 只在组合根未跑时出现
  // （main.tsx 恒先 bootstrap 再 render，此分支是类型完备性兜底）。
  const defaultOpen = isUnconfigured(settings)
  if (!settings) {
    return (
      <Section title="AI 连接" emoji="🔌" defaultOpen={defaultOpen} hint={<WireLine />}>
        <WireLine />
      </Section>
    )
  }
  return (
    <Section title="AI 连接" emoji="🔌" defaultOpen={defaultOpen} hint={<WireLine />}>
      <WireLine />
      <div style={{ marginTop: 6 }}>
        <div style={rowStyle}>
          端点：
          <select
            value={settings.presetId}
            style={inputStyle}
            onChange={(e) => {
              const preset = PROVIDER_PRESETS.find((p) => p.id === e.target.value)
              if (preset && preset.id !== 'custom') upd({ presetId: preset.id, baseUrl: preset.baseUrl, model: preset.model })
              else upd({ presetId: 'custom' })
            }}
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <label className="field">
          baseURL
          <input value={settings.baseUrl} placeholder="https://api.example.com" onChange={(e) => upd({ baseUrl: e.target.value.trim(), presetId: 'custom' })} />
        </label>
        <label className="field">
          模型
          <input value={settings.model} placeholder="deepseek-chat" onChange={(e) => upd({ model: e.target.value.trim() })} />
        </label>
        <label className="field">
          视觉模型（图纸识别，可留空）
          <input
            value={settings.visionModel}
            placeholder="gpt-4o / qwen-vl-max（支持图片输入）"
            onChange={(e) => upd({ visionModel: e.target.value.trim() })}
          />
        </label>
        <label className="field">
          API Key
          <input type="password" value={settings.apiKey} placeholder="只存浏览器本地（BYOK）" onChange={(e) => upd({ apiKey: e.target.value.trim() })} />
        </label>
        <div style={rowStyle}>
          监督档位：
          <select value={settings.oversight} style={inputStyle} onChange={(e) => upd({ oversight: e.target.value as AiSettings['oversight'] })}>
            <option value="strict">strict（每个写都批）</option>
            <option value="checkpoint">checkpoint（只批宽操作）</option>
            <option value="yolo">yolo（不批）</option>
          </select>
        </div>
        <div style={rowStyle}>
          语言：
          <select value={settings.language} style={inputStyle} onChange={(e) => upd({ language: e.target.value as AiSettings['language'] })}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <p className="note">key 与会话日志只存浏览器本地，无服务端（REQ-013 / V5）。视觉模型仅用于「图纸 → 方块」识图，留空则只用本地识别。</p>
      </div>
    </Section>
  )
}