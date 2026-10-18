// r06（`REQ-062` 2026-10-17 改口径）· 首运行（无存档）默认展示件的加载器。
//
// 可替换默认件 = 换 `public/showcase/` 下的文件 + 改下面**这一个常量**；加载与首运行分支零改动。
// 标题只从件内 `meta.title` 读（文件自描述），代码里**不写死**任何标题。
// 失败一律 `null`（无 fetch / 非 2xx / 网络错 / 解码失败）⇒ 调用方退回 `seedBlank`，绝不误报成功。
import type { ProjectFileV2 } from '../core/types'
import { decodeProject } from './serialize'

/**
 * 展示件 URL（唯一常量）。`public/` 的内容随部署 `base` 落地 ⇒ 用 Vite 的 `BASE_URL` 自适配：
 * 本地 dev / vitest 下 `BASE_URL='/'` 得 `/showcase/…`；GitHub 项目页构建下得 `/wishvox/showcase/…`。
 * 替换默认件仍只需换 `public/showcase/` 文件（本常量只写文件名）。
 */
// `import.meta.env` 只在 Vite 构建里存在：非 Vite 环境（Node 里跑集成脚本）退回根路径，不崩
export const SHOWCASE_URL = `${import.meta.env?.BASE_URL ?? '/'}showcase/blue-big-fat-fish.json`

/** 注入面：只要求 fetch 的"够用形状"（`ok` + `text()`），不绑 `Response` 具体实现（无头测试可直造）。 */
export type ShowcaseFetch = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>

/**
 * 取展示件并解码（`S2`/`K0`）。
 * @param fetchFn 测试注入；缺省 = 全局 `fetch`（无 fetch 的环境 ⇒ 直接 `null`，不抛错）。
 * @returns 解码通过的 `ProjectFileV2`；任何失败 ⇒ `null`（调用方负责降级）。
 */
export async function loadDefaultShowcase(fetchFn?: ShowcaseFetch): Promise<ProjectFileV2 | null> {
  const impl: ShowcaseFetch | null = fetchFn ?? (typeof fetch === 'function' ? fetch : null)
  if (!impl) return null
  try {
    const res = await impl(SHOWCASE_URL)
    if (!res.ok) return null
    const result = decodeProject(await res.text())
    return result.ok ? result.file : null
  } catch {
    return null
  }
}