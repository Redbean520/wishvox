import { UI_BOUNDARY_ATTR } from './UiInputBoundary'

// 「显示」标签页里的外观说明块。color-only 体系（REQ-022）：无贴图 / 无材质 / 无第二套外观可切。
export function StylePanel(): JSX.Element {
  return (
    <section className="panel" {...{ [UI_BOUNDARY_ATTR]: 'pane:style' }}>
      <div className="panel-head">
        <span className="panel-emoji" aria-hidden>
          🎨
        </span>
        <span className="panel-title">外观</span>
        <span className="panel-hint">彩色单一体系</span>
      </div>
      <div className="panel-body">
        <p className="note" style={{ margin: 0 }}>
          当前为彩色单一体系（color-only）：无贴图源、无材质、无第二套外观可切。颜色在左栏取色器与调色板里选，作为方块身份写入项目色板。
        </p>
      </div>
    </section>
  )
}
