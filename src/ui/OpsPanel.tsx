import { useEffect, useState } from 'react'
import type { Coord, OpName, ProgramOp, ScopeRef } from '../core/types'
import { OP_SPECS } from '../core/op-spec'
import { getEditor } from '../app/runtime'
import { useEditorUi } from '../state/editor-store'
import { INSPECT_READONLY } from './commands'
import { Pane } from './Pane'

// r02 手动调用面（REQ-014 ① / plan §2）：选操作 → 填参数 → 选范围 → 应用。
// 表单由 core/op-spec.ts 的规格表驱动（参数面唯一出处）；应用走 getEditor().runOp ⇒ runProgramOp + PatchLog.applyPlanned（一条补丁），
// 不在 UI 侧攒补丁。空范围 / 参数不合法 ⇒ footer 消息反馈，不记账。

type FormState = Record<string, unknown>

function defaultForm(name: OpName, firstKey: number): FormState {
  const spec = OP_SPECS.find((s) => s.name === name)
  const form: FormState = {}
  for (const p of spec?.params ?? []) {
    switch (p.type) {
      case 'int':
      case 'float':
        form[p.field] =
          p.field === 'density' ? 0.5 : p.field === 'seed' ? 42 : 1
        break
      case 'coord3':
        form[p.field] = { x: 0, y: 0, z: 0 }
        break
      case 'scope':
        form[p.field] = { kind: 'all' }
        break
      case 'shape':
        form[p.field] = 'box'
        break
      case 'axis':
        form[p.field] = 'x'
        break
      case 'blockKey':
        form[p.field] = firstKey
        break
      case 'blockKeys':
        form[p.field] = [firstKey]
        break
      case 'boolean':
        form[p.field] = false
        break
      case 'dirs':
        form[p.field] = { px: true, nx: true, py: true, ny: true, pz: true, nz: true }
        break
    }
  }
  return form
}

function scopeOptions(
  parts: Array<{ id: string; name: string }>,
  compositions: Array<{ id: string; name: string }>,
): Array<{ value: string; label: string }> {
  return [
    { value: 'all', label: '全体' },
    { value: 'manual', label: '手工块（无归属）' },
    ...parts.map((p) => ({ value: `part:${p.id}`, label: `构件：${p.name}` })),
    ...compositions.map((c) => ({ value: `comp:${c.id}`, label: `组合：${c.name}` })),
  ]
}

function parseScope(value: string): ScopeRef {
  if (value === 'all') return { kind: 'all' }
  if (value === 'manual') return { kind: 'manual' }
  if (value.startsWith('part:')) return { kind: 'part', partId: value.slice(5) }
  return { kind: 'composition', compositionId: value.slice(5) }
}

export function OpsPanel(): JSX.Element {
  const parts = useEditorUi((s) => s.parts)
  const compositions = useEditorUi((s) => s.compositions)
  const paletteItems = useEditorUi((s) => s.paletteItems)
  const mode = useEditorUi((s) => s.mode)
  const firstKey = paletteItems[0]?.key ?? 1
  const [name, setName] = useState<OpName>('presetShape')
  const [form, setForm] = useState<FormState>(() => defaultForm('presetShape', firstKey))
  const [expandedKeys, setExpandedKeys] = useState(false)
  const spec = OP_SPECS.find((s) => s.name === name)!
  const disabled = mode !== 'edit'

  const pick = (n: OpName): void => {
    setName(n)
    setForm(defaultForm(n, firstKey))
    setExpandedKeys(false)
  }
  const set = (field: string, value: unknown): void => setForm({ ...form, [field]: value })

  // r03 · T7 手动调用面联动：选中构件 / 组合 ⇒ 范围下拉跟随（REQ-051 的手动面；
  // 用户仍可手动改范围，下一次选中再跟随——跟随是"输入辅助"不是"锁定"）
  const selectedPartId = useEditorUi((s) => s.selectedPartId)
  const selectedCompositionId = useEditorUi((s) => s.selectedCompositionId)
  useEffect(() => {
    if (selectedPartId === null && selectedCompositionId === null) return
    setForm((f) => {
      const scope = f.scope as ScopeRef | undefined
      if (!scope) return f
      if (selectedPartId) return { ...f, scope: { kind: 'part', partId: selectedPartId } }
      return { ...f, scope: { kind: 'composition', compositionId: selectedCompositionId } }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartId, selectedCompositionId])

  const numInput = (field: string, min?: number, max?: number, step = 1): JSX.Element => (
    <input
      type="number"
      value={Number(form[field] ?? 0)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      style={{ width: '100%' }}
      onChange={(e) => set(field, Number(e.target.value))}
    />
  )

  const apply = (): void => {
    const params = { ...form } as Record<string, unknown>
    getEditor().runOp({ type: 'program', name, params } as unknown as ProgramOp)
  }

  const dirsInput = (field: string): JSX.Element => {
    const d = (form[field] ?? {}) as Record<string, boolean>
    const items: Array<[string, string]> = [
      ['px', '+x'],
      ['nx', '−x'],
      ['py', '+y'],
      ['ny', '−y'],
      ['pz', '+z'],
      ['nz', '−z'],
    ]
    return (
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {items.map(([k, label]) => (
          <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12 }}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={d[k] === true}
              onChange={() => set(field, { ...d, [k]: !d[k] })}
            />
            {label}
          </label>
        ))}
      </span>
    )
  }

  // 折叠态摘要（§1.2 表「程序化操作」行）= `9 个预设操作`；检视态追加 `· 检视态只读`（灰）。
  // 条数取 `OP_SPECS.length`（= 9，参数面唯一出处 `core/op-spec.ts`）而非手写常量——
  // 与 `r04` `R1`（"基线数字要带测法"）同精神：口径与来源同点，表变了摘要跟着变。
  return (
    <Pane id="ops" summary={`${OP_SPECS.length} 个预设操作${disabled ? ' · 检视态只读' : ''}`}>
      {disabled && <p className="warn">{INSPECT_READONLY}</p>}
      <select value={name} disabled={disabled} style={{ width: '100%' }} onChange={(e) => pick(e.target.value as OpName)}>
        {OP_SPECS.map((s) => (
          <option key={s.name} value={s.name}>
            {s.label}（{s.kind === 'absolute' ? '绝对' : '相对'}）
          </option>
        ))}
      </select>
      <p className="note" style={{ margin: '6px 0' }}>
        {spec.semantics}
      </p>
      {spec.params.map((p) => (
        <label key={p.field} style={{ display: 'block', margin: '6px 0', fontSize: 12 }}>
          {p.label}
          {p.optional ? '（可选）' : ''}：
          {p.type === 'int' || p.type === 'float' ? (
            numInput(p.field, p.min, p.max, p.type === 'float' ? (p.step ?? 0.1) : 1)
          ) : p.type === 'dirs' ? (
            dirsInput(p.field)
          ) : p.type === 'boolean' ? (
            <input
              type="checkbox"
              disabled={disabled}
              checked={form[p.field] === true}
              onChange={(e) => set(p.field, e.target.checked)}
            />
          ) : p.type === 'shape' ? (
            <select
              value={String(form[p.field] ?? 'box')}
              disabled={disabled}
              style={{ width: '100%' }}
              onChange={(e) => set(p.field, e.target.value)}
            >
              <option value="box">盒</option>
              <option value="cylinder">柱</option>
              <option value="cone">锥</option>
              <option value="sphere">球</option>
            </select>
          ) : p.type === 'axis' ? (
            <select
              value={String(form[p.field] ?? 'x')}
              disabled={disabled}
              style={{ width: '100%' }}
              onChange={(e) => set(p.field, e.target.value)}
            >
              <option value="x">x 轴</option>
              <option value="z">z 轴</option>
            </select>
          ) : p.type === 'scope' ? (
            <select
              value={scopeValue(form[p.field])}
              disabled={disabled}
              style={{ width: '100%' }}
              onChange={(e) => set(p.field, parseScope(e.target.value))}
            >
              {scopeOptions(parts, compositions).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : p.type === 'blockKey' ? (
            <select
              value={Number(form[p.field] ?? firstKey)}
              disabled={disabled}
              style={{ width: '100%' }}
              onChange={(e) => set(p.field, Number(e.target.value))}
            >
              {paletteItems.map((item) => (
                <option key={item.identity} value={item.key}>
                  {item.identity.replace('color:', '')}
                </option>
              ))}
            </select>
          ) : p.type === 'blockKeys' ? (
            <button style={{ width: '100%' }} onClick={() => setExpandedKeys(!expandedKeys)}>
              {expandedKeys ? '收起方块列表' : `已选 ${(form[p.field] as number[] | undefined)?.length ?? 0} 种方块（点选）`}
            </button>
          ) : p.type === 'coord3' ? (
            <CoordInput
              value={form[p.field] as Coord}
              onChange={(c) => set(p.field, c)}
            />
          ) : null}
          {p.type === 'blockKeys' && expandedKeys ? (
            <KeyPicker
              selected={(form[p.field] as number[] | undefined) ?? []}
              onToggle={(key) => {
                const cur = ((form[p.field] as number[] | undefined) ?? []).slice()
                const i = cur.indexOf(key)
                if (i >= 0) cur.splice(i, 1)
                else cur.push(key)
                set(p.field, cur.length === 0 ? [firstKey] : cur)
              }}
            />
          ) : null}
        </label>
      ))}
      <button style={{ width: '100%', marginTop: 8 }} disabled={disabled} onClick={apply}>
        ⚙️ 应用（一次 = 一条补丁，可一次撤销）
      </button>
    </Pane>
  )
}

function scopeValue(scope: unknown): string {
  if (typeof scope !== 'object' || scope === null) return 'all'
  const s = scope as { kind?: string; partId?: string; compositionId?: string }
  if (s.kind === 'part' && s.partId) return `part:${s.partId}`
  if (s.kind === 'composition' && s.compositionId) return `comp:${s.compositionId}`
  if (s.kind === 'manual') return 'manual'
  return 'all'
}

function CoordInput(props: { value: Coord; onChange: (c: Coord) => void }): JSX.Element {
  const axis = (key: 'x' | 'y' | 'z'): JSX.Element => (
    <input
      type="number"
      value={props.value?.[key] ?? 0}
      style={{ width: '33%' }}
      onChange={(e) => props.onChange({ ...props.value, [key]: Number(e.target.value) })}
    />
  )
  return (
    <span style={{ display: 'flex', gap: 2 }}>
      {axis('x')}
      {axis('y')}
      {axis('z')}
    </span>
  )
}

function KeyPicker(props: { selected: number[]; onToggle: (key: number) => void }): JSX.Element {
  const paletteItems = useEditorUi((s) => s.paletteItems)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 4 }}>
      {paletteItems.map((item) => (
        <button
          key={item.identity}
          title={item.identity}
          onClick={() => props.onToggle(item.key)}
          style={{
            aspectRatio: '1',
            borderRadius: 4,
            background: item.color,
            outline: props.selected.includes(item.key) ? '3px solid #ffffff' : '1px solid #00000055',
          }}
        />
      ))}
    </div>
  )
}