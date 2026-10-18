// 图纸 → 方块（Editor 级）：一次导入 = 一条补丁、一次撤销整体回退；
// 平面映射 / 厚度 / 空位 / 清空选项 / 非法输入（零写入）逐条钉住。
import { describe, expect, it } from 'vitest'
import { Editor } from '../../src/edit/editor'
import { applyPattern, patternCoord } from '../../src/edit/pattern-apply'
import { MemoryProjectStore } from '../../src/io/project-store'
import type { PatternGrid } from '../../src/io/pattern/types'

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  return editor
}

const gridOf = (rows: ReadonlyArray<ReadonlyArray<string | null>>): PatternGrid => ({
  cols: rows[0]?.length ?? 0,
  rows: rows.length,
  cells: rows.flat(),
})

const blockColor = (editor: Editor, x: number, y: number, z: number): string | null => {
  const key = editor.volume.getBlock(x, y, z)
  if (key === 0) return null
  return editor.volume.palette.get(key)?.color ?? null
}

describe('EDIT-P1 · xz 地面平铺', () => {
  it('2×2 图纸一次写入：4 块、恰 1 条补丁、坐标与颜色逐格正确、一次撤销全退', () => {
    const editor = makeEditor()
    const result = applyPattern(editor, {
      grid: gridOf([
        ['#c0392b', '#3b6ea5'],
        ['#e8c547', '#2e8b57'],
      ]),
      plane: 'xz',
      origin: { x: 0, y: 0, z: 0 },
    })
    expect(result.ok).toBe(true)
    expect(editor.volume.nonEmptyCount).toBe(4)
    expect(editor.log.patches).toHaveLength(1)
    expect(editor.log.patches[0]!.label).toContain('图纸')
    expect(blockColor(editor, 0, 0, 0)).toBe('#c0392b')
    expect(blockColor(editor, 1, 0, 0)).toBe('#3b6ea5')
    expect(blockColor(editor, 0, 0, 1)).toBe('#e8c547')
    expect(blockColor(editor, 1, 0, 1)).toBe('#2e8b57')
    editor.undo()
    expect(editor.volume.nonEmptyCount).toBe(0)
    expect(editor.log.patches).toHaveLength(0)
  })

  it('起点平移：所有格子跟随原点', () => {
    const editor = makeEditor()
    applyPattern(editor, { grid: gridOf([['#c0392b']]), plane: 'xz', origin: { x: 5, y: 3, z: -2 } })
    expect(blockColor(editor, 5, 3, -2)).toBe('#c0392b')
  })
})

describe('EDIT-P2 · xy 竖直墙面与厚度', () => {
  it('墙面：图纸首行在最上面（y 反向），x 仍向右', () => {
    const editor = makeEditor()
    applyPattern(editor, {
      grid: gridOf([
        ['#c0392b', '#2e8b57'],
        ['#3b6ea5', '#e8c547'],
      ]),
      plane: 'xy',
      origin: { x: 0, y: 0, z: 0 },
    })
    // 首行在 y=1：左红右绿
    expect(blockColor(editor, 0, 1, 0)).toBe('#c0392b')
    expect(blockColor(editor, 1, 1, 0)).toBe('#2e8b57')
    expect(blockColor(editor, 0, 0, 0)).toBe('#3b6ea5')
    expect(blockColor(editor, 1, 0, 0)).toBe('#e8c547')
  })

  it('厚度 = 沿法线复制（xz ⇒ +y；xy ⇒ +z），一次仍是一条补丁', () => {
    const floor = makeEditor()
    applyPattern(floor, { grid: gridOf([['#c0392b', '#3b6ea5']]), plane: 'xz', origin: { x: 0, y: 0, z: 0 }, thickness: 2 })
    expect(floor.volume.nonEmptyCount).toBe(4)
    expect(blockColor(floor, 0, 1, 0)).toBe('#c0392b')
    expect(floor.log.patches).toHaveLength(1)

    const wall = makeEditor()
    applyPattern(wall, { grid: gridOf([['#c0392b']]), plane: 'xy', origin: { x: 0, y: 0, z: 0 }, thickness: 3 })
    expect(wall.volume.nonEmptyCount).toBe(3)
    expect(blockColor(wall, 0, 0, 2)).toBe('#c0392b')
  })

  it('patternCoord 是唯一坐标口径（与实测位置同源）', () => {
    expect(patternCoord({ plane: 'xz', origin: { x: 1, y: 2, z: 3 }, cols: 2, rows: 2, col: 1, row: 0, layer: 4 })).toEqual({ x: 2, y: 6, z: 3 })
    expect(patternCoord({ plane: 'xy', origin: { x: 1, y: 2, z: 3 }, cols: 2, rows: 2, col: 0, row: 0, layer: 1 })).toEqual({ x: 1, y: 3, z: 4 })
  })
})

describe('EDIT-P3 · 空位与清空选项', () => {
  it('空格默认不动已有块（图纸里的空白不是"要求擦除"）', () => {
    const editor = makeEditor()
    editor.place(0, 0, 0) // 先手放一块
    const before = editor.volume.nonEmptyCount
    const result = applyPattern(editor, { grid: gridOf([[null, '#c0392b']]), plane: 'xz', origin: { x: 0, y: 0, z: 0 } })
    expect(result.ok).toBe(true)
    expect(editor.volume.nonEmptyCount).toBe(before + 1)
    expect(blockColor(editor, 0, 0, 0)).not.toBeNull()
  })

  it('clearEmpty 勾选后空格清除目标区域（仍是一条补丁）', () => {
    const editor = makeEditor()
    editor.place(0, 0, 0)
    const result = applyPattern(editor, {
      grid: gridOf([[null, '#c0392b']]),
      plane: 'xz',
      origin: { x: 0, y: 0, z: 0 },
      clearEmpty: true,
    })
    expect(result.ok).toBe(true)
    expect(editor.volume.getBlock(0, 0, 0)).toBe(0)
    expect(blockColor(editor, 1, 0, 0)).toBe('#c0392b')
    editor.undo()
    expect(editor.volume.getBlock(0, 0, 0)).not.toBe(0) // 撤销恢复被清掉的块
  })
})

describe('EDIT-P4 · 非法输入 = 零写入零记账', () => {
  it('颜色非法 ⇒ 拒绝且模型 / 历史 / 色板全不动', () => {
    const editor = makeEditor()
    const result = applyPattern(editor, { grid: { cols: 1, rows: 1, cells: ['not-a-color'] }, plane: 'xz', origin: { x: 0, y: 0, z: 0 } })
    expect(result.ok).toBe(false)
    expect(editor.volume.nonEmptyCount).toBe(0)
    expect(editor.log.patches).toHaveLength(0)
  })

  it('数据长度与行列不一致 / 超上限 / 厚度越界 ⇒ 拒绝', () => {
    const editor = makeEditor()
    expect(applyPattern(editor, { grid: { cols: 2, rows: 2, cells: ['#c0392b'] }, plane: 'xz', origin: { x: 0, y: 0, z: 0 } }).ok).toBe(false)
    expect(applyPattern(editor, { grid: { cols: 200, rows: 2, cells: [] }, plane: 'xz', origin: { x: 0, y: 0, z: 0 } }).ok).toBe(false)
    expect(applyPattern(editor, { grid: gridOf([['#c0392b']]), plane: 'xz', origin: { x: 0, y: 0, z: 0 }, thickness: 99 }).ok).toBe(false)
    expect(editor.volume.nonEmptyCount).toBe(0)
    expect(editor.log.patches).toHaveLength(0)
  })

  it('起点越出坐标域 ⇒ 全部跳过，不记账（不写半个模型）', () => {
    const editor = makeEditor()
    const result = applyPattern(editor, { grid: gridOf([['#c0392b', '#3b6ea5']]), plane: 'xz', origin: { x: 5000, y: 0, z: 0 } })
    expect(result.ok).toBe(false)
    expect(editor.volume.nonEmptyCount).toBe(0)
    expect(editor.log.patches).toHaveLength(0)
  })

  it('目标区域已是同样颜色 ⇒ 零变化不记账（幂等）', () => {
    const editor = makeEditor()
    const g = gridOf([['#c0392b']])
    expect(applyPattern(editor, { grid: g, plane: 'xz', origin: { x: 0, y: 0, z: 0 } }).ok).toBe(true)
    expect(editor.log.patches).toHaveLength(1)
    const again = applyPattern(editor, { grid: g, plane: 'xz', origin: { x: 0, y: 0, z: 0 } })
    expect(again.ok).toBe(false)
    expect(editor.log.patches).toHaveLength(1)
  })
})

describe('EDIT-P5 · 归属（与手工放置同一条规则）', () => {
  it('选中构件 ⇒ 新块归该构件；撤销后归属还原', () => {
    const editor = makeEditor()
    editor.newPart()
    const part = editor.parts.list().find((p) => p.blocks.size === 0 && p.name !== '坯料')
    expect(part).toBeDefined()
    editor.selectPart(part!.id)
    applyPattern(editor, { grid: gridOf([['#c0392b', '#3b6ea5']]), plane: 'xz', origin: { x: 0, y: 0, z: 0 } })
    expect(editor.parts.partIdOf(0, 0, 0)).toBe(part!.id)
    editor.undo()
    expect(editor.parts.partIdOf(0, 0, 0) ?? null).toBeNull()
  })
})