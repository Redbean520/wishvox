# Wishvox

**Turn a sentence — or a building you import — into a voxel structure, then keep editing it with AI and by hand on the same set of procedural operations.** Every change is recorded in an ordered patch log, so the build stays inspectable, undoable and replayable.

Wishvox runs entirely in the browser. There is no backend, no account and no cloud project: your model and your API key stay on your machine.

> **Status:** `v1.0.0`, first public release. Color-only voxel appearance (no texture packs, no materials). See [Roadmap](#status-and-roadmap) for what is *not* in this release yet.

---

## What it is

- **Input** — a sentence in Chinese or English, or a saved Wishvox project (`.json`). Import of external voxel/blueprint formats is a later direction, not part of v1.0.0.
- **How AI edits** — the model does **not** stream a voxel array. It emits one instruction per line: a program op plus its parameters. The app applies it through the editor's model API, not a private generation channel — a person can trigger the same operations by hand.
- **Output** — a voxel building you can keep editing, undo, save and export as a project file.
- **Why it is not "generate once"** — the AI never gets a private write path. It uses the editor's operations, gates and history, so its result can be inspected, partially undone, or reproduced.

The same principle drives the whole product: *the model never gains a capability a person cannot exercise.* Every operation the AI can invoke, you can also perform by hand.

## First run: the default showcase

Open Wishvox with no saved project and it loads the built-in showcase **「Blue Big Fat Fish」** (a 31-color palette, one part). You land in **inspect mode**, the default: you can orbit the camera and look, but editing tools are disabled until you switch to edit mode.

| Button | What it does |
|---|---|
| `🆕 新建` (New) | Start an empty project (a 3×3×3 blank part). |
| `🧹 清理本地数据` (Clear local data) | After confirmation, delete the local project, AI key and AI session. The next load shows the showcase again. |
| `🔄 回到默认展示件` (Back to default showcase) | Restore the showcase at any time. It first asks whether to save your current work; "save" exports a project JSON **before** resetting. |

Replacing the showcase is deliberately a two-line change: drop a new file under [`public/showcase/`](public/showcase) and point `SHOWCASE_URL` in [`src/io/showcase.ts`](src/io/showcase.ts) at it. The title is read from the file's own `meta.title`.

## Run it locally

Requirements: **Node.js >= 24** and npm (see `engines` in [`package.json`](package.json)).

```bash
npm install
npm run dev       # dev server, http://localhost:5173
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
npm run test      # headless unit tests (Vitest)
```

No environment variables are required. The editor, project save/load and showcase work without any AI configuration. To use the AI panel you add an **OpenAI-compatible endpoint and API key** in its settings; the key is written to `localStorage` only (`wishvox/ai-settings/v1`) and is never sent anywhere except the endpoint you configure.

For in-browser checks that cannot run headless (WebGL, frame rate, render invariants, gate cards), run `npm run dev` and open the pages under `/harness/` — see [`harness/README.md`](harness/README.md).

## A quick tour

- **Two modes.** Inspect (default) vs. edit. In inspect mode every human editing entry point is disabled; switching modes is a button, not a hidden keyboard shortcut.
- **Direct editing.** Place / erase / paint / eyedropper with per-tool brush sizes, a 3D viewport, layer display modes (all / below / single layer), camera reset and independent work-grid guides.
- **Procedural operations.** Nine ops — layer add, bevel, clear scope, mirror array, noise fill, noise sculpt, preset shape, raise by layers, recolor — each taking a scope, parameters and a seed.
- **Parts and compositions.** Group blocks into named parts, and group parts into compositions, so "recolor the roof" can target a real object instead of the whole model.
- **History.** One patch per stroke, or per applied operation batch. Undo, redo, and jump to any point in the patch log.
- **Project files.** Versioned JSON (v2, reads v1), export/download and import with validation before anything is applied.
- **AI panel.** A floating session panel that accepts an order, shows a plan, asks for approval at gates, and reports what it changed.
- **Bead-pattern import (🖼 图纸 → 方块).** Pick a perler-bead chart image; the panel recovers the grid and its per-cell colors, previews the blocks it will place, then writes them in one patch. Two recognition channels: a local, offline grid detector for regular colored charts, and an optional vision-model call for symbol/code charts or photographed pages (configure "视觉模型" under AI settings for the latter).

## Architecture

`src/` is split into eleven modules plus the browser entry `main.tsx`. Each module has a short README explaining its responsibility and boundaries.

| Module | Responsibility |
|---|---|
| [`core`](src/core/README.md) | Domain kernel: sparse voxel volume (16³ chunks), palette with interned color keys, the patch log, scopes, parts/compositions, brush predicates, and the single source of truth for operation specs. No React, no three.js, no DOM. |
| [`ops`](src/ops/README.md) | Nine procedural operations. Each turns a `ProgramOp` into a target state, then diffs it against the volume to produce a change set. Seeded RNG lives here. |
| [`rules`](src/rules/README.md) | The two write-time seams: a pre-write predicate and post-write reconciliation ("did the change stay inside the object the AI named?"). |
| [`io`](src/io/README.md) | Project file encode/decode and validation, storage abstraction (memory / IndexedDB), debounced autosave, JSON download/read, session-log export, the showcase loader. |
| [`state`](src/state/README.md) | Two Zustand stores (editor UI state, AI panel state) and the model→UI projection. Session state is not saved into the project file. |
| [`edit`](src/edit/README.md) | The `Editor` facade and every write path: stroke state machine, model API, undo history, parts/composition lifecycle, project load/save, the AI write seam, and the render port. |
| [`render`](src/render/README.md) | Draw only: three.js instanced chunk meshes, appearance resolution, highlight and preview. Does not import interaction. |
| [`interaction`](src/interaction/README.md) | 3D view orchestration, camera rig, ray picking, grid guides. Implements the render port defined by `edit`. |
| [`ai`](src/ai/README.md) | Agent loop, tool surface derived from the op specs, OpenAI-compatible streaming provider, approval gates, append-only session log. |
| [`ui`](src/ui/README.md) | React shell, floating panels, viewport host, and the named command table that buttons, shortcuts and AI tools share. |
| [`app`](src/app/README.md) | Composition root: lazily created singletons and `bootstrap()`. |

### Two write paths, one ledger

```text
pointer ──► StrokeSession ──► applyBrush ─────────────┐
                                                      ├──► PatchLog ──► syncUi() ──► renderer
AI tool ──► runProgramOp ──► change set ──────────────┘
```

- A human stroke and an AI operation both end in the same **patch log**; that log is the single accounting record for the model. It backs undo, redo, history jumps and the AI's own context.
- `ops` computes a terminal-state diff — every affected coordinate appears exactly once, and an empty diff produces no patch at all. "Compute the change" belongs to `ops`; "record it" belongs to `core`.
- Rendering sits behind a port (`edit/render-port.ts`). `edit` never imports `render`, `interaction` or three.js, so the whole editor can be instantiated headlessly in tests.
- Layer direction is strict: a layer may import itself and lower layers. The only upward edge is `ui → app`, and [`tests/structure/structure.test.ts`](tests/structure/structure.test.ts) enforces the order, acyclicity, the no-`ai→ui` rule and the composition-root rule.

### Importing a bead pattern (拼豆图纸)

Open **AI 编辑 → 🖼 图纸 → 方块**:

1. **选择图纸** — a chart image (PNG / JPEG / WebP). The local detector trims the paper margin, finds the cell size, samples each cell's colour and merges near-duplicate colours. Symbol/code charts or skewed photos: click **🤖 AI 识别** instead (needs a vision-capable model configured under AI 连接 → 视觉模型; the local channel never leaves your machine).
2. **核对预览** — the canvas shows *the blocks that will be placed*, plus size / colour count / empty cells. Wrong grid → set rows/cols manually or move the 颜色归并 threshold.
3. **摆放参数** — plane (floor `x-z` or wall `x-y`), top-left origin, thickness (1–8 layers along the normal), and whether empty cells also clear the target area.
4. **生成方块** — one import = **one patch**, so one undo removes it. The count and any out-of-range cells are reported; nothing is written when the input is invalid.

AI recognition is a read-only step: the model returns a colour grid that you inspect; the write goes through the same editor operations a human uses (no private write path).

### What is persisted

- **Project** — the volume, parts, compositions, patch log, palette and metadata, as versioned JSON. Autosaved to IndexedDB (debounced), and downloadable/importable as a file. Imports are validated first; a failed import changes nothing.
- **AI session** — an append-only event log in `localStorage`. The UI state and "resume after refresh" are both replayed from it: the log *is* the state.
- **UI session state** — camera, mode, panel layout, brush settings. Deliberately not part of the project file.

## Design decisions

1. **Operations, not voxel dumps.** The AI's output is a sequence of procedural instructions. This keeps results reviewable, parameterized and reproducible instead of being an opaque one-shot mesh.
2. **One ledger for every write.** Manual strokes and AI batches both pass through `PatchLog`. Undo, redo and replay are the same mechanism, not three parallel ones.
3. **Determinism where it matters.** Program ops are pure functions of scope, parameters and seed (mulberry32), so the same input produces the same model. Natural-language phrasing may vary; the executed result does not.
4. **Hard layering, explicit ports.** `core` is pure TypeScript; `edit` does not know about three.js; `render` does not know about picking. This is what makes headless tests possible and keeps the AI layer from reaching into the UI.
5. **Color-only identity.** A block's identity is a canonical color plus a project color key. There are no textures, materials or second block system. Legacy files that carry an older block style are **downgraded to color** on load with a visible note — blocks are never silently dropped.
6. **The session log is the state.** AI conversations are append-only events, replayed into the UI and on resume. There is no shadow mutable conversation object to drift out of sync.
7. **Approval gates, then reconciliation.** Writes can pause at a gate (strict / checkpoint / permissive) and ask you; after execution, reconciliation checks the change set was contained in the object the AI claimed to edit. A mismatch is fed back to the model as a teaching error.
8. **Local-first, bring your own key.** No accounts, no server, no telemetry. The project lives in IndexedDB and the key in `localStorage`.

## Repository layout

| Path | Contents |
|---|---|
| [`src/`](src/README.md) | Application source, split into the eleven modules above. |
| [`tests/`](tests/README.md) | Headless Vitest suites: pure functions, data contracts, determinism, structure rules. |
| [`harness/`](harness/README.md) | In-browser check pages for what cannot be tested headlessly (WebGL, frame rate, render invariants, gate UI). |
| [`public/showcase/`](public/showcase) | The default showcase project file. |
| [`index.html`](index.html) | Vite entry document. |
| [`LICENSE`](LICENSE) · [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES) | Apache-2.0 license and third-party attribution. |

## Status and roadmap

**v1.0.0** is the first public release. It ships the editing loop end to end: inspect/edit modes, manual and AI editing, procedural ops, parts and compositions, patch-log history, autosave, project import/export, and the default showcase.

Not in this release — kept as a direction, not a claim:

- Cinematic playback and video / PNG export of the build process. The patch log is the intended basis; the player and exporters are not built yet.
- Import of external voxel or blueprint formats.
- Mobile / touch editing.
- Texture or material systems.

The public site is intended to live at `https://hydrocylic.github.io/wishvox/`; verify against the deployed build rather than this file.

## License

Wishvox is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE) for the full text and [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES) for third-party attribution.

---

## 中文速览

**Wishvox** 把一句话（或导入的建筑）变成体素建筑；人与 AI 在同一套程序化操作上协同编辑，每一步都记进补丁日志，因此可检查、可撤销、可重放。

- **首运行**：没有存档时载入默认展示件「Blue Big Fat Fish」（31 色）。顶栏 `🔄 回到默认展示件` 可随时重置（会先问是否保存当前工作）；`🧹 清理本地数据` 清空后会再次载入展示件。
- **图纸导入**（新增）：AI 工作台里「🖼 图纸 → 方块」——选一张拼豆图纸，本地识别（离线、规则彩色格子图纸）或 AI 视觉识别（符号 / 色号图纸、拍照页），核对预览后选平面（地面 / 墙面）、起点、厚度，一次生成一条补丁（一次撤销）。AI 通道需在「AI 连接 → 视觉模型」填支持图片输入的模型名。
- **怎么跑**：需要 Node.js >= 24。

  ```bash
  npm install
  npm run dev     # http://localhost:5173
  npm run build   # 产物在 dist/
  npm run test    # 无头单元测试（Vitest）
  ```

- **不用配置也能用**：编辑、存档、展示件都不需要密钥。AI 面板需自填 OpenAI 兼容端点与 key，只存在浏览器本地。
- **架构**：`src/` 分 11 个模块（`ai` `app` `core` `edit` `interaction` `io` `ops` `render` `rules` `state` `ui`）。人的笔刷与 AI 的程序化操作最终都写入同一个 `PatchLog`；层间只允许向下依赖，唯一上行边是 `ui → app`。
- **关键决定**：AI 只产出「每行一条」的程序化指令，不直接吐体素数组；程序化操作按参数与种子确定性复现；方块体系只有颜色（无贴图、无第二套方块身份）；AI 会话「日志即状态」。
- **状态**：`v1.0.0` 首次公开。建造演出、视频/截图导出与外部蓝图导入是后续方向，**本版未实现**。
- **许可**：Apache-2.0，见 [`LICENSE`](LICENSE) 与 [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES)。
