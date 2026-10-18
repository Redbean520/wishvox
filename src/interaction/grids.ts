// r04 T6（G3）：网格与包围盒引导——自 render/voxel-renderer.ts 拆出（视图叠加编排 = 交互关注点）。
// gridPlacement 纯函数（tests/grid-placement.test 对拍"线在整数边界"）；GridGuides 持 GridHelper
// 与包围盒 LineSegments（场景对象由构造注入）。
import * as THREE from 'three'
import type { ModelBounds } from '../core/model-info'

/** F4 网格放置参数（GridGuides 的接缝，纯函数——tests 对拍"线在整数边界"用） */
interface GridPlacement {
  /** 网格中心（世界坐标）：GridHelper 的线落在 center ± k·cell ⇒ 线位对 1 取模 = center 对 1 取模 */
  centerX: number
  centerZ: number
  size: number
  divisions: number
}

export function gridPlacement(bounds: ModelBounds | null): GridPlacement {
  const size = Math.max(16, Math.ceil(Math.max(bounds?.w ?? 8, bounds?.l ?? 8) / 4) * 4 + 8)
  return {
    // D2（2026-10-04）：中心取整——AABB 几何中心可为半整数（如 0..10 ⇒ 5.5），不取整则线落在方块中心。
    // size 恒为 4 的倍数（= 偶数）⇒ 四角 center ± size/2 也落在整数；尺寸含 +8 余量 ⇒ 取整后仍罩住 AABB。
    centerX: bounds ? Math.round((bounds.minX + bounds.maxX + 1) / 2) : 0,
    centerZ: bounds ? Math.round((bounds.minZ + bounds.maxZ + 1) / 2) : 0,
    size,
    divisions: size,
  }
}

/**
 * 网格（F4：y=0 参考网格 / **独立工作网格** `y=workY`，默认全关，与 REQ-048"白底无水平网格"并存）
 * 与包围盒引导（F2：底面 + xyz 三轴）。挂在 scene 上，尺寸/落点跟随模型包围盒。
 */
export class GridGuides {
  private gridBase: THREE.GridHelper | null = null
  private gridLayer: THREE.GridHelper | null = null
  private gridWanted = { base: false, layer: false }
  /** `D3`（2026-10-16）：参考网格的**独立**生效高度（默认 0）；轻刷新（`refreshBoundsGuide`）沿用它 */
  private refY = 0
  private gridSize = 0
  private boundsGuide: THREE.LineSegments | null = null

  constructor(private readonly scene: THREE.Scene) {}

  /** F4：两个网格开关 + **独立工作网格高度**（`REQ-048`：与过滤层无关的整数 y）。
   *  `D3`：`refY` = 参考网格自己的高度（缺省沿用上次值）——参考网格仍是只读平面。 */
  setWanted(wanted: { base: boolean; layer: boolean; refY?: number }, bounds: ModelBounds | null, workY: number): void {
    if (wanted.refY !== undefined) this.refY = wanted.refY
    this.gridWanted = { base: wanted.base, layer: wanted.layer }
    this.updateGrids(bounds, workY)
  }

  /** 网格对象数（V4：0 = 关；y=0 与 y=当前层各 1） */
  count(): number {
    return (this.gridBase ? 1 : 0) + (this.gridLayer ? 1 : 0)
  }

  /** F2：包围盒引导 = 底面矩形 + xyz 三轴（右手系：x 红 / y 绿 / z 蓝；底面中性灰）；连带刷新网格落点 */
  refreshBoundsGuide(bounds: ModelBounds | null, workY: number | null): void {
    if (this.boundsGuide) {
      this.scene.remove(this.boundsGuide)
      this.boundsGuide.geometry.dispose()
      this.boundsGuide = null
    }
    if (!bounds) {
      this.updateGrids(bounds, workY)
      return
    }
    const { minX, minY, minZ, maxX, maxZ } = bounds
    const x1 = maxX + 1
    const y1 = minY
    const z1 = maxZ + 1
    const p = (x: number, y: number, z: number): number[] => [x, y, z]
    // 底面矩形（在最低块层的底面上）
    const gray = 0x8a929c
    const axisLen = Math.max(bounds.w, bounds.h, bounds.l) + 2
    const verts: Array<{ a: number[]; b: number[]; color: number }> = [
      { a: p(minX, y1, minZ), b: p(x1, y1, minZ), color: gray },
      { a: p(x1, y1, minZ), b: p(x1, y1, z1), color: gray },
      { a: p(x1, y1, z1), b: p(minX, y1, z1), color: gray },
      { a: p(minX, y1, z1), b: p(minX, y1, minZ), color: gray },
      // 三轴：x 红 / y 绿 / z 蓝，从最小角向外
      { a: p(minX, y1, minZ), b: p(minX + axisLen, y1, minZ), color: 0xc0392b },
      { a: p(minX, y1, minZ), b: p(minX, y1 + axisLen, minZ), color: 0x2e8b57 },
      { a: p(minX, y1, minZ), b: p(minX, y1, minZ + axisLen), color: 0x3b6ea5 },
    ]
    const positions: number[] = []
    const colors: number[] = []
    for (const seg of verts) {
      positions.push(...seg.a, ...seg.b)
      const c = new THREE.Color(seg.color)
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
    this.scene.add(lines)
    this.boundsGuide = lines
    this.updateGrids(bounds, workY) // 网格的尺寸/落点跟随模型包围盒；高度仍是独立工作 y
  }

  /** 网格尺寸/落点同步（不重建包围盒引导）——模型/工作 y 变化时的轻刷新（VoxelView 用）。
   *  `REQ-048`：工作网格高度由调用方显式给（缺省回落到模型最低层，空模型 = 0），**不跟随过滤层**。 */
  updateGrids(bounds: ModelBounds | null, workY: number | null): void {
    const { centerX, centerZ, size, divisions } = gridPlacement(bounds)
    const stale = this.gridSize !== size
    const sync = (current: THREE.GridHelper | null, want: boolean, y: number): THREE.GridHelper | null => {
      if (!want || stale) {
        if (current) {
          this.scene.remove(current)
          current.dispose()
        }
        if (!want) return null
      }
      const grid = current && !stale ? current : new THREE.GridHelper(size, divisions, 0x3f4a5a, 0x2a323d)
      if (!current || stale) this.scene.add(grid)
      grid.position.set(centerX, y, centerZ)
      return grid
    }
    // `D3`：参考网格高度 = 它自己的独立值（`this.refY`，不再硬编码 y=0）；工作网格 = 调用方给的 workY。
    this.gridBase = sync(this.gridBase, this.gridWanted.base, this.refY)
    const workGridY = workY ?? bounds?.minY ?? 0
    this.gridLayer = sync(this.gridLayer, this.gridWanted.layer, workGridY)
    this.gridSize = size
  }

  dispose(): void {
    for (const g of [this.gridBase, this.gridLayer]) {
      if (g) {
        this.scene.remove(g)
        g.dispose()
      }
    }
    this.gridBase = null
    this.gridLayer = null
    if (this.boundsGuide) {
      this.scene.remove(this.boundsGuide)
      this.boundsGuide.geometry.dispose()
      this.boundsGuide = null
    }
  }
}