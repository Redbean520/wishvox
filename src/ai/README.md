# ai — agent 会话层

会话循环（`loop.ts` 的 AgentLoop：order → 轮循环 → 工具批（三档闸门）→ 治理 → jobEnd / resume / retry）·
工具面（`tools.ts` 的 19 件 = OP_SPECS 派生写工具 + 读 5 + 会话 1）· 执行器（`executor.ts` 主流程；
解析族在 `args.ts` + `scope-args.ts`，回执面在 `receipt.ts`）· 消息面（`messages.ts`——系统提示词由
`rules/{pre,post}` 的 agentHint 派生，A1 同源纪律）· `view.ts`（读面五工具）· `gates.ts`（三档闸门 +
GateBroker，"状态即日志事件"）· `provider.ts`（OpenAI 兼容流式 + 重试梯 + 本地预检）· `session-log.ts`
（事件源 + 重放 + 持久化 + 校验，"THE LOG IS THE STATE"）· `settings.ts`（BYOK 设置）·
`scripted-provider.ts`（测试设施：线级 SSE 注入）· `wire.ts`（Chat Completions wire 形状：messages / tools，含多模态 content parts）·
`pattern-vision.ts`（图纸识别的视觉通道：一次读图 → 颜色网格；只读、不进 agent 循环、不写模型）。

- **做什么**：AI 参与编辑的整个会话面；写路径全部经 `edit` 的模型级 API（不新增写路径）。
  视觉通道只产出**给人核对的网格**，写入由人确认后走 `edit/pattern-apply.ts`。
- **不做什么**：不 import `ui/`（structure 断言④）；不装配（AgentSession 单例在 `app/`）；
  对账规则本体在 `rules/`（本层只是消费方）。
- **依赖**：`core` · `rules` · `edit`（Editor 类型与模型级 API）· `state`（读面选中态）。