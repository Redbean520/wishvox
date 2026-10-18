import { useRef } from 'react'
import { getEditor } from '../../app/runtime'
import { downloadJson, readTextFile } from '../../io/file-transfer'
import { useEditorUi } from '../../state/editor-store'
import { cmd, commandEnabled } from '../commands'
import { UI_BOUNDARY_ATTR } from '../UiInputBoundary'

// 顶栏：品牌 · 模式开关 · 撤销/重做 · 项目操作（新建 / 清理 / 展示件 / 导入 / 导出） · 保存状态。
// 全部走具名命令（commands.ts），这里只负责布局与样式。
const SAVE_TEXT: Record<string, string> = {
  idle: '已就绪',
  pending: '自动保存中…',
  saved: '已保存',
  error: '保存失败 · 点击重试',
}

export function TopBar(): JSX.Element {
  const saveState = useEditorUi((s) => s.saveState)
  const mode = useEditorUi((s) => s.mode)
  const fileInput = useRef<HTMLInputElement>(null)

  const onExport = (): void => {
    void getEditor().autosave.flush()
    downloadJson('voxel-project.json', getEditor().exportFile())
  }
  const onImportFile = (file: File): void => {
    void readTextFile(file).then((text) => getEditor().importFile(text))
  }
  const iconButton = (command: { run: () => void; available?: (s: never) => boolean } | null, glyph: string, title: string, onClick?: () => void): JSX.Element => (
    <button className="icon-btn ghost" title={title} aria-label={title} disabled={command !== null && !commandEnabled(command as never)} onClick={onClick ?? (() => command?.run())}>
      {glyph}
    </button>
  )
  const saveNode =
    saveState === 'error' ? (
      <button className="save-retry" title="点击重试保存" onClick={() => void getEditor().autosave.flush()}>
        {SAVE_TEXT[saveState]}
      </button>
    ) : (
      <span className="save">{SAVE_TEXT[saveState]}</span>
    )

  return (
    <header className="topbar" {...{ [UI_BOUNDARY_ATTR]: 'topbar' }}>
      <span className="brand">
        wishvox <span className="dot">◆</span>
      </span>
      <span className="save">{saveNode}</span>
      <span className="topbar-sep" />
      <button
        className={`mode-pill ${mode}`}
        title={mode === 'edit' ? '编辑态 · 点击切到检视态' : '检视态 · 点击切到编辑态'}
        onClick={() => cmd.toggleMode.run()}
      >
        {mode === 'edit' ? '✏ 编辑' : '👁 检视'}
      </button>
      <span className="topbar-sep" />
      {iconButton(cmd.undo, '↩', '撤销（Ctrl+Z）')}
      {iconButton(cmd.redo, '↪', '重做（Ctrl+Shift+Z / Ctrl+Y）')}
      <span className="spacer" />
      {iconButton(cmd.newProject, '＋', '新建项目')}
      {iconButton(cmd.cleanLocalData, '⌫', '清理本地数据')}
      {iconButton(cmd.showcaseReset, '↺', '回到默认展示件')}
      {iconButton(null, '⇩', '导入项目（json）', () => fileInput.current?.click())}
      {iconButton(null, '⇧', '导出项目（json）', onExport)}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImportFile(f)
          e.target.value = ''
        }}
      />
    </header>
  )
}
