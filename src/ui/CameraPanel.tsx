import { cmd, setCameraField } from './commands'
import { useEditorUi } from '../state/editor-store'
import { Pane } from './Pane'

// F9 相机参数面板（REQ-058 · Q5 拍板）：距离 · FOV · 目标点 xyz（只读）· 旋转速度 / 阻尼 · 复位视角。
// 全部会话态——不进项目文件、不进补丁日志；面板值与渲染层实际参数同源（onCameraChange 读回）。
export function CameraPanel(): JSX.Element {
  const cam = useEditorUi((s) => s.cameraPanel)
  const num = (
    field: 'fov' | 'distance' | 'rotateSpeed' | 'damping',
    label: string,
    min: number,
    max: number,
    step: number,
  ): JSX.Element => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0', fontSize: 12 }}>
      <span style={{ width: 56, flex: 'none' }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(cam[field].toFixed(2))}
        style={{ flex: 1 }}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) setCameraField(field, v)
        }}
      />
    </label>
  )
  return (
    <Pane id="camera" summary={`距离 ${cam.distance.toFixed(0)} · FOV ${cam.fov.toFixed(0)}`}>
      {num('distance', '距离', 2, 1500, 0.5)}
      {num('fov', 'FOV', 20, 110, 1)}
      {num('rotateSpeed', '旋转速度', 0.1, 3, 0.1)}
      {num('damping', '阻尼', 0, 0.5, 0.01)}
      <div style={{ fontSize: 12, color: 'var(--fg-mute)', fontFamily: 'ui-monospace, Consolas, monospace', margin: '6px 0' }}>
        目标点 (只读)：({cam.target.map((v) => v.toFixed(1)).join(', ')}) = 非空块 AABB 中心
      </div>
      <button style={{ width: '100%' }} onClick={() => cmd.cameraReset.run()}>
        🎯 复位视角（对准模型中心）
      </button>
      <p className="note">相机参数为会话态：不写入项目文件、不进补丁日志；撤销不回退视图。</p>
    </Pane>
  )
}