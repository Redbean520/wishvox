# harness — 浏览器内对拍与不变量检查

<!-- 位置: harness/README.md -->

无法无头验证的阶段（GPU / 浏览器）在这里检查：与参考实现或第二个实现（如 CPU oracle）**逐项比对**，
输出 **PASS / FAIL 与数值差值**，而不是靠肉眼。

- **首件随 `r01` 落**：帧率 / 渲染结果的检查页。
- **怎么打开**（T18）：验证页**不能双击 .html 直开**（要走模块加载与 WebGL）——在仓库根 `npm run dev` 后访问
  `http://localhost:5173/harness/frame-rate.html` 与 `http://localhost:5173/harness/render-invariants.html`（dev server 直开，不进 build 产物）。
- **`r02` 前半新增第三页**（2026-10-04）：`http://localhost:5173/harness/editing-view.html` ——编辑系统视口读回（V1 目标点与拖动冻结 / V3 可见块数=按层计数与隐藏层不可拾取 / V4 网格对象数 / V5 坯料 / V6 预览集合=笔刷体积 / V8 一次撤销的块数 / V10 检视态门 / V11 相机会话态与撤销不回退视图 / **模型长高后层次过滤已推**（`debug-261007`））。
- **`r03` 新增第四页**（2026-10-05）：`http://localhost:5173/harness/agent-loop.html` ——AI 会话链路读回（V1 主链路 / V3 三档抽查 / V4 刷新续跑重入 / V2 容错与一键重试入口 / op rows 计数对账）；全部走**脚本化 provider**（线级 SSE 注入，不出网、不需要 key）；真实 provider 自证（V10）与 BYOK 读回（V5）归 `MT`。
- **`r05` 第五页（已随 r07 UI 重构移除）**：`gate-pinned-visible` 原先验证「闸门卡在悬浮块收起态仍可见」；
  悬浮块体系已整体替换为右栏 Dock（闸门卡常显在 AI 标签页顶部），该页连同对应折叠机制一并删除。
- **`r05` 新增第六页**（2026-10-08）：`http://localhost:5173/harness/preview-key-tool-size.html` ——**关键块预览 + 每工具笔刷尺寸读回**（`REQ-063` / `REQ-064`）：挂**真** `VoxelView`（WebGL，与产品同链路）⇒ 读回 `getPreviewKeyCells` / `getPreviewCells` / `previewMeshCounts`（关键与附属**两组网格实例数**）与 store 的 `brushSizes`（按工具）+ 镜像 `brushSize` + 笔刷一笔补丁的 `op.size`。判据：`2×2×2` 恰 1 格关键、`1×1×1` 关键 1 / 附属 0、过滤后关键 ≤1、检视态双 0、**预览集合 = 笔刷体积 ∩ 既有谓词**；尺寸三工具来回切换各自保持、预览与补丁同源、初值 `{1,1,1}`、每轴 1–8 报错不变、项目文件不含尺寸。页内自驱动，**需 WebGL**（无头需 `--enable-unsafe-swiftshader`）。
- **注意**：不在 `reference/**` 里装配运行环境——要跑参考的示例，复刻到这里再跑。
- **依据**：`../voxel-ai-editor-lab/_framework/project-types/reconstruction/SKELETON.md` §验证设施。