import { Viewport } from './Viewport'
import { ViewportHud } from './ViewportHud'
import { UI_BOUNDARY_ATTR } from './UiInputBoundary'

// 视口舞台：Viewport（three.js 宿主）铺满，HUD 是浮在左上角的覆盖层。
// 旧版的"九块布局量测"随悬浮体系一起移除——固定侧栏后视口尺寸由 CSS 网格决定，无需 JS 量测。
export function EditorWorkspace(): JSX.Element {
  return (
    <main className="stage" data-stage="true" {...{ [UI_BOUNDARY_ATTR]: 'viewport-stage' }}>
      <div className="viewport-host">
        <Viewport />
      </div>
      <ViewportHud />
    </main>
  )
}