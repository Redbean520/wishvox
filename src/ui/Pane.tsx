import type { ReactNode } from 'react'
import { UI_BOUNDARY_ATTR } from './UiInputBoundary'

// 面板容器（原 `FloatingTile` 的替身）：固定栏位里的内容块。
// 与旧件的区别：**不折叠、不定位、不量测**——开关与位置不再由每个面板自持，而是由右侧 Dock 的标签页统一负责。
// 保留 `summary / accessory` 两个参数只是为了兼容既有面板组件（摘要作为一行弱化读数显示）。
export interface PaneProps {
  readonly id: string
  /** 面板当前状态的一行弱化读数（如"3 层 · 显示全部"） */
  readonly summary?: ReactNode
  /** 面板顶部常显附件（如 AI 闸门卡） */
  readonly accessory?: ReactNode
  readonly children: ReactNode
}

export function Pane(props: PaneProps): JSX.Element {
  return (
    <section className="pane" data-pane={props.id} {...{ [UI_BOUNDARY_ATTR]: `pane:${props.id}` }}>
      {props.accessory !== undefined && props.accessory !== null && <div className="pane-accessory">{props.accessory}</div>}
      {props.summary !== undefined && props.summary !== null && props.summary !== '' && <div className="pane-summary">{props.summary}</div>}
      {props.children}
    </section>
  )
}
