import { useState } from 'react'
import { cmd, commandEnabled, INSPECT_READONLY } from './commands'
import { getEditor } from '../app/runtime'
import { useEditorUi } from '../state/editor-store'
import { Pane } from './Pane'

// 结构树（REQ-018）＋ r02 扩展：组合节点（REQ-051：可见 · 可选中 ⇒ 视口高亮 · **可展开到 part**）。
// 构件行：命名 / 选中 / 回退（r01）＋ 删除构件（D-D：文案写明 = 解除归属，块留下）。
// 组合行：命名 / 选中高亮 / 成员管理（＋构件 / ＋全部手工块 / 移除成员）/ 拆除（视图消失，归属不变）。
// r02 前半：改动模型的按钮 = 具名命令（commands.ts），检视态灰掉（REQ-054）。
export function PartTree(): JSX.Element {
  const parts = useEditorUi((s) => s.parts)
  const compositions = useEditorUi((s) => s.compositions)
  const selectedPartId = useEditorUi((s) => s.selectedPartId)
  const selectedCompositionId = useEditorUi((s) => s.selectedCompositionId)
  const manualBlockCount = useEditorUi((s) => s.manualBlockCount)
  const mode = useEditorUi((s) => s.mode)
  const disabled = mode !== 'edit'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [expandedComp, setExpandedComp] = useState<string | null>(null)

  const nameBox = (id: string, name: string, commit: (n: string) => void): JSX.Element =>
    editingId === id ? (
      <input
        value={draft}
        autoFocus
        style={{ flex: 1, minWidth: 0 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          commit(draft.trim() || name)
          setEditingId(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      ) : (
      <span
        className="row-name"
        /* REQ-054 缺口补齐（r05 · 规格 §3.3「结构树」行）：改名 = 改模型的编辑路径，
           检视态必须一并禁用——此前只有按钮受 `commandEnabled` 管，双击改名漏在门外。 */
        style={{ cursor: disabled ? 'default' : 'text' }}
        title={disabled ? `双击改名（${INSPECT_READONLY}）` : '双击改名（同名允许，id 唯一）'}
        onDoubleClick={() => {
          if (disabled) return
          setEditingId(id)
          setDraft(name)
        }}
      >
        {name}
      </span>
    )

  const btn = (
    c: ReturnType<typeof cmd.partSelect>,
    text: string,
    title: string,
    mini = false,
  ): JSX.Element => (
    <button className={mini ? 'mini-btn' : undefined} disabled={!commandEnabled(c)} title={title} aria-label={title} onClick={() => c.run()}>
      {text}
    </button>
  )

  // 折叠态摘要（§1.2 表「结构树」行）：`构件 n · 组合 n · 手工块 n`，有选中时追加 `· 选中「名」`。
  const selectedName =
    parts.find((p) => p.id === selectedPartId)?.name ??
    compositions.find((c) => c.id === selectedCompositionId)?.name
  const hint = `构件 ${parts.length} · 组合 ${compositions.length} · 手工块 ${manualBlockCount}${selectedName ? ` · 选中「${selectedName}」` : ''}`

  return (
    <Pane id="parts" summary={hint}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {btn(cmd.compositionNew, '＋组合', '新建组合（语义分组：成员构件 ∪ 手工块）')}
        {btn(cmd.partNew, '＋新构件', '新建空构件并选中（之后的放置归它）')}
      </div>

      {compositions.length > 0 && (
        <>
        <div className="rail-group" style={{ padding: '6px 0 2px' }}>
          组合
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {compositions.map((c) => {
            const partItems = parts.filter((p) => c.memberPartIds.includes(p.id))
            const restParts = parts.filter((p) => !c.memberPartIds.includes(p.id))
            return (
              <li key={c.id} style={{ padding: '2px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 4px',
                    borderRadius: 4,
                    background: c.id === selectedCompositionId ? '#31424e' : 'transparent',
                  }}
                >
                  <button
                    style={{ padding: '0 6px' }}
                    onClick={() => setExpandedComp(expandedComp === c.id ? null : c.id)}
                    title="展开到成员构件"
                  >
                    {expandedComp === c.id ? '▾' : '▸'}
                  </button>
                  {nameBox(c.id, c.name, (n) => getEditor().renameComposition(c.id, n))}
                  <span className="row-meta">{c.blockCount}块</span>
                  {btn(
                    cmd.compositionSelect(c.id),
                    c.id === selectedCompositionId ? '✖' : '🎯',
                    '选中 / 取消选中（视口高亮该组合的块集合）',
                    true,
                  )}
                </div>
                {expandedComp === c.id && (
                  <div style={{ padding: '4px 4px 4px 20px', fontSize: 12 }}>
                    <div style={{ color: 'var(--mute)', marginBottom: 4 }}>
                      成员构件 {c.memberPartIds.length} 个 · 手工块 {c.manualBlockCount} 块（解析现存 {c.blockCount} 块）
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {partItems.map((p) => (
                        <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ flex: 1 }}>构件：{p.name}</span>
                          <button
                            title="从组合移除该构件（构件与块不变）"
                            disabled={disabled}
                            onClick={() => getEditor().removePartFromComposition(c.id, p.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      {restParts.length > 0 ? (
                        <select
                          defaultValue=""
                          style={{ flex: 1 }}
                          disabled={disabled}
                          onChange={(e) => {
                            if (e.target.value) getEditor().addPartToComposition(c.id, e.target.value)
                            e.target.value = ''
                          }}
                        >
                          <option value="">＋加入构件…</option>
                          {restParts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ flex: 1, color: 'var(--mute)' }}>（没有可加入的构件）</span>
                      )}
                      <button
                        title={`把当前全部手工块（${manualBlockCount} 块）并入该组合`}
                        disabled={!commandEnabled(cmd.compositionAddManual(c.id))}
                        onClick={() => cmd.compositionAddManual(c.id).run()}
                      >
                        ＋手工块
                      </button>
                      <button
                        title="拆除组合：视图消失，方块与构件归属都不变"
                        disabled={!commandEnabled(cmd.compositionDissolve(c.id))}
                        onClick={() => cmd.compositionDissolve(c.id).run()}
                      >
                        拆除
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        </>
      )}

      <div className="rail-group" style={{ padding: '10px 0 2px' }}>
        构件
      </div>
      {parts.length === 0 && (
        <p className="note">
          （空——程序化操作会自动建构件；未选中构件时手工放置的方块为"手工块"）
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
        {parts.map((p) => (
          <li
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 4px',
              borderRadius: 4,
              background: p.id === selectedPartId ? '#24422c' : 'transparent',
            }}
          >
            {nameBox(p.id, p.name, (n) => getEditor().renamePart(p.id, n))}
            <span className="row-meta">{p.count}块</span>
            {btn(
              cmd.partSelect(p.id),
              p.id === selectedPartId ? '✖' : '🎯',
              '选中 / 取消选中（视口高亮；手工放置将归入选中构件）',
              true,
            )}
            {btn(cmd.partRollback(p.id), '⏪', '回退：模型回到该构件创建时', true)}
            {btn(cmd.partDissolve(p.id), '🗑', '删除构件 = 解除归属：方块保留（成为手工块）；不删任何方块', true)}
          </li>
        ))}
      </ul>
      {manualBlockCount > 0 && (
        <p className="note" style={{ marginTop: 8 }}>
          手工块 {manualBlockCount} 块（无构件归属；可并入组合或随构件选中放置）
        </p>
      )}
    </Pane>
  )
}