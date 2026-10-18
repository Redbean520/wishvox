// r04 T6（G2）：相机族——自 render/voxel-renderer.ts 拆出（相机是交互关注点，REQ-049/058）。
// CameraRig 持 PerspectiveCamera + OrbitControls：取景/目标点/参数读写/交互模式/两档缩放监听。
// 层序：interaction 不 import render——画核只接 camera 实例（组合在 interaction/view.ts）。
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ModelBounds } from '../core/model-info'

/** F9 相机面板的读写面（会话态——不进项目文件） */
export interface CameraState {
  target: [number, number, number]
  distance: number
  fov: number
  rotateSpeed: number
  damping: number
}

export type InteractionMode = 'inspect' | 'edit'

// F1 两档缩放（拍板 E2/Q4）：滚轮 = 慢档（0.95^slow 每格），中键拖动 = 快档（拖距比值^fast）
const ZOOM_SLOW = 0.45
const ZOOM_FAST = 1.2

/**
 * 相机装配（r04 T6 从 VoxelRenderer 的相机族整体迁出）：
 * F1 目标点 = 非空块 AABB 中心（boundsOf 回调取）· Q4 拖动中冻结 / 松手更新 / 保持朝向与距离 ·
 * F5 双态鼠标面 · F9 参数读写 · onCameraChange 出口（Viewport 挂接 → 写 UI store）。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  /** 相机变化回调（F9 面板读数用；Viewport 挂接 → 写 UI store） */
  onCameraChange: ((s: CameraState) => void) | null = null
  private interacting = false // 相机拖动中：目标点冻结（Q4）
  private wheelTimer: number | null = null
  private mode: InteractionMode = 'inspect'
  private readonly homePosition = new THREE.Vector3(28, 26, 28)
  private readonly homeTarget = new THREE.Vector3(8, 4, 8)

  constructor(
    container: HTMLElement,
    canvas: HTMLElement,
    private readonly boundsOf: () => ModelBounds | null,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.minDistance = 2
    this.controls.maxDistance = 1500
    this.controls.rotateSpeed = 1.0
    this.controls.dampingFactor = 0.08
    this.controls.zoomSpeed = ZOOM_FAST
    this.applyInteractionMode()

    // F1：拖动中目标点冻结、松手后重算（Q4）；任何相机操作结束都回正到模型中心
    this.controls.addEventListener('start', () => {
      this.interacting = true
    })
    this.controls.addEventListener('end', () => {
      this.interacting = false
      this.retargetModel()
    })
    this.controls.addEventListener('change', () => this.notifyCameraChange())

    // F1 两档缩放：滚轮事件先于 OrbitControls 到达（容器捕获阶段）⇒ 临时调低 zoomSpeed；
    // 停滚 150ms 后恢复快档（中键拖动用）。AT_TARGET 阶段同元素监听不保证次序，所以挂在容器上。
    container.addEventListener(
      'wheel',
      () => {
        this.controls.zoomSpeed = ZOOM_SLOW
        if (this.wheelTimer !== null) window.clearTimeout(this.wheelTimer)
        this.wheelTimer = window.setTimeout(() => {
          this.controls.zoomSpeed = ZOOM_FAST
        }, 150)
      },
      true,
    )
    // 交互面重设计（r07）：中键 = 平移；Shift+左键 = 旋转、Alt+左键 = 平移（编辑态左键平时归笔刷）。
    // 捕获阶段先于 OrbitControls 的冒泡监听执行 ⇒ 能在同一次按下里覆写 mouseButtons。
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return
        if (this.mode === 'edit') {
          if (e.shiftKey) this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
          else if (e.altKey) this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN
        } else if (e.altKey) {
          this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN
        }
      },
      true,
    )
    const restoreButtons = (): void => this.applyInteractionMode()
    canvas.addEventListener('pointerup', restoreButtons)
    canvas.addEventListener('pointercancel', restoreButtons)
  }

  /** F1：对准模型 AABB 中心的初始机位（空模型回 home 位） */
  frameModel(): void {
    const bounds = this.boundsOf()
    if (!bounds) {
      this.camera.position.copy(this.homePosition)
      this.controls.target.copy(this.homeTarget)
      this.controls.update()
      this.notifyCameraChange()
      return
    }
    const center = new THREE.Vector3(bounds.centerX, bounds.centerY, bounds.centerZ)
    const size = Math.max(bounds.w, bounds.h, bounds.l, 4)
    const dist = size * 1.9
    this.camera.position.set(center.x + dist * 0.62, center.y + dist * 0.55, center.z + dist * 0.62)
    this.controls.target.copy(center)
    this.controls.update()
    this.notifyCameraChange()
  }

  /** 只平移目标点到模型 AABB 中心，朝向与距离原样保持（Q4：避免"转着转着目标跳走"） */
  retargetModel(): void {
    const bounds = this.boundsOf()
    if (!bounds) return
    const newTarget = new THREE.Vector3(bounds.centerX, bounds.centerY, bounds.centerZ)
    const delta = newTarget.clone().sub(this.controls.target)
    if (delta.lengthSq() === 0) return
    this.camera.position.add(delta)
    this.controls.target.copy(newTarget)
    this.controls.update()
    this.notifyCameraChange()
  }

  /** F1/F2：模型有方块更新后的入口——拖动相机期间冻结，松手后由 'end' 事件统一重算 */
  onModelChanged(): void {
    if (!this.interacting) this.retargetModel()
  }

  getCameraState(): CameraState {
    return {
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
      distance: this.camera.position.distanceTo(this.controls.target),
      fov: this.camera.fov,
      rotateSpeed: this.controls.rotateSpeed,
      damping: this.controls.dampingFactor,
    }
  }

  /** F9 面板写入（距离 = 沿视线移动相机；fov/速度/阻尼直写对应参数） */
  setCameraParams(p: Partial<Pick<CameraState, 'fov' | 'rotateSpeed' | 'damping' | 'distance'>>): void {
    if (p.fov !== undefined && p.fov > 10 && p.fov < 120) {
      this.camera.fov = p.fov
      this.camera.updateProjectionMatrix()
    }
    if (p.rotateSpeed !== undefined) this.controls.rotateSpeed = p.rotateSpeed
    if (p.damping !== undefined) this.controls.dampingFactor = p.damping
    if (p.distance !== undefined && p.distance >= this.controls.minDistance && p.distance <= this.controls.maxDistance) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize()
      this.camera.position.copy(this.controls.target).addScaledVector(dir, p.distance)
    }
    this.controls.update()
    this.notifyCameraChange()
  }

  private notifyCameraChange(): void {
    if (this.onCameraChange) this.onCameraChange(this.getCameraState())
  }

  /** 双态交互面（r07 重设计）：中键统一 = 平移（滚轮缩放）；检视 = 左转/右平移；编辑 = 左笔刷/右转（不允许右键手势的环境可用 Shift/Alt+左键） */
  setInteractionMode(mode: InteractionMode): void {
    this.mode = mode
    this.applyInteractionMode()
  }

  get interactionMode(): InteractionMode {
    return this.mode
  }

  private applyInteractionMode(): void {
    if (this.mode === 'edit') {
      // 编辑态左键归笔刷（Viewport 自己消费 pointer 事件）⇒ 相机层显式禁用（-1 = NONE）；
      // 中键改平移（原中键是 DOLLY，与滚轮重复）；右键旋转保留（已抑制右键菜单）。
      this.controls.mouseButtons = { LEFT: -1 as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    } else {
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
    }
  }

  /** 帧循环的阻尼步进（原 renderer tick 里的 controls.update()） */
  updateControls(): void {
    this.controls.update()
  }

  resizeAspect(cssWidth: number, cssHeight: number): void {
    this.camera.aspect = cssWidth / cssHeight
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    if (this.wheelTimer !== null) window.clearTimeout(this.wheelTimer)
    this.controls.dispose()
  }
}