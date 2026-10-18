import { useEditorUi } from '../state/editor-store'

// 左上 HUD：模型 AABB / 预览读数 / 无效原因 / 操作提示。
// D5：预览全无效时给一行黄字短原因（与状态栏的 message 通道不重复）。
export function ViewportHud(): JSX.Element {
  const bounds = useEditorUi((s) => s.boundsReadout)
  const preview = useEditorUi((s) => s.previewReadout)
  const warn = useEditorUi((s) => s.previewReject)
  const mode = useEditorUi((s) => s.mode)
  return (
    <div className="hud" role="status" aria-live="polite">
      {bounds ? (
        <>
          <div>
            <b>W {bounds.w}</b> · H {bounds.h} · L {bounds.l}
          </div>
          <div>
            x {bounds.min[0]}..{bounds.max[0]} · y {bounds.min[1]}..{bounds.max[1]} · z {bounds.min[2]}..{bounds.max[2]}
          </div>
        </>
      ) : (
        <div>（空模型）</div>
      )}
      {preview !== null && (
        <div className="hud-preview">
          预览 {preview.size[0]}×{preview.size[1]}×{preview.size[2]} @ ({preview.anchor[0]}, {preview.anchor[1]}, {preview.anchor[2]}) · {preview.cells} 格
        </div>
      )}
      {warn !== null && (
        <div key={warn.seq} className="hud-warn flash">
          ⚠ {warn.text}
        </div>
      )}
      <div className="hud-hint">
        {mode === 'edit'
          ? '编辑态：左键笔刷 · Shift+左键 旋转 · 中键 / Alt+左键 平移 · 滚轮缩放'
          : '检视态：左键旋转 · 中键 / 右键 平移 · 滚轮缩放'}
      </div>
    </div>
  )
}