import { useEffect } from 'react'
import { getEditor } from '../app/runtime'
import { useEditorUi } from '../state/editor-store'
import { EditorWorkspace } from './EditorWorkspace'
import { isUiEventTarget } from './UiInputBoundary'
import { RightDock } from './shell/RightDock'
import { LeftRail } from './shell/LeftRail'
import { StatusBar } from './shell/StatusBar'
import { TopBar } from './shell/TopBar'
import { APP_CSS } from './theme'

// 应用外壳（UI 重构 r07）：顶栏 + 三栏主体（左工具 / 中视口 / 右 Dock）+ 状态栏。
// 旧的「9 个悬浮方块」体系移除：面板收进右 Dock 标签页，视口不再被遮挡；
// 状态逻辑仍全部走具名命令（commands.ts）与 zustand 投影，这里只做布局与快捷键接线。
export function App(): JSX.Element {
  const mode = useEditorUi((s) => s.mode)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      // UI 覆盖层上的按键不算画布输入：焦点在输入框/按钮时不触发模型撤销
      if (isUiEventTarget(e.target)) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        getEditor().undo()
      } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault()
        getEditor().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="shell" data-mode={mode}>
      <style>{APP_CSS}</style>
      <TopBar />
      <div className="shell-body">
        <LeftRail />
        <EditorWorkspace />
        <RightDock />
      </div>
      <StatusBar />
    </div>
  )
}

// 供测试与调试读取的稳定标识（不参与渲染逻辑）
export const APP_SHELL = { left: 'left-rail', stage: 'stage', right: 'right-dock' } as const