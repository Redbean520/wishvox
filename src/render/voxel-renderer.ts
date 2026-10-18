// r04 T6（G5）：实例化渲染**画核**——只管画：场景 / 灯 / 材质、chunk 增量重建（ChunkLayer）、
// 外观与高亮、虚方块预览、帧循环与统计。相机（CameraRig）、网格引导（GridGuides）、拾取（pick）
// 已拆 interaction/——组合与公共转发面 = interaction/view.ts 的 VoxelView（harness/Viewport 用它）。
// 实例化渲染（REQ-024）每 chunk 一个 InstancedMesh；外观切换只重设 instanceColor（N2）。
import * as THREE from 'three'
import type { LayerFilter } from '../core/brush/predicate'
import type { Coord, VoxelChange } from '../core/types'
import type { PartRegistry } from '../core/parts'
import type { Volume } from '../core/volume'
import { ChunkLayer } from './chunks'
import type { Appearance } from './appearance'

const PREVIEW_CAPACITY = 512 // 笔刷预览上限 = BRUSH_MAX_CELLS（单笔体积上限，brush/types.ts）
// REQ-063（r05 件三）预览填充色：**笔刷语义色**（关键 = 锚点格 / 附属 = 其余）——
// 不得与 UI 四态 token（--ok/--warn/--err/--mute）混用，也不承载"错 / 忙"之义（规格明文）。
const PREVIEW_FILL_SECONDARY = 0x6fbf73 // 附属块：绿（沿用改动前的单一填充色）@ opacity 0.32
const PREVIEW_FILL_KEY = 0xd9534f // 关键块：半透明红（建议值）@ opacity 0.45

export interface VoxelRendererStats {
  /** 增量路径对账卸载的 chunk 数（T15：改动后不再驻留 ⇒ mesh 必须离开场景，防幽灵块） */
  unloadedChunks: number
  residentChunks: number
  instanceCount: number
  /** 层次过滤后仍在实例缓冲里的块数（V3：与按层计数纯函数对拍） */
  visibleInstanceCount: number
  drawCalls: number
  nanCount: number
  emptyFrames: number
  highlightedCount: number
  /** 网格对象数（V4：0 = 关；y=0 与 y=当前层各 1）——由 VoxelView 填（grids 在 interaction 层） */
  gridCount: number
  /** 笔刷预览格子数（V6 读回） */
  previewCount: number
}

/** 画核（相机经 attachCamera 注入——拥有权在 interaction/CameraRig，本层不 import OrbitControls） */
export class VoxelRenderer {
  readonly scene = new THREE.Scene()
  readonly renderer: THREE.WebGLRenderer
  readonly chunks: ChunkLayer

  /** 帧循环钩子（VoxelView 挂 rig.updateControls——阻尼步进先于渲染，与拆分前同序） */
  onFrame: (() => void) | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly material = new THREE.MeshLambertMaterial({ color: 0xffffff })
  private rafId: number | null = null
  private disposed = false
  private emptyFrames = 0
  private lastDrawCalls = 0

  // 笔刷预览（F7）：半透明格 + 边框。`REQ-063`（r05 件三）分两组——
  // 附属块 = 绿（0x6fbf73 @ 0.32，沿用原填充色）· 关键块 = 半透明红（0xd9534f @ 0.45，锚点格 ≤1）。
  private readonly previewMesh: THREE.InstancedMesh
  private readonly previewEdges: THREE.LineSegments
  private readonly keyMesh: THREE.InstancedMesh
  private previewCells: readonly Coord[] = []
  private previewKeyCells: readonly Coord[] = []
  private readonly tmpMatrix = new THREE.Matrix4()

  constructor(
    private readonly container: HTMLElement,
    private readonly volume: Volume,
    parts: PartRegistry | null,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(1) // 采集口径：渲染 DPR 锁 1（harness 记录设备 DPR）
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.display = 'block'
    this.container.appendChild(this.renderer.domElement)

    // r07 UI 重构：视口底色并入深色主题（原来 T17 的白底与深色外壳反差过大）
    this.scene.background = new THREE.Color(0x0b0d10)
    const hemi = new THREE.HemisphereLight(0xdce6f5, 0x151b24, 1.15)
    const dir = new THREE.DirectionalLight(0xffffff, 1.5)
    dir.position.set(40, 80, 30)
    this.scene.add(hemi, dir) // T17：去地面网格（GridHelper 归 interaction/grids）

    this.chunks = new ChunkLayer(this.scene, volume, parts, this.geometry, this.material)

    // 预览格（半透明 + 边框线）：材质三份（附属填充 / 关键填充 / 线框）
    const previewFill = new THREE.MeshBasicMaterial({ color: PREVIEW_FILL_SECONDARY, transparent: true, opacity: 0.32, depthWrite: false })
    this.previewMesh = new THREE.InstancedMesh(this.geometry, previewFill, PREVIEW_CAPACITY)
    this.previewMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.previewMesh.count = 0
    this.previewMesh.frustumCulled = false
    this.previewMesh.visible = false
    this.previewMesh.position.set(0.5, 0.5, 0.5) // 实例矩阵 = 整格坐标 ⇒ +0.5 格心偏移由组位承担
    this.scene.add(this.previewMesh)
    const keyFill = new THREE.MeshBasicMaterial({ color: PREVIEW_FILL_KEY, transparent: true, opacity: 0.45, depthWrite: false })
    this.keyMesh = new THREE.InstancedMesh(this.geometry, keyFill, PREVIEW_CAPACITY)
    this.keyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.keyMesh.count = 0
    this.keyMesh.frustumCulled = false
    this.keyMesh.visible = false
    this.keyMesh.position.set(0.5, 0.5, 0.5)
    this.scene.add(this.keyMesh)
    const previewLine = new THREE.LineBasicMaterial({ color: 0x2f6b36, transparent: true, opacity: 0.9 })
    this.previewEdges = new THREE.LineSegments(new THREE.BufferGeometry(), previewLine)
    this.previewEdges.frustumCulled = false
    this.previewEdges.visible = false
    this.scene.add(this.previewEdges)
  }

  attachCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera
  }

  // ── 外观与高亮（不触碰实例矩阵 ⇒ 不计入重建集合）──

  setAppearance(app: Appearance): void {
    this.chunks.setAppearance(app)
  }

  setHighlightedPart(partId: string | null): void {
    this.chunks.setHighlightedPart(partId)
  }

  /** r02：组合高亮（REQ-051 ②）——坐标键集合，只影响 instanceColor。 */
  setHighlightedCoords(coordKeys: ReadonlySet<string> | null): void {
    this.chunks.setHighlightedCoords(coordKeys)
  }

  // ── 增量重建（REQ-025 / I9）──

  applyChanges(changes: readonly VoxelChange[]): void {
    this.chunks.applyChanges(changes)
  }

  /** 全量重建（初始化 / 导入 / 回退后）——同样计入 buildSeq 快照（与增量路径共用集合等式读回） */
  rebuildAll(): void {
    this.chunks.rebuildAll()
  }

  /** F3：层次过滤（below = minY..y；single = 只 y 层）。视图驱动重建（同由 buildSeq 快照读回）。 */
  setLayerFilter(filter: LayerFilter | null): void {
    this.chunks.setFilter(filter)
  }

  /** F3 读回面（debug-261007）：当前实际持有的层次过滤 */
  layerFilterReadback(): LayerFilter | null {
    return this.chunks.filter
  }

  buildSeqSnapshot(): Map<string, number> {
    return this.chunks.buildSeqSnapshot()
  }

  // ── 笔刷预览（F7）──

  /** F7：虚方块预览（半透明格 + 边框）；cells 为空 ⇒ 隐藏（Q7：隐藏层无预览）。
   *  `REQ-063`（r05 件三）：`keyCells` = **关键块**（锚点格，≤1）画半透明红；`cells` 其余画绿色。
   *  两组共用一套边框（每格 12 棱 + 整体外框）⇒ 关键块的边框与附属同色（描边仍 `0x2f6b36`）。 */
  setPreview(cells: readonly Coord[] | null, keyCells: readonly Coord[] | null = null): void {
    const list = cells ?? []
    if (list.length === 0) {
      this.previewMesh.visible = false
      this.previewEdges.visible = false
      this.keyMesh.visible = false
      this.previewCells = []
      this.previewKeyCells = []
      return
    }
    const n = Math.min(list.length, PREVIEW_CAPACITY)
    for (let i = 0; i < n; i++) {
      const c = list[i]!
      this.tmpMatrix.makeTranslation(c.x, c.y, c.z)
      this.previewMesh.setMatrixAt(i, this.tmpMatrix)
    }
    this.previewMesh.count = n
    this.previewMesh.instanceMatrix.needsUpdate = true
    this.previewMesh.computeBoundingSphere()
    this.previewMesh.visible = true
    // 关键块（锚点格）：独立实例网格 —— 与附属同格心、红/绿两组都画 ⇒ 关键块上红一层可见
    const key = (keyCells ?? []).slice(0, PREVIEW_CAPACITY)
    for (let i = 0; i < key.length; i++) {
      const c = key[i]!
      this.tmpMatrix.makeTranslation(c.x, c.y, c.z)
      this.keyMesh.setMatrixAt(i, this.tmpMatrix)
    }
    this.keyMesh.count = key.length
    this.keyMesh.instanceMatrix.needsUpdate = true
    if (key.length > 0) this.keyMesh.computeBoundingSphere()
    this.keyMesh.visible = key.length > 0
    // 边框：每格 12 条棱（虚方块感）+ 整个笔刷体积的外框
    const positions: number[] = []
    const edge = (a: number[], b: number[]): void => {
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
    for (let i = 0; i < n; i++) {
      const c = list[i]!
      const x0 = c.x
      const y0 = c.y
      const z0 = c.z
      const x1 = x0 + 1
      const y1 = y0 + 1
      const z1 = z0 + 1
      edge([x0, y0, z0], [x1, y0, z0])
      edge([x1, y0, z0], [x1, y0, z1])
      edge([x1, y0, z1], [x0, y0, z1])
      edge([x0, y0, z1], [x0, y0, z0])
      edge([x0, y1, z0], [x1, y1, z0])
      edge([x1, y1, z0], [x1, y1, z1])
      edge([x1, y1, z1], [x0, y1, z1])
      edge([x0, y1, z1], [x0, y1, z0])
      edge([x0, y0, z0], [x0, y1, z0])
      edge([x1, y0, z0], [x1, y1, z0])
      edge([x1, y0, z1], [x1, y1, z1])
      edge([x0, y0, z1], [x0, y1, z1])
    }
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const c of list) {
      minX = Math.min(minX, c.x)
      minY = Math.min(minY, c.y)
      minZ = Math.min(minZ, c.z)
      maxX = Math.max(maxX, c.x + 1)
      maxY = Math.max(maxY, c.y + 1)
      maxZ = Math.max(maxZ, c.z + 1)
    }
    edge([minX, minY, minZ], [maxX, minY, minZ])
    edge([maxX, minY, minZ], [maxX, minY, maxZ])
    edge([maxX, minY, maxZ], [minX, minY, maxZ])
    edge([minX, minY, maxZ], [minX, minY, minZ])
    edge([minX, maxY, minZ], [maxX, maxY, minZ])
    edge([maxX, maxY, minZ], [maxX, maxY, maxZ])
    edge([maxX, maxY, maxZ], [minX, maxY, maxZ])
    edge([minX, maxY, maxZ], [minX, maxY, minZ])
    edge([minX, minY, minZ], [minX, maxY, minZ])
    edge([maxX, minY, minZ], [maxX, maxY, minZ])
    edge([maxX, minY, maxZ], [maxX, maxY, maxZ])
    edge([minX, minY, maxZ], [minX, maxY, maxZ])
    this.previewEdges.geometry.dispose()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.previewEdges.geometry = geo
    this.previewEdges.visible = true
    this.previewCells = list
    this.previewKeyCells = key
  }

  /** V6 读回：当前预览集合（harness 与 brushVolume 纯函数对拍） */
  getPreviewCells(): readonly Coord[] {
    return this.previewCells
  }

  /** `REQ-063` 读回（r05 件三）：当前**关键块**格集合（≤1；空 = 无关键色 / 无预览） */
  getPreviewKeyCells(): readonly Coord[] {
    return this.previewKeyCells
  }

  /** `REQ-063` 读回（harness）：两组预览网格的实例数（附属 / 关键）——"关键那格独立成一份材质"的读回面 */
  previewMeshCounts(): { secondary: number; key: number } {
    return {
      secondary: this.previewMesh.visible ? this.previewMesh.count : 0,
      key: this.keyMesh.visible ? this.keyMesh.count : 0,
    }
  }

  // ── 循环与统计 ──

  start(): void {
    const tick = (): void => {
      if (this.disposed) return
      if (typeof document !== 'undefined' && document.hidden) {
        this.emptyFrames += 1 // 可见性空洞帧单独计（I9"无空帧"的读回量；fps 统计同时排除）
      } else if (this.camera) {
        this.onFrame?.()
        this.renderer.render(this.scene, this.camera)
        this.lastDrawCalls = this.renderer.info.render.calls
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.renderer.setSize(cssWidth, cssHeight, false)
    if (this.camera) {
      this.camera.aspect = cssWidth / cssHeight
      this.camera.updateProjectionMatrix()
    }
  }

  /** 读回面：I9 的"重建了哪些 chunk"由 ChunkLayer.buildSeqSnapshot 的集合等式读出。
   *  原 `rebuiltChunks` 计数已删（r04 T7 / §3.1 #13：写、复位、透出三处零读者，REQ-025 的
   *  验证载体是集合等式）——其余字段语义不变。 */
  stats(): VoxelRendererStats {
    return {
      unloadedChunks: this.chunks.unloadedChunkCount,
      residentChunks: this.chunks.residentCount,
      instanceCount: this.volume.nonEmptyCount,
      visibleInstanceCount: this.chunks.visibleInstanceCount,
      drawCalls: this.lastDrawCalls,
      nanCount: this.chunks.countNaN(),
      emptyFrames: this.emptyFrames,
      highlightedCount: this.chunks.highlightedCellCount,
      gridCount: 0, // 由 VoxelView 填（grids 在 interaction 层）
      previewCount: this.previewMesh.visible ? this.previewCells.length : 0,
    }
  }

  get devicePixelRatio(): number {
    return typeof window === 'undefined' ? 1 : window.devicePixelRatio
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.chunks.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.previewMesh.dispose() // 预览两组（含 REQ-063 的关键块层）与线框一并释放
    this.keyMesh.dispose()
    this.previewEdges.geometry.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}