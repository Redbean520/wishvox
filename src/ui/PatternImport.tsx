import { useEffect, useRef } from 'react'
import { recognizePatternWithVision } from '../ai/pattern-vision'
import { recognizePattern } from '../io/pattern'
import { loadPatternImage } from '../io/pattern'
import type { GridGeometry, PatternColorStat, PatternGrid, RgbaImage } from '../io/pattern/types'
import { useAiUi } from '../state/ai-store'
import { patchPattern, setPatternOptions, usePatternStore } from '../state/pattern-store'
import type { PatternOptions } from '../state/pattern-store'
import { patternHint } from '../state/pattern-store'
import { useEditorUi } from '../state/editor-store'
import { cmd, commandEnabled, INSPECT_READONLY } from './commands'
import { drawPatternPreview } from './pattern-preview'
import { Section } from './Section'

// 拼豆图纸 → 方块（r06 · 新功能）：**双通道识别 + 人核对 + 一次补丁**。
//   通道一（本地，默认）：`io/pattern/recognize.ts`——规则方格图纸逐格取色，离线、确定、可测；
//   通道二（AI）：`ai/pattern-vision.ts`——符号/色号图纸、拍照倾斜、格线缺失时交给视觉模型读成颜色网格。
// 两条通道产出的都是**给人看的预览**；人点「生成方块」才走 `edit/pattern-apply.ts` 写入
// （一次 = 一条补丁、一次撤销）——AI 没有获得人类没有的写路径，这是全项目的同一条纪律。
//
// 面板形态：嵌在「AI 编辑」工作台里的可折叠 Section（不新开悬浮块：悬浮块的九宫拓扑是
// design §7.2 的固定实例，加块会推翻布局不变量；图纸导入是 AI 工作台的一个动作，不是常驻工具）。

/** 从网格算色板统计（AI 通道没有本地采样步骤，用它补齐预览需要的统计） */
function paletteOf(grid: PatternGrid): { palette: PatternColorStat[]; emptyCells: number } {
  const counts = new Map<string, number>()
  let emptyCells = 0
  for (const cell of grid.cells) {
    if (cell === null) emptyCells++
    else counts.set(cell, (counts.get(cell) ?? 0) + 1)
  }
  return {
    palette: [...counts.entries()]
      .map(([hex, count]) => ({ hex, count }))
      .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)),
    emptyCells,
  }
}

/** 本地识别（参数变了就重跑：纯函数、毫秒级） */
function recognizeLocal(rgba: RgbaImage, options: PatternOptions): void {
  const manual =
    options.manualCols !== null && options.manualRows !== null
      ? { cols: options.manualCols, rows: options.manualRows }
      : undefined
  const result = recognizePattern(rgba, {
    mergeTolerance: options.mergeTolerance,
    backgroundToEmpty: options.backgroundToEmpty,
    trimBlankEdges: options.trimBlankEdges,
    crop: { left: options.cropLeft, top: options.cropTop, right: options.cropRight, bottom: options.cropBottom },
    mirrorX: options.mirrorX,
    ...(manual !== undefined ? { manual } : {}),
  })
  if (!result.ok) {
    patchPattern({ status: 'error', message: `本地识别失败：${result.reason}` })
    return
  }
  const confidence = Math.round(result.geometry.confidence * 100)
  patchPattern({
    status: 'ready',
    grid: result.grid,
    geometry: result.geometry,
    palette: result.palette,
    warnings: result.warnings,
    emptyCells: result.emptyCells,
    recognizedBy: 'local',
    message: result.geometry.source === 'auto' ? `本地识别：${result.grid.cols}×${result.grid.rows}（把握 ${confidence}%）` : `按手动行列识别：${result.grid.cols}×${result.grid.rows}`,
  })
}

export function PatternImport(): JSX.Element {
  const status = usePatternStore((s) => s.status)
  const message = usePatternStore((s) => s.message)
  const grid = usePatternStore((s) => s.grid)
  const geometry = usePatternStore((s) => s.geometry)
  const palette = usePatternStore((s) => s.palette)
  const warnings = usePatternStore((s) => s.warnings)
  const emptyCells = usePatternStore((s) => s.emptyCells)
  const options = usePatternStore((s) => s.options)
  const imageName = usePatternStore((s) => s.imageName)
  const imageWidth = usePatternStore((s) => s.imageWidth)
  const imageHeight = usePatternStore((s) => s.imageHeight)
  const previewDataUrl = usePatternStore((s) => s.previewDataUrl)
  const recognizedBy = usePatternStore((s) => s.recognizedBy)
  const mode = useEditorUi((s) => s.mode)
  const disabled = mode !== 'edit'
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current !== null) drawPatternPreview(canvasRef.current, grid)
  }, [grid])

  const acceptFile = (file: File | null): void => {
    if (file === null) return
    const current = usePatternStore.getState().options
    patchPattern({ status: 'loading', message: `解码「${file.name}」…` })
    void loadPatternImage(file)
      .then((loaded) => {
        patchPattern({
          imageName: file.name,
          imageWidth: loaded.rgba.width,
          imageHeight: loaded.rgba.height,
          previewDataUrl: loaded.previewDataUrl,
          visionDataUrl: loaded.visionDataUrl,
          rgba: loaded.rgba,
        })
        recognizeLocal(loaded.rgba, current)
      })
      .catch((e: unknown) => {
        patchPattern({ status: 'error', message: `图片解码失败：${(e as Error).message}` })
      })
  }

  /** 改识别参数 ⇒ 用同一张图重跑本地识别（AI 通道按需手动再点） */
  const updateOptions = (patch: Partial<PatternOptions>, rerun = true): void => {
    setPatternOptions(patch)
    const s = usePatternStore.getState()
    if (rerun && s.rgba !== null) recognizeLocal(s.rgba, s.options)
  }

  const aiRecognize = (): void => {
    const s = usePatternStore.getState()
    const settings = useAiUi.getState().settings
    if (s.visionDataUrl === null) {
      patchPattern({ status: 'error', message: '先选择一张图纸图片，再点 AI 识别' })
      return
    }
    if (settings === null) {
      patchPattern({ status: 'error', message: 'AI 设置还没初始化（先打开一次「AI 连接」）' })
      return
    }
    if (settings.visionModel.trim() === '') {
      patchPattern({ status: 'error', message: '先在「AI 连接」里填「视觉模型」：支持图片输入的模型名（如 gpt-4o / qwen-vl-max），与 AI 共用 baseURL 与 key' })
      return
    }
    patchPattern({ status: 'recognizing', message: `AI 识别中（${settings.visionModel}）…图片可能有几十 KB，等几秒` })
    void recognizePatternWithVision({
      dataUrl: s.visionDataUrl,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.visionModel,
      language: settings.language,
    }).then((result) => {
      if (!result.ok) {
        patchPattern({ status: 'error', message: result.message })
        return
      }
      const stats = paletteOf(result.grid)
      const geometryForImage: GridGeometry = {
        cols: result.grid.cols,
        rows: result.grid.rows,
        left: 0,
        top: 0,
        cellW: s.imageWidth / result.grid.cols,
        cellH: s.imageHeight / result.grid.rows,
        confidence: 1,
        source: 'manual',
      }
      patchPattern({
        status: 'ready',
        grid: result.grid,
        geometry: geometryForImage,
        palette: stats.palette,
        warnings: result.note !== null ? [`模型备注：${result.note}`] : [],
        emptyCells: stats.emptyCells,
        recognizedBy: 'ai',
        message: `AI 识别：${result.grid.cols}×${result.grid.rows}——先看预览，再点「生成方块」`,
      })
    })
  }

  const cropField = (label: string, key: 'cropLeft' | 'cropTop' | 'cropRight' | 'cropBottom'): JSX.Element => (
    <label className="field" style={{ flex: 1 }}>
      {label}
      <input
        type="number"
        min={0}
        max={64}
        value={options[key]}
        onChange={(e) => updateOptions({ [key]: Math.max(0, Math.min(64, Math.round(Number(e.target.value)) || 0)) } as never)}
      />
    </label>
  )

  const numField = (label: string, value: number | null, onChange: (v: number | null) => void, placeholder: string): JSX.Element => (
    <label className="field" style={{ flex: 1 }}>
      {label}
      <input
        type="number"
        min={1}
        max={128}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.max(1, Math.min(128, Math.round(Number(e.target.value)))) )}
      />
    </label>
  )

  const originAxis = (axis: 'x' | 'y' | 'z'): JSX.Element => (
    <input
      key={axis}
      type="number"
      aria-label={`起点 ${axis}`}
      value={options.origin[axis]}
      style={{ width: '33%' }}
      onChange={(e) => updateOptions({ origin: { ...options.origin, [axis]: Math.round(Number(e.target.value)) || 0 } }, false)}
    />
  )

  return (
    <Section title="图纸 → 方块" emoji="🖼" defaultOpen={false} hint={patternHint(usePatternStore.getState())}>
      {disabled && <p className="warn">{INSPECT_READONLY}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        style={{ display: 'none' }}
        onChange={(e) => {
          acceptFile(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          🖼 选择图纸
        </button>
        <button style={{ flex: 1 }} disabled={status === 'recognizing' || status === 'loading'} onClick={aiRecognize}>
          🤖 AI 识别
        </button>
      </div>
      <p className="note" style={{ margin: '4px 0 0' }}>
        本地识别 = 规则方格逐格取色（离线、免费）；AI 识别 = 视觉模型读图（符号 / 色号图纸、拍照倾斜时用）。
      </p>

      {imageName !== null && (
        <p className="note" style={{ margin: '6px 0 0' }}>
          图：{imageName} · {imageWidth}×{imageHeight}px{recognizedBy !== null ? ` · 已${recognizedBy === 'ai' ? 'AI' : '本地'}识别` : ''}
        </p>
      )}
      {previewDataUrl !== null && (
        <img
          src={previewDataUrl}
          alt="图纸原图"
          style={{ display: 'block', maxWidth: '100%', maxHeight: 120, marginTop: 6, borderRadius: 4, imageRendering: 'pixelated' }}
        />
      )}
      {grid !== null ? (
        <>
          <div style={{ marginTop: 6, background: '#0b0f14', border: '1px solid var(--line)', borderRadius: 4, padding: 4 }}>
            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', maxWidth: 260, imageRendering: 'pixelated' }} />
          </div>
          <p className="note" style={{ margin: '4px 0 0' }}>
            预览 = 即将摆放的方块：{grid.cols}×{grid.rows} 格 · {palette.length} 色 · 空 {emptyCells} 格
            {geometry !== null && geometry.source === 'auto' ? ` · 格边长 ${geometry.cellW.toFixed(1)}px` : ''}
          </p>
        </>
      ) : (
        <p className="note" style={{ margin: '6px 0 0' }}>
          选一张拼豆图纸（PNG / JPEG / WebP），识别后这里会显示"将要生成的方块"预览。
        </p>
      )}
      {warnings.length > 0 && (
        <div className="warn" style={{ marginTop: 4 }}>
          {warnings.map((w) => (
            <p key={w} style={{ margin: '2px 0' }}>
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      <div className="rail-group" style={{ padding: '8px 0 2px' }}>
        识别参数
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {numField('列数（空=自动）', options.manualCols, (v) => updateOptions({ manualCols: v }), 'auto')}
        {numField('行数（空=自动）', options.manualRows, (v) => updateOptions({ manualRows: v }), 'auto')}
      </div>
      <label className="field">
        颜色归并（越大越少色）：{options.mergeTolerance}
        <input
          type="range"
          min={0}
          max={60}
          step={2}
          value={options.mergeTolerance}
          style={{ width: '100%' }}
          onChange={(e) => updateOptions({ mergeTolerance: Number(e.target.value) })}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input type="checkbox" checked={options.backgroundToEmpty} onChange={(e) => updateOptions({ backgroundToEmpty: e.target.checked })} />
        背景色（纸色）= 空位
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input type="checkbox" checked={options.trimBlankEdges} onChange={(e) => updateOptions({ trimBlankEdges: e.target.checked })} />
        裁掉四周空白边（默认保留图纸整张网格）
      </label>

      <div className="rail-group" style={{ padding: '8px 0 2px' }}>
        裁边（单位：格）
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {cropField('左', 'cropLeft')}
        {cropField('上', 'cropTop')}
        {cropField('右', 'cropRight')}
        {cropField('下', 'cropBottom')}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input type="checkbox" checked={options.mirrorX} onChange={(e) => updateOptions({ mirrorX: e.target.checked })} />
        水平镜像（图纸标注「镜像」时勾选）
      </label>
      <p className="note" style={{ margin: '2px 0 0' }}>
        顶部/左右的行列号条会自动裁；若底部还残留图例色卡条，把「下」加 1–3 格裁掉。
      </p>

      <div className="rail-group" style={{ padding: '8px 0 2px' }}>
        摆放
      </div>
      <label className="field">
        平面
        <select value={options.plane} style={{ width: '100%' }} onChange={(e) => updateOptions({ plane: e.target.value as PatternOptions['plane'] }, false)}>
          <option value="xz">地面平铺（x-z，行沿 +z）</option>
          <option value="xy">竖直墙面（x-y，行向上）</option>
        </select>
      </label>
      <div className="field">
        起点（左上角坐标）
        <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>{originAxis('x')}{originAxis('y')}{originAxis('z')}</div>
      </div>
      <label className="field">
        厚度（沿法线复制，1–8）
        <input
          type="number"
          min={1}
          max={8}
          value={options.thickness}
          style={{ width: '100%' }}
          onChange={(e) => updateOptions({ thickness: Math.max(1, Math.min(8, Math.round(Number(e.target.value)) || 1)) }, false)}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input type="checkbox" checked={options.clearEmpty} onChange={(e) => updateOptions({ clearEmpty: e.target.checked }, false)} />
        空格子也清除目标区域（默认不动已有块）
      </label>

      <button style={{ width: '100%', marginTop: 8 }} disabled={disabled || grid === null || status === 'recognizing' || !commandEnabled(cmd.patternApply)} onClick={() => cmd.patternApply.run()}>
        ⬛ 生成方块（一次 = 一条补丁，可一次撤销）
      </button>
      {message !== null && (
        <p className={status === 'error' ? 'warn' : 'note'} style={{ margin: '6px 0 0' }}>
          {message}
        </p>
      )}
    </Section>
  )
}