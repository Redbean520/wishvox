// r03 · AI 连接设置（REQ-004 最小面：AI 连接 + 语言；REQ-013 BYOK）。
// D-A 拍板（2026-10-05）：OpenAI 兼容 Chat Completions + 自定义 baseURL；默认端点/模型 = DeepSeek；
// 其他厂商的 key 通过「自定义（OpenAI 兼容）」接入位预留（第二适配器 = 以后层）。
// V5：key 只存浏览器本地（localStorage），无服务端——网络面板无第三方上报。

/** 内置 provider 预填（「其他厂商预留接入接口」的落点：加一行即接入新的 OpenAI 兼容端点） */
interface ProviderPreset {
  readonly id: string
  readonly label: string
  readonly baseUrl: string
  readonly model: string
  readonly httpsOnly: boolean
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek（默认）', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', httpsOnly: true },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '', httpsOnly: true },
]

export interface AiSettings {
  /** preset id（deepseek | custom）——决定预填；实际请求只看 baseUrl/model */
  readonly presetId: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  /** 视觉模型（可选）：图纸识别用；留空 = 只用本地识别。与上面同 baseURL / key，
   *  填一个支持图片输入的模型名（如 gpt-4o / qwen-vl-max），默认 DeepSeek chat 不支持看图。 */
  readonly visionModel: string
  /** 监督档位（REQ-010 三档；口径卡 §二） */
  readonly oversight: 'strict' | 'checkpoint' | 'yolo'
  /** 语言（REQ-004：设置面板可存语言偏好；首版只影响系统提示词的输出语言句） */
  readonly language: 'zh' | 'en'
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  presetId: 'deepseek',
  baseUrl: PROVIDER_PRESETS[0].baseUrl,
  apiKey: '',
  model: PROVIDER_PRESETS[0].model,
  visionModel: '',
  oversight: 'strict',
  language: 'zh',
}

// 2026-10-17 品牌改名（`voxel-ai-editor` → `wishvox`）：键名直改、不做迁移（公开新仓无存量用户；旧键孤儿化）。
const STORAGE_KEY = 'wishvox/ai-settings/v1'

/** localStorage 读写（浏览器本地 = BYOK 主防线；测试用内存实现或不触碰） */
export interface AiSettingsStore {
  load(): AiSettings
  save(s: AiSettings): void
}

class LocalSettingsStore implements AiSettingsStore {
  load(): AiSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { ...DEFAULT_AI_SETTINGS }
      return { ...DEFAULT_AI_SETTINGS, ...(JSON.parse(raw) as Partial<AiSettings>) }
    } catch {
      return { ...DEFAULT_AI_SETTINGS }
    }
  }

  save(s: AiSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {
      // localStorage 不可用（隐私模式等）：设置只活在内存里，不报错不崩
    }
  }
}

class MemorySettingsStore implements AiSettingsStore {
  private value: AiSettings = { ...DEFAULT_AI_SETTINGS }
  load(): AiSettings {
    return { ...this.value }
  }
  save(s: AiSettings): void {
    this.value = { ...s }
  }
}

export function createSettingsStore(): AiSettingsStore {
  try {
    if (typeof localStorage !== 'undefined') return new LocalSettingsStore()
  } catch {
    // fallthrough
  }
  return new MemorySettingsStore()
}

/**
 * `REQ-067`（2026-10-17 追加）：清空本地 AI 设置（含 api key）——只删 localStorage 键，
 * 不动内存中的设置对象（内存侧随「清理本地数据」后的页面重载整体重置）。
 * 与 `REQ-067` 的「恰好三项」对齐：本函数只碰 `ai-settings` 一个键，不枚举、不清其它键。
 */
export function clearStoredAiSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage 不可用（隐私模式等）：无需清理
  }
}
