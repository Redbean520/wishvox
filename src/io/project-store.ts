import type { ProjectFileV2 } from '../core/types'

// 存储抽象（plan §1.1：不引 fake-indexeddb——tests/ 用内存实现，浏览器用 IndexedDB）。
export interface ProjectStore {
  readonly kind: 'memory' | 'indexeddb'
  save(file: ProjectFileV2): Promise<void>
  load(): Promise<ProjectFileV2 | null>
  clear(): Promise<void>
}

/** 内存实现：L1 无头测试用；记录保存时间戳供 REQ-002 的"写入发起时间"断言 */
export class MemoryProjectStore implements ProjectStore {
  readonly kind = 'memory' as const
  readonly saveTimestamps: number[] = []
  private file: ProjectFileV2 | null = null

  async save(file: ProjectFileV2): Promise<void> {
    this.saveTimestamps.push(Date.now())
    this.file = file
  }

  async load(): Promise<ProjectFileV2 | null> {
    return this.file
  }

  async clear(): Promise<void> {
    this.file = null
    this.saveTimestamps.length = 0
  }
}

/** 浏览器实现：单库单 store；save = 一个事务写整条项目记录（模型 + 日志 + 快照） */
export class IdbProjectStore implements ProjectStore {
  readonly kind = 'indexeddb' as const
  // 2026-10-17 品牌改名：库名直改、不做迁移（旧库孤儿化，公开新仓无存量用户）。
  private static readonly DB_NAME = 'wishvox'
  private static readonly STORE = 'projects'
  private static readonly KEY = 'current'

  private constructor(private readonly db: IDBDatabase) {}

  static supported(): boolean {
    return typeof indexedDB !== 'undefined'
  }

  static async open(): Promise<IdbProjectStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IdbProjectStore.DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IdbProjectStore.STORE)) {
          req.result.createObjectStore(IdbProjectStore.STORE)
        }
      }
      req.onsuccess = () => resolve(new IdbProjectStore(req.result))
      req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'))
      // 隐私模式 / 被占用时 open 可能一直不回调（浏览器不给 onerror）⇒ 明确拒绝，交给内存兜底
      req.onblocked = () => reject(new Error('indexeddb open blocked'))
    })
  }

  async save(file: ProjectFileV2): Promise<void> {
    await this.run('readwrite', (store) => store.put(file, IdbProjectStore.KEY))
  }

  async load(): Promise<ProjectFileV2 | null> {
    const result = await this.run<ProjectFileV2 | undefined>('readonly', (store) =>
      store.get(IdbProjectStore.KEY),
    )
    return result ?? null
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.delete(IdbProjectStore.KEY))
  }

  private run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(IdbProjectStore.STORE, mode)
      const req = action(tx.objectStore(IdbProjectStore.STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('indexeddb request failed'))
    })
  }
}

/** IndexedDB 打开的超时（ms）：超时/被阻断 ⇒ 退回内存存储，页面照常可用（不白屏） */
export const IDB_OPEN_TIMEOUT_MS = 1500

/** 浏览器存储：IDB 可用且能在超时内打开 ⇒ IDB；否则退回内存（本轮会话不持久化，但不阻塞 UI）。 */
export async function createProjectStore(timeoutMs: number = IDB_OPEN_TIMEOUT_MS): Promise<ProjectStore> {
  if (!IdbProjectStore.supported()) return new MemoryProjectStore()
  try {
    return await Promise.race([
      IdbProjectStore.open(),
      new Promise<ProjectStore>((resolve) => setTimeout(() => resolve(new MemoryProjectStore()), timeoutMs)),
    ])
  } catch {
    return new MemoryProjectStore()
  }
}