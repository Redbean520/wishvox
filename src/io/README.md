# io — 存档与持久化

`serialize`（项目文件 v2 编解码 + 校验 + v1 迁移）· `project-store`（内存 / IndexedDB 存储抽象）·
`autosave`（防抖落库，REQ-002）· `version`（APP_VERSION 单点，仍读 package.json，Q4 已裁 A）·
`file-transfer`（downloadJson / readTextFile——UI 只留按钮）·
`showcase`（首运行默认展示件：`SHOWCASE_URL` 单一常量 + fetch 可注入 + 失败一律 null）·
`pattern/`（拼豆图纸识别：`lattice` 格线定位 / `detect` 色差周期 / `sample` 逐格取色 / `recognize` 编排为纯函数，`decode` 浏览器解码——图片 → 颜色网格）。

- **做什么**：一切"进出仓库/浏览器"的传输与编解码；图片导入的**只读识别**（图纸像素 → 行列 + 逐格颜色）。
- **不做什么**：不含 UI 触发（App.tsx 的按钮）；不做业务校验之外的模型操作；**不写模型**
  （图纸网格 → 方块在 `edit/pattern-apply.ts`，与笔刷 / 程序化操作同一条记账路径）。
- **依赖**：`core`（类型/patch-log/registries）+ 仓库根 package.json（已单点 + 注释记账）。