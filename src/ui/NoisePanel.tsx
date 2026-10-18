import { useState } from 'react'
import { runNoiseSculpt, INSPECT_READONLY } from './commands'
import type { NoiseFormState } from './commands'
import { useEditorUi } from '../state/editor-store'
import { Pane } from './Pane'

// F8 噪声模块（REQ-057 · Q3 拍板）：编辑态的**一个动作按钮**（不是新建流程的一步）。
// 参数 = 幅度 / 密度 / 种子 / 六个方位可勾选（+ 范围与方块）；一次性生成、无动画（心跳动画记账）。
// 参数面四原则：平铺标量（flat-first）· 每调用上限（幅度 1–4）· seed 全显式 · 教学式报错（src/ops/noise-sculpt.ts）。
const DEFAULT_DIRS: NoiseFormState['dirs'] = { px: true, nx: true, py: true, ny: true, pz: true, nz: true }

export function NoisePanel(): JSX.Element {
  const parts = useEditorUi((s) => s.parts)
  const compositions = useEditorUi((s) => s.compositions)
  const mode = useEditorUi((s) => s.mode)
  const paletteItems = useEditorUi((s) => s.paletteItems)
  const currentIdentity = useEditorUi((s) => s.currentIdentity)
  const disabled = mode !== 'edit'
  const [form, setForm] = useState<NoiseFormState>(() => ({
    scopeKind: 'all',
    scopeId: '',
    amplitude: 1,
    density: 0.5,
    seed: 42,
    dirs: { ...DEFAULT_DIRS },
    identity: currentIdentity,
  }))
  const set = (patch: Partial<NoiseFormState>): void => setForm({ ...form, ...patch })
  const scopeValue = form.scopeKind === 'part' || form.scopeKind === 'composition' ? `${form.scopeKind}:${form.scopeId}` : form.scopeKind
  // 折叠态摘要（§1.2 表「噪声」行）= `表面生长 / 侵蚀 · 范围 {全体|构件名|组合名}`；检视态追加 `· 检视态只读`。
  // 范围名从 `parts` / `compositions` 现取（不在表单态里另存名字，避免与模型重命名脱钩）。
  const scopeName =
    form.scopeKind === 'part'
      ? (parts.find((p) => p.id === form.scopeId)?.name ?? '构件')
      : form.scopeKind === 'composition'
        ? (compositions.find((c) => c.id === form.scopeId)?.name ?? '组合')
        : '全体'
  const hint = `表面生长 / 侵蚀 · 范围 ${scopeName}${disabled ? ' · 检视态只读' : ''}`
  const dirCheck = (key: keyof NoiseFormState['dirs'], label: string): JSX.Element => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, marginRight: 6 }}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={form.dirs[key]}
        onChange={() => set({ dirs: { ...form.dirs, [key]: !form.dirs[key] } })}
      />
      {label}
    </label>
  )
  return (
    <Pane id="noise" summary={hint}>
      {disabled && <p className="warn">{INSPECT_READONLY}</p>}
      <label style={{ display: 'block', margin: '6px 0', fontSize: 12 }}>
        范围（默认 = 坯料 / 全体）：
        <select
          value={scopeValue}
          disabled={disabled}
          style={{ width: '100%' }}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'all' || v === 'manual') set({ scopeKind: v, scopeId: '' })
            else if (v.startsWith('part:')) set({ scopeKind: 'part', scopeId: v.slice(5) })
            else set({ scopeKind: 'composition', scopeId: v.slice(5) })
          }}
        >
          <option value="all">全体</option>
          <option value="manual">手工块（无归属）</option>
          {parts.map((p) => (
            <option key={p.id} value={`part:${p.id}`}>
              构件：{p.name}
            </option>
          ))}
          {compositions.map((c) => (
            <option key={c.id} value={`composition:${c.id}`}>
              组合：{c.name}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 4 }}>
        <label style={{ flex: 1, fontSize: 12 }}>
          幅度(1–4)
          <input
            type="number"
            min={1}
            max={4}
            step={1}
            value={form.amplitude}
            disabled={disabled}
            style={{ width: '100%' }}
            onChange={(e) => set({ amplitude: Number(e.target.value) })}
          />
        </label>
        <label style={{ flex: 1, fontSize: 12 }}>
          密度(0–1)
          <input
            type="number"
            min={0.01}
            max={1}
            step={0.05}
            value={form.density}
            disabled={disabled}
            style={{ width: '100%' }}
            onChange={(e) => set({ density: Number(e.target.value) })}
          />
        </label>
        <label style={{ flex: 1, fontSize: 12 }}>
          种子
          <input
            type="number"
            min={0}
            step={1}
            value={form.seed}
            disabled={disabled}
            style={{ width: '100%' }}
            onChange={(e) => set({ seed: Number(e.target.value) })}
          />
        </label>
      </div>
      <div style={{ margin: '6px 0' }}>
        {dirCheck('px', '+x')}
        {dirCheck('nx', '−x')}
        {dirCheck('py', '+y')}
        {dirCheck('ny', '−y')}
        {dirCheck('pz', '+z')}
        {dirCheck('nz', '−z')}
      </div>
      <label style={{ display: 'block', margin: '6px 0', fontSize: 12 }}>
        生长方块：
        <select
          value={form.identity}
          disabled={disabled}
          style={{ width: '100%' }}
          onChange={(e) => set({ identity: e.target.value })}
        >
          {paletteItems.map((item) => (
            <option key={item.identity} value={item.identity}>
              {item.identity.replace('color:', '')}
            </option>
          ))}
        </select>
      </label>
      <button
        style={{ width: '100%' }}
        disabled={disabled}
        onClick={() => runNoiseSculpt(form)}
      >
        🌫️ 生成噪声形态（一次 = 一条补丁）
      </button>
      <p className="note">
        在范围表面按种子抽签生长 / 侵蚀；同参数（含种子）同结果；心跳动画属以后层。
      </p>
    </Pane>
  )
}