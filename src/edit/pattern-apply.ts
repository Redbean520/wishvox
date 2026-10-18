// 图纸网格 → 方块：**一次导入 = 一条补丁**（可一次撤销），与笔刷 / 程序化操作同一条记账路径。
//
// 三条纪律（与 `ai-write.ts#aiSetCells` 同口径）：
// ① 写之前把**所有**校验做完（尺寸 / 颜色合法性 / 坐标域 / 色板容量）——任何失败都零写入、
//    零记账、零新色键（色板事务回收）；
// ② 颜色键只在**真正写入前**分配（`REQ-027` 门四）；分配后再写 volume，最后 commitStroke 记账
//    （先旁路写、后补账 = 与一笔笔刷相同的数据流，撤销才能覆盖这一整批）；
// ③ 空格子默认**不动**（图纸里的空白不是"要求擦除"）；`clearEmpty` 勾选后才会把目标区域的空格清掉。
import { canonicalHex, MAX_PALETTE_KEY } from '../core/color'
import { coordKey, isCoordTripleDomain } from '../core/coords'
import { PATTERN_LIMITS } from '../io/pattern/types'
import type { PatternGrid } from '../io/pattern/types'
import type { Coord, Patch, VoxelChange } from '../core/types'
import { newColorTx, rollbackColorTx, txKeyForColor } from './color'
import type { Editor } from './editor'

export type PatternPlane = 'xz' | 'xy'

export interface PatternApplyArgs {
  readonly grid: PatternGrid
  /** 摆放平面：`xz` = 地面平铺（行沿 +z）· `xy` = 竖直墙面（行向上） */
  readonly plane: PatternPlane
  /** 网格左上角对应的体素坐标 */
  readonly origin: Coord
  /** 厚度（1–8）：沿平面法线复制（xz ⇒ +y，xy ⇒ +z） */
  readonly thickness?: number
  /** 空格子也清除目标区域（默认 false = 空格跳过，不动已有块） */
  readonly clearEmpty?: boolean
  readonly label?: string
}

export interface PatternApplyResult {
  readonly ok: boolean
  readonly patch: Patch | null
  readonly placed: number
  readonly skipped: number
  readonly colors: number
  readonly message: string
}

/** 图纸格 → 体素坐标（纯函数；行 0 = 图纸顶行） */
export function patternCoord(args: {
  readonly plane: PatternPlane
  readonly origin: Coord
  readonly cols: number
  readonly rows: number
  readonly col: number
  readonly row: number
  readonly layer: number
}): Coord {
  const { plane, origin, rows, col, row, layer } = args
  if (plane === 'xz') return { x: origin.x + col, y: origin.y + layer, z: origin.z + row }
  // 墙面：图纸顶行在最上面 ⇒ y 反向；厚度沿 +z 往外长
  return { x: origin.x + col, y: origin.y + (rows - 1 - row), z: origin.z + layer }
}

const fail = (message: string): PatternApplyResult => ({ ok: false, patch: null, placed: 0, skipped: 0, colors: 0, message })

/** 校验 + 归一（返回 null = 通过；否则是给用户看的原因） */
function validate(grid: PatternGrid, thickness: number): string | null {
  if (!Number.isInteger(grid.cols) || !Number.isInteger(grid.rows)) return '网格行列必须是整数'
  if (grid.cols < 1 || grid.rows < 1) return '网格行列至少为 1'
  if (grid.cols > PATTERN_LIMITS.maxSide || grid.rows > PATTERN_LIMITS.maxSide) {
    return `图纸太大（${grid.cols}×${grid.rows}，上限 ${PATTERN_LIMITS.maxSide}×${PATTERN_LIMITS.maxSide}）`
  }
  if (grid.cols * grid.rows > PATTERN_LIMITS.maxCells) return '格子数超过上限'
  if (grid.cells.length !== grid.cols * grid.rows) return '网格数据长度与行列不一致（数据损坏，未写入）'
  if (!Number.isInteger(thickness) || thickness < 1 || thickness > 8) return '厚度须为 1–8 的整数'
  for (let i = 0; i < grid.cells.length; i++) {
    const hex = grid.cells[i]
    if (hex === null || hex === undefined) continue
    if (canonicalHex(hex) === null) return `第 ${Math.floor(i / grid.cols) + 1} 行第 ${(i % grid.cols) + 1} 格颜色非法：${hex}`
  }
  return null
}

/**
 * 把识别出的图纸网格写进模型。**一次调用 = 一条 stroke 补丁**；目标区域放不下 /
 * 全部与现有模型相同 ⇒ 不记账并给出原因（模型零改动）。
 */
export function applyPattern(ed: Editor, args: PatternApplyArgs): PatternApplyResult {
  if (ed.stroke.active) return fail('一笔进行中：先松开鼠标（或取消该笔）再生成方块；模型未改动')
  const thickness = Math.round(args.thickness ?? 1)
  const invalid = validate(args.grid, thickness)
  if (invalid !== null) return fail(invalid)
  if (!isCoordTripleDomain(args.origin.x, args.origin.y, args.origin.z)) {
    return fail(`起点坐标非法（须为 ±4096 内的整数）：(${args.origin.x}, ${args.origin.y}, ${args.origin.z})——未写入`)
  }

  const { grid, plane, origin } = args
  const clearEmpty = args.clearEmpty === true
  const partId = ed.selectedPartId
  const tx = newColorTx()
  // 1) 颜色键：先全部分配（同色复用）；任一失败 ⇒ 回滚未落账的新键、零写入
  const keyOf = new Map<string, number>()
  try {
    for (const hex of grid.cells) {
      if (hex === null || hex === undefined) continue
      const c = canonicalHex(hex)
      if (c === null) return fail(`颜色非法：${hex}`)
      if (keyOf.has(c)) continue
      if (ed.volume.palette.size + keyOf.size >= MAX_PALETTE_KEY) {
        rollbackColorTx(ed, tx)
        return fail(`颜色键容量已满（上限 ${MAX_PALETTE_KEY}）：本次未写入、色板未改动`)
      }
      const res = txKeyForColor(ed, tx, c)
      if (!res.ok) {
        rollbackColorTx(ed, tx)
        return fail(res.message)
      }
      keyOf.set(c, res.key)
    }
  } catch (e) {
    rollbackColorTx(ed, tx)
    return fail((e as Error).message)
  }

  // 2) 目标格 → 变更集（先算完再写：校验失败不留半完成的模型）
  interface Planned {
    readonly coord: Coord
    readonly before: number
    readonly after: number
    readonly ownerBefore: string | null
  }
  const planned: Planned[] = []
  let skipped = 0
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const hex = grid.cells[row * grid.cols + col]
      const key = hex === null || hex === undefined ? 0 : (keyOf.get(canonicalHex(hex)!) ?? 0)
      if (key === 0 && !clearEmpty) continue
      for (let layer = 0; layer < thickness; layer++) {
        const coord = patternCoord({ plane, origin, cols: grid.cols, rows: grid.rows, col, row, layer })
        if (!isCoordTripleDomain(coord.x, coord.y, coord.z)) {
          skipped++
          continue
        }
        const before = ed.volume.getBlock(coord.x, coord.y, coord.z)
        if (before === key) continue
        planned.push({ coord, before, after: key, ownerBefore: ed.parts.partIdOf(coord.x, coord.y, coord.z) ?? null })
      }
    }
  }
  if (planned.length === 0) {
    rollbackColorTx(ed, tx)
    const why = skipped > 0 ? '所有目标格都超出坐标域（±4096）' : '目标区域已是同样颜色（零变化）'
    return fail(`没有需要写入的变化：${why}`)
  }

  // 3) 旁路写入模型（与笔刷同一条数据流：先写 volume / 归属，再记账）
  const buffer = new Map<string, Planned>()
  for (const p of planned) {
    buffer.set(coordKey(p.coord.x, p.coord.y, p.coord.z), p)
    ed.volume.setBlock(p.coord.x, p.coord.y, p.coord.z, p.after)
    if (p.after === 0) ed.parts.unassign(p.coord.x, p.coord.y, p.coord.z)
    else if (p.before === 0 && partId !== null && ed.parts.get(partId)) ed.parts.assign(p.coord.x, p.coord.y, p.coord.z, partId)
  }
  const cells = [...buffer.values()].sort((a, b) => a.coord.x - b.coord.x || a.coord.y - b.coord.y || a.coord.z - b.coord.z)
  const changes: VoxelChange[] = cells.map((p) => ({ x: p.coord.x, y: p.coord.y, z: p.coord.z, before: p.before, after: p.after }))
  const patch = ed.log.commitStroke({
    changes,
    ownersBefore: cells.map((p) => p.ownerBefore),
    op: { type: 'stroke', action: 'place', mode: 'override', size: { x: 1, y: 1, z: 1 } },
    label: args.label ?? `图纸·${grid.cols}×${grid.rows}${thickness > 1 ? `×${thickness}` : ''}（${changes.length} 格）`,
    partId,
  })
  if (patch === null) return fail('没有需要写入的变化（零变化）')
  ed.afterChange(patch.changes)
  const placed = changes.filter((c) => c.after !== 0).length
  const removed = changes.filter((c) => c.after === 0).length
  const colorCount = new Set(grid.cells.filter((c): c is string => c !== null && c !== undefined).map((c) => canonicalHex(c)!)).size
  return {
    ok: true,
    patch,
    placed,
    skipped,
    colors: colorCount,
    message: `已生成「图纸·${grid.cols}×${grid.rows}」：放置 ${placed} 格${removed > 0 ? `、清除 ${removed} 格` : ''}${skipped > 0 ? `，${skipped} 格超出坐标域已跳过` : ''}——一次撤销可整体回退`,
  }
}
