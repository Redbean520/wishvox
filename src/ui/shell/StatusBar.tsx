import { useEditorUi } from '../../state/editor-store'

// 状态栏：模型规模 / 构件 / 组合 / 最后一条消息。
export function StatusBar(): JSX.Element {
  const nonEmpty = useEditorUi((s) => s.nonEmpty)
  const parts = useEditorUi((s) => s.parts)
  const compositions = useEditorUi((s) => s.compositions)
  const message = useEditorUi((s) => s.message)
  return (
    <footer className="statusbar">
      <span className="stat">
        方块 <b>{nonEmpty}</b>
      </span>
      <span className="sep" />
      <span className="stat">
        构件 <b>{parts.length}</b>
      </span>
      <span className="stat">
        组合 <b>{compositions.length}</b>
      </span>
      <span className="sep" />
      <span className="msg">{message ?? '就绪'}</span>
    </footer>
  )
}