import { cmd, commandEnabled, INSPECT_READONLY } from './commands'
import { useEditorUi } from '../state/editor-store'
import { Pane } from './Pane'

// F12 可点击撤销历史（尽力层 · R1 裁定，参照 vengi MementoPanel）：
// 列表**只读**（seq · 操作名 label · 改动格数）；**点击某行 = undo(n)/redo(n) 跳到该笔之后**（V13）。
// label 来自补丁的"操作名"字段（纪律 ③）——每笔都有可读名字。
// r05 T3：本块归**建模组**（Q2 裁定——历史跳转 = undo/redo n 次，改模型；参考稿放视图组，本批互换）。
export function HistoryPanel(): JSX.Element {
  const history = useEditorUi((s) => s.history)
  const mode = useEditorUi((s) => s.mode)
  const disabled = mode !== 'edit'
  // 折叠态摘要（§1.2 表「撤销历史」行）= `{n} 笔`；有已撤销时追加 `· {m} 笔已撤销`；检视态追加 `· 检视态只读`。
  const undoneCount = history.filter((h) => h.state === 'undone').length
  const hint = `${history.length} 笔${undoneCount > 0 ? ` · ${undoneCount} 笔已撤销` : ''}${disabled ? ' · 检视态只读' : ''}`

  return (
    <Pane id="history" summary={hint}>
      {disabled && <p className="warn">{INSPECT_READONLY}</p>}
      {history.length === 0 && <p className="note">（还没有补丁）</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 240, overflowY: 'auto' }}>
        {history.map((h) => {
          const c = cmd.historyJump(h.seq)
          return (
            <li key={`${h.seq}-${h.state}`}>
              <button
                style={{
                  width: '100%',
                  textAlign: 'left',
                  display: 'flex',
                  gap: 6,
                  fontSize: 12,
                  opacity: h.state === 'undone' ? 0.55 : 1,
                }}
                disabled={disabled || !commandEnabled(c)}
                title={disabled ? '检视态不可编辑' : `跳到补丁 ${h.seq} 之后（undo/redo n 次）`}
                onClick={() => c.run()}
              >
                <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', flex: 'none' }}>#{h.seq}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</span>
                <span style={{ color: 'var(--mute)', flex: 'none' }}>
                  {h.state === 'undone' ? '已撤销' : `${h.cells} 格`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {history.length > 0 && (
        <p className="note">灰行 = 已撤销的补丁（点击可重做到该处）。</p>
      )}
    </Pane>
  )
}