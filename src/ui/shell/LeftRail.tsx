import { ColorPanel } from '../ColorPanel'
import { INSPECT_READONLY, cmd, commandEnabled, pickPalette, setBrushAxis } from '../commands'
import { useEditorUi } from '../../state/editor-store'
import { UI_BOUNDARY_ATTR } from '../UiInputBoundary'

// 左栏：工具（放置 / 擦除 / 上色 / 吸管）· 笔刷尺寸 · 调色板 · 取色器。
// 检视态：所有编辑入口灰掉，但当前色与调色板仍可见（REQ-054）。
const TOOLS: Array<{ id: 'place' | 'erase' | 'paint' | 'pick'; glyph: string; label: string }> = [
  { id: 'place', glyph: '🧱', label: '放置' },
  { id: 'erase', glyph: '🧽', label: '擦除' },
  { id: 'paint', glyph: '🎨', label: '上色' },
  { id: 'pick', glyph: '💧', label: '吸管' },
]

export function LeftRail(): JSX.Element {
  const tool = useEditorUi((s) => s.tool)
  const mode = useEditorUi((s) => s.mode)
  const brushSize = useEditorUi((s) => s.brushSize)
  const overridePlace = useEditorUi((s) => s.overridePlace)
  const paletteItems = useEditorUi((s) => s.paletteItems)
  const currentIdentity = useEditorUi((s) => s.currentIdentity)
  const disabled = mode !== 'edit'

  const axisInput = (axis: 'x' | 'y' | 'z', label: string): JSX.Element => (
    <label>
      {label}
      <input
        type="number"
        min={1}
        max={8}
        step={1}
        value={brushSize[axis]}
        disabled={disabled}
        onChange={(e) => setBrushAxis(axis, Number(e.target.value))}
      />
    </label>
  )

  return (
    <aside className="left-rail" {...{ [UI_BOUNDARY_ATTR]: 'left-rail' }}>
      <div className="group-title">工具</div>
      <div className="tool-grid">
        {TOOLS.map((t) => {
          const c = cmd.tool(t.id)
          const on = tool === t.id
          return (
            <button
              key={t.id}
              className={on ? 'tool-btn on' : 'tool-btn'}
              title={disabled ? `${t.label}（${INSPECT_READONLY}）` : t.label}
              aria-pressed={on}
              disabled={!commandEnabled(c)}
              onClick={() => c.run()}
            >
              <span className="glyph" aria-hidden>
                {t.glyph}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>
      {disabled && <p className="warn">{INSPECT_READONLY}</p>}

      <div className="group-title">笔刷 W · H · L</div>
      <div className="brush-row">
        {axisInput('x', 'W')}
        {axisInput('y', 'H')}
        {axisInput('z', 'L')}
      </div>
      <label className="row" style={{ marginTop: 8, fontSize: 11.5, color: 'var(--fg-dim)' }}>
        <input type="checkbox" checked={overridePlace} disabled={disabled || tool !== 'place'} onChange={() => cmd.overridePlace.run()} />
        替换添加（覆盖已有块）
      </label>

      <div className="group-title">调色板</div>
      <div className="swatch-grid">
        {paletteItems.map((item) => (
          <button
            key={item.identity}
            className={item.identity === currentIdentity ? 'swatch on' : 'swatch'}
            title={item.identity.replace('color:', '')}
            aria-label={item.identity.replace('color:', '')}
            disabled={disabled}
            style={{ background: item.color }}
            onClick={() => pickPalette(item.identity)}
          />
        ))}
      </div>
      {disabled && <p className="note">检视态：色板可看不可改。</p>}

      <div className="group-title">取色器</div>
      <ColorPanel />

      <div className="note" style={{ marginTop: 14 }}>
        左键 = 笔刷（拖动涂抹，松开成一笔）· 右键拖动 = 旋转 · 滚轮 = 缩放 · 中键 = 快缩
      </div>
    </aside>
  )
}