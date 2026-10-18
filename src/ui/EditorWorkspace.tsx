import { cmd } from './commands'
import { useEditorUi } from '../state/editor-store'
import { Viewport } from './Viewport'
import { ViewportHud } from './ViewportHud'
import { UI_BOUNDARY_ATTR } from './UiInputBoundary'

// 视口舞台：Viewport（three.js 宿主）铺满，HUD 与右上角视图工具条是覆盖层。
// 固定侧栏后视口尺寸由 CSS 网格决定，无需 JS 量测；工具条提供"没有右键也能操作"的入口。
export function EditorWorkspace(): JSX.Element {
  const mode = useEditorUi((s) => s.mode)
  return (
    <main className="stage" data-stage="true" {...{ [UI_BOUNDARY_ATTR]: 'viewport-stage' }}>
      <div className="viewport-host">
        <Viewport />
      </div>
      <ViewportHud />
      <div className="stage-tools">
        <button className="tool" title={mode === 'edit' ? '切换到检视态（左键旋转/右键平移）' : '切换到编辑态（左键笔刷）'} onClick={() => cmd.toggleMode.run()}>
          {mode === 'edit' ? '✏ 编辑' : '👁 检视'}
        </button>
        <button className="tool" title="复位视角（对准模型中心）" onClick={() => cmd.cameraReset.run()}>
          ⌂ 复位
        </button>
      </div>
    </main>
  )
}
