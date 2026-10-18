import { useState } from 'react'
import type { ReactNode } from 'react'
import { AiPanel } from '../AiPanel'
import { CameraPanel } from '../CameraPanel'
import { HistoryPanel } from '../HistoryPanel'
import { LayerPanel } from '../LayerPanel'
import { NoisePanel } from '../NoisePanel'
import { OpsPanel } from '../OpsPanel'
import { StylePanel } from '../Panels'
import { PartTree } from '../PartTree'
import { PatternImport } from '../PatternImport'
import { useAiUi } from '../../state/ai-store'
import { UI_BOUNDARY_ATTR } from '../UiInputBoundary'

// 右栏 Dock：低频/高频面板统一收进标签页，替换旧的 9 个悬浮方块。
// **全部面板常驻挂载**（只切显隐）——表单草稿、AI 会话视图、卷动位置都不因切标签丢失
// （旧悬浮块的开关态只是"渲染不渲染正文"，这里用 display 保证同样的状态保持语义）。
interface DockTab {
  readonly id: string
  readonly label: string
  readonly content: ReactNode
}

export function RightDock(): JSX.Element {
  const pendingGate = useAiUi((s) => s.view?.pendingGate ?? null)
  const [active, setActive] = useState(typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('tab') ?? 'ai') : 'ai')
  const tabs: DockTab[] = [
    { id: 'ai', label: 'AI', content: <AiPanel /> },
    { id: 'pattern', label: '图纸', content: <PatternImport /> },
    { id: 'parts', label: '结构', content: <PartTree /> },
    { id: 'ops', label: '操作', content: <OpsPanel /> },
    { id: 'noise', label: '噪声', content: <NoisePanel /> },
    { id: 'history', label: '历史', content: <HistoryPanel /> },
    { id: 'view', label: '显示', content: (
      <>
        <LayerPanel />
        <CameraPanel />
        <StylePanel />
      </>
    ) },
  ]
  return (
    <aside className="right-dock" {...{ [UI_BOUNDARY_ATTR]: 'right-dock' }}>
      <div className="dock-tabs" role="tablist" aria-label="右侧面板">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? 'dock-tab on' : 'dock-tab'}
            onClick={() => setActive(t.id)}
          >
            {t.label}
            {t.id === 'ai' && pendingGate !== null && <span className="tab-badge" aria-label="有等待批准的闸门">⚠</span>}
          </button>
        ))}
      </div>
      <div className="dock-body">
        {tabs.map((t) => (
          <div key={t.id} role="tabpanel" hidden={active !== t.id}>
            {t.content}
          </div>
        ))}
      </div>
    </aside>
  )
}