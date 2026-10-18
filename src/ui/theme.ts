// 全局设计系统（唯一出处）：颜色 / 间距 / 控件高度 / 排版全部走 CSS 变量。
// 组件里不再写"临时颜色和字号"——旧的悬浮块样式（floating-styles.ts）与 App 内联 CSS 一并并入这里。
export const APP_CSS = `
  :root {
    --bg: #0b0d10;
    --surface: #11151b;
    --surface-2: #161b23;
    --surface-3: #1c222c;
    --line: #242b36;
    --line-soft: #1a2029;
    --fg: #e7ecf3;
    --fg-dim: #9aa5b4;
    --fg-mute: #6b7686;
    --accent: #4f8cff;
    --accent-soft: rgba(79, 140, 255, 0.16);
    --accent-line: rgba(79, 140, 255, 0.5);
    --ok: #59b86b;
    --warn: #d9a94e;
    --err: #e06c5a;
    --radius: 6px;
    --radius-sm: 4px;
    --ctl-h: 28px;
    --font-ui: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
    --font-mono: ui-monospace, Consolas, "Cascadia Mono", monospace;
  }
  * { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body { font-family: var(--font-ui); font-size: 12.5px; color: var(--fg); background: var(--bg); }
  button, input, select, textarea { font: inherit; color: inherit; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: #2a323e; border-radius: 6px; border: 2px solid var(--surface); }
  ::-webkit-scrollbar-track { background: transparent; }

  /* ── 外壳：顶栏 / 三栏主体 / 状态栏 ── */
  .shell { height: 100%; display: grid; grid-template-rows: 46px minmax(0, 1fr) 26px; }
  .shell-body { display: grid; grid-template-columns: 252px minmax(0, 1fr) 336px; min-height: 0; }
  .topbar { display: flex; align-items: center; gap: 8px; padding: 0 12px; background: #0d1117; border-bottom: 1px solid var(--line); }
  .brand { font-weight: 700; letter-spacing: 0.02em; font-size: 13px; white-space: nowrap; }
  .brand .dot { color: var(--accent); }
  .topbar-sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; flex: none; }
  .spacer { flex: 1; }
  .save { color: var(--fg-mute); font-size: 11.5px; white-space: nowrap; }
  .save-retry { background: none; border: 0; padding: 0; color: var(--err); font-size: 11.5px; cursor: pointer; text-decoration: underline; }
  .icon-btn { min-width: 30px; height: var(--ctl-h); padding: 0 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; }
  .mode-pill { height: var(--ctl-h); padding: 0 12px; border-radius: 999px; font-size: 12px; white-space: nowrap; }
  .mode-pill.edit { background: rgba(89, 184, 107, 0.14); border-color: rgba(89, 184, 107, 0.5); color: #a9e6b5; }
  .mode-pill.inspect { background: var(--surface-3); color: var(--fg-dim); }

  /* ── 通用控件 ── */
  button { height: var(--ctl-h); padding: 0 10px; background: var(--surface-3); color: var(--fg); border: 1px solid var(--line); border-radius: var(--radius); cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  button:hover:not(:disabled) { background: #232b37; border-color: #303a48; }
  button:disabled { opacity: 0.4; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover:not(:disabled) { background: #3f7ef2; }
  button.ghost { background: transparent; border-color: transparent; color: var(--fg-dim); }
  button.ghost:hover:not(:disabled) { background: var(--surface-3); color: var(--fg); }
  .mini-btn { height: 24px; padding: 0 8px; font-size: 11.5px; }
  select, input[type="text"], input[type="password"], input[type="number"], input:not([type]), textarea {
    width: 100%; height: var(--ctl-h); padding: 0 8px; background: #0d1117; color: var(--fg);
    border: 1px solid var(--line); border-radius: var(--radius); outline: none;
  }
  select:focus, input:focus, textarea:focus { border-color: var(--accent-line); box-shadow: 0 0 0 2px var(--accent-soft); }
  textarea { height: auto; padding: 6px 8px; resize: vertical; line-height: 1.5; }
  input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--accent); }
  input[type="range"] { width: 100%; accent-color: var(--accent); }
  .field { display: block; margin: 8px 0; font-size: 11.5px; color: var(--fg-dim); }
  .field > select, .field > input { margin-top: 4px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row > * { min-width: 0; }
  .note { color: var(--fg-mute); font-size: 11px; line-height: 1.55; margin: 6px 0 0; }
  .warn { color: var(--warn); font-size: 11.5px; line-height: 1.55; margin: 6px 0; }
  .err { color: var(--err); font-size: 11.5px; line-height: 1.55; margin: 6px 0; }
  .group-title { padding: 12px 0 6px; font-size: 10.5px; letter-spacing: 0.11em; text-transform: uppercase; color: var(--fg-mute); }

  /* ── 左栏：工具与颜色 ── */
  .left-rail { min-height: 0; overflow-y: auto; padding: 10px 12px 24px; background: var(--surface); border-right: 1px solid var(--line); }
  .tool-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .tool-btn { height: 50px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 11px; color: var(--fg-dim); padding: 0; }
  .tool-btn .glyph { font-size: 16px; line-height: 1; }
  .tool-btn.on { background: var(--accent-soft); border-color: var(--accent-line); color: #cfe0ff; }
  .brush-row { display: flex; gap: 6px; }
  .brush-row > label { flex: 1; font-size: 11px; color: var(--fg-dim); text-align: center; }
  .brush-row input { margin-top: 4px; text-align: center; }
  .swatch-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
  .swatch { height: 22px; padding: 0; border-radius: var(--radius-sm); border: 1px solid rgba(0, 0, 0, 0.45); }
  .swatch.on { outline: 2px solid #fff; outline-offset: -2px; }
  .used-colors { display: flex; flex-wrap: wrap; gap: 4px; }

  /* ── 中栏：视口与 HUD ── */
  .stage { position: relative; min-width: 0; min-height: 0; background: #0b0d10; }
  .viewport-host { position: absolute; inset: 0; }
  .viewport-host canvas { display: block; width: 100%; height: 100%; }
  .hud { position: absolute; left: 12px; top: 12px; max-width: 420px; padding: 8px 10px; border-radius: var(--radius);
    background: rgba(12, 16, 22, 0.82); border: 1px solid var(--line); backdrop-filter: blur(6px); pointer-events: none;
    font-family: var(--font-mono); font-size: 11px; line-height: 1.7; color: var(--fg-dim); white-space: pre; }
  .hud b { color: var(--fg); font-weight: 600; }
  .hud .hud-preview { margin-top: 4px; color: #8fd6a0; }
  .hud .hud-hint { margin-top: 4px; color: var(--fg-mute); font-family: var(--font-ui); white-space: normal; }
  .hud-warn { margin-top: 4px; color: var(--warn); }
  .flash { animation: hud-flash 1.6s ease-out 1; }
  @keyframes hud-flash { 0% { background: rgba(217, 169, 78, 0.28); } 100% { background: transparent; } }

  /* ── 右栏：Dock 与标签页 ── */
  .right-dock { min-height: 0; display: flex; flex-direction: column; background: var(--surface); border-left: 1px solid var(--line); }
  .dock-tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
  .dock-tab { height: 30px; padding: 0 10px; border: 1px solid transparent; border-bottom: 0; border-radius: var(--radius) var(--radius) 0 0; background: transparent; color: var(--fg-mute); font-size: 12px; white-space: nowrap; }
  .dock-tab:hover:not(.on) { color: var(--fg-dim); background: var(--surface-2); border-color: transparent; }
  .dock-tab.on { background: var(--surface-2); border-color: var(--line); color: var(--fg); }
  .dock-tab .tab-badge { margin-left: 4px; color: var(--warn); }
  .dock-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 28px; }

  /* ── 面板与折叠区块 ── */
  .pane { display: block; }
  .pane + .pane { margin-top: 12px; }
  .pane-summary { color: var(--fg-mute); font-size: 11px; margin: 0 0 8px; line-height: 1.5; }
  .pane-accessory { margin-bottom: 10px; }
  .panel { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-2); margin: 8px 0; overflow: hidden; }
  .panel:first-child { margin-top: 0; }
  .panel-head { width: 100%; height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 0; border-radius: 0; background: transparent; text-align: left; font-size: 12px; font-weight: 600; color: var(--fg); }
  .panel-head:hover:not(:disabled) { background: #1d242e; }
  .panel-head .chev { width: 10px; color: var(--fg-mute); font-size: 9px; flex: none; }
  .panel-emoji { font-size: 13px; flex: none; }
  .panel-title { flex: none; }
  .panel-hint { margin-left: auto; padding-left: 8px; color: var(--fg-mute); font-weight: 400; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel-body { padding: 4px 10px 12px; }
  .panel-pinned { padding: 0 10px 10px; }
  .rail-group { padding: 4px 0; font-size: 10.5px; letter-spacing: 0.1em; color: var(--fg-mute); text-transform: uppercase; }

  /* ── 状态栏 ── */
  .statusbar { display: flex; align-items: center; gap: 14px; padding: 0 12px; background: #0d1117; border-top: 1px solid var(--line); font-size: 11px; color: var(--fg-mute); overflow: hidden; }
  .statusbar .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-dim); }
  .statusbar .stat b { color: var(--fg-dim); font-weight: 600; }
  .statusbar .sep { width: 1px; height: 12px; background: var(--line); }

  /* ── 兼容既有面板里的行内排版（列表 / 徽章） ── */
  .list-row { display: flex; align-items: center; gap: 6px; width: 100%; height: 26px; padding: 0 6px; background: transparent; border: 0; border-radius: var(--radius-sm); color: var(--fg-dim); font-size: 12px; text-align: left; }
  .list-row:hover:not(:disabled) { background: var(--surface-3); color: var(--fg); }
  .list-row.on { background: var(--accent-soft); color: #cfe0ff; }
  .list-row .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list-row .meta { color: var(--fg-mute); font-size: 10.5px; flex: none; }
  .empty { padding: 14px 4px; color: var(--fg-mute); font-size: 11.5px; text-align: center; }
`
