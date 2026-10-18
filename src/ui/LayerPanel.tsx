import { useState } from 'react'
import { getEditor } from '../app/runtime'
import { COORD_LIMIT } from '../core/coords'
import { cmd, commandEnabled, setLayerY } from './commands'
import { effectiveGridY, useEditorUi } from '../state/editor-store'
import { Pane } from './Pane'

// F3/F4（P2 扩展）：层次块（`D1` 起 = 右下悬浮方块，展开向上）——显示全部/以下/单层三档 + 垂直 y 滑块
// + 每层块数 + **参考网格 / 工作网格各自独立 y**（含「参数跟随」）。
// 主层序 = 从**最低占用层**起算（含空层），辅助显示实际 y（`REQ-052`）；网格高度独立于过滤层（`REQ-048`）。
// 全部走界面按钮 / 滑块与数字输入（V12：无键盘快捷键）；数值只依赖模型与层计数纯函数（V3）。
// `D4`（2026-10-16）：三档 = **互斥单选**，当前档用 accent 绿底填充强调，非当前档弱化；默认档 = 显示全部。
// `D3`（2026-10-16）：参考网格自持整数 y（默认 0、±4096），两个网格各有一个「参数跟随」（默认关）。
const MODES: ReadonlyArray<{ id: 'all' | 'below' | 'single'; label: string }> = [
  { id: 'all', label: '显示全部' },
  { id: 'below', label: '渲染以下' },
  { id: 'single', label: '渲染单层' },
]

export function LayerPanel(): JSX.Element {
  /** 工作网格 y 输入草稿（null = 跟随会话态；非 null = 用户正在输入，含中间态 "-" 等） */
  const [gridYDraft, setGridYDraft] = useState<string | null>(null)
  /** `D3`：参考网格 y 输入草稿（同上语义） */
  const [refYDraft, setRefYDraft] = useState<string | null>(null)
  const mode = useEditorUi((s) => s.layerMode)
  const layerY = useEditorUi((s) => s.layerY)
  const minY = useEditorUi((s) => s.layerMinY)
  const maxY = useEditorUi((s) => s.layerMaxY)
  const counts = useEditorUi((s) => s.perLayerCounts)
  const gridBase = useEditorUi((s) => s.gridBase)
  const gridLayer = useEditorUi((s) => s.gridLayer)
  const workGridY = useEditorUi((s) => s.workGridY)
  const refGridY = useEditorUi((s) => s.refGridY)
  const followLayerWork = useEditorUi((s) => s.followLayerWork)
  const followLayerRef = useEditorUi((s) => s.followLayerRef)
  const visible = useEditorUi((s) => s.nonEmpty)

  const span = Math.max(maxY - minY, 0)
  const countAt = (y: number): number => counts.find((c) => c.y === y)?.count ?? 0
  const visibleNow = mode === 'all' ? visible : mode === 'below' ? counts.filter((c) => c.y <= layerY).reduce((a, c) => a + c.count, 0) : countAt(layerY)
  // `D4` ②：收起态摘要必须含「显示全部 / 以下 / 单层」字样，且跟随时显示**实际 y**（`D3`）。
  const eff = effectiveGridY({ workGridY, refGridY, followLayerWork, followLayerRef, layerY })
  const summary =
    visible === 0
      ? '无模型层'
      : mode === 'all'
        ? `显示全部 · ${visible} 块`
        : mode === 'below'
          ? `以下 y ≤ ${layerY} · 可见 ${visibleNow}/${visible}`
          : `单层 y=${layerY} · ${visibleNow} 块`
  // 层列表区高度：随层数长，但到顶就内滚（块内容不占满视口）
  const listH = Math.min(300, Math.max(104, (span + 1) * 19 + 6))

  /** `D4` ①：当前档 = accent 绿底填充 + 深色文字；非当前档 = 普通灰底按钮（不引第三种颜色） */
  const modeButton = (m: (typeof MODES)[number]): JSX.Element => {
    const on = mode === m.id
    const c = cmd.layerMode(m.id)
    return (
      <button
        key={m.id}
        role="radio"
        aria-checked={on}
        disabled={!commandEnabled(c)}
        title={`${m.label}${on ? '（当前）' : ''}`}
        onClick={() => c.run()}
        style={{
          flex: 1,
          fontSize: 12,
          ...(on ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#0f1218', fontWeight: 700 } : {}),
        }}
      >
        {m.label}
      </button>
    )
  }

  return (
    <Pane id="layers" summary={summary}>
      <div role="radiogroup" aria-label="层次显示档位" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
        {modeButton(MODES[0]!)}
        <div style={{ display: 'flex', gap: 2 }}>{MODES.slice(1).map((m) => modeButton(m))}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, minHeight: 0, height: listH, flex: 'none' }}>
        {/* 垂直滑块：值大 = 层高（滑块向上）。writing-mode 竖向 + direction rtl ⇒ 手柄向上增大 */}
        <input
          type="range"
          min={minY}
          max={maxY}
          step={1}
          value={layerY}
          {...({ orient: 'vertical' } as Record<string, string>)}
          onChange={(e) => setLayerY(Number(e.target.value))}
          style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 22, flex: 'none', height: '100%' }}
        />
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'ui-monospace, Consolas, monospace' }}>
          {Array.from({ length: visible === 0 ? 0 : span + 1 }, (_, i) => maxY - i).map((y) => (
            <div
              key={y}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '1px 4px',
                borderRadius: 3,
                background:
                  mode === 'all' ? 'transparent' : mode === 'below' ? (y <= layerY ? 'var(--accent-soft)' : 'transparent') : y === layerY ? 'var(--accent-soft)' : 'transparent',
                fontWeight: y === layerY ? 700 : 400,
              }}
            >
              <span>第 {y - minY + 1} 层 <small>y={y}</small></span>
              <span>{countAt(y)} 块</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <strong>网格（默认关）</strong>
        {/* `D3`：参考网格 = 只读参考平面（可设高度，但不提供放置 / 不参与命中） */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={gridBase} onChange={() => cmd.gridBase.run()} />
          参考网格（只读参考平面）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 'none' }}>参考 y</span>
          <input
            aria-label="参考网格 y"
            type="number"
            min={-COORD_LIMIT}
            max={COORD_LIMIT}
            step={1}
            disabled={followLayerRef}
            value={refYDraft ?? String(eff.ref)}
            onChange={(e) => {
              // `REQ-065`/`D3`：非法（空 / 小数 / 越界）不写入；草稿保留输入过程，用户才能敲出负号与多位数字。
              setRefYDraft(e.target.value)
              const v = e.target.valueAsNumber
              if (Number.isInteger(v)) getEditor().setRefGridY(v)
            }}
            onBlur={() => setRefYDraft(null)}
            style={{ width: 76 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={followLayerRef} onChange={() => cmd.gridFollow('ref').run()} />
          参考网格参数跟随（y = 当前层）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={gridLayer} onChange={() => cmd.gridLayer.run()} />
          工作网格（放置平面）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 'none' }}>工作 y</span>
          <input
            aria-label="工作网格 y"
            type="number"
            min={-COORD_LIMIT}
            max={COORD_LIMIT}
            step={1}
            disabled={followLayerWork}
            value={gridYDraft ?? String(eff.work)}
            onChange={(e) => {
              setGridYDraft(e.target.value)
              const v = e.target.valueAsNumber
              if (Number.isInteger(v)) getEditor().setWorkGridY(v)
            }}
            onBlur={() => setGridYDraft(null)}
            style={{ width: 76 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={followLayerWork} onChange={() => cmd.gridFollow('work').run()} />
          工作网格参数跟随（y = 当前层）
        </label>
        <p className="note" style={{ margin: '2px 0 0' }}>
          跟随时高度实时取层次滑块当前层实际 y，手动输入禁用；取消跟随恢复跟随前的独立 y。工作网格 = 放置平面；参考网格只读，不提供放置。
        </p>
      </div>
    </Pane>
  )
}