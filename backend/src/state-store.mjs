import { resolve } from 'node:path'
import { FileStateStore } from './file-state-store.mjs'
import { PostgresStateStore } from './postgres-state-store.mjs'

const DEFAULT_STATE_PATH = resolve(process.cwd(), '.data/goods-comm-state.json')
const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])

export function createRuntimeStateStore(options = {}) {
  const environment = options.environment || 'dev'
  const allowUnsafeFileStore = options.allowUnsafeFileStore || process.env.GOODS_COMM_ALLOW_FILE_STORE_IN_PROTECTED_ENV === 'true'

  if (options.store) {
    if (PROTECTED_ENVIRONMENTS.has(environment) && !options.store.productionSafe && !allowUnsafeFileStore) {
      throw new Error(`${environment} 环境不能使用未声明 productionSafe 的自定义状态存储`)
    }

    return {
      store: options.store,
      type: options.storeType || 'custom'
    }
  }

  const storeType = normalizeStoreType(options.storeType || process.env.GOODS_COMM_STATE_STORE || defaultStoreType(environment))

  if (PROTECTED_ENVIRONMENTS.has(environment) && storeType === 'file' && !allowUnsafeFileStore) {
    throw new Error(`${environment} 环境不能使用文件状态存储，请配置 GOODS_COMM_STATE_STORE=postgres 和 GOODS_COMM_DATABASE_URL`)
  }

  if (storeType === 'postgres') {
    const seedItems = options.seedItems ?? (PROTECTED_ENVIRONMENTS.has(environment) ? [] : undefined)

    return {
      store: new PostgresStateStore(options.databaseUrl || process.env.GOODS_COMM_DATABASE_URL, {
        environment,
        seedItems,
        maxSnapshotRows: options.maxSnapshotRows,
        autoSchema: options.autoSchema,
        allowUnsafeAutoSchema: options.allowUnsafeAutoSchema
      }),
      type: 'postgres'
    }
  }

  return {
    store: new FileStateStore(options.statePath || process.env.GOODS_COMM_STATE_PATH || DEFAULT_STATE_PATH, {
      seedItems: options.seedItems
    }),
    type: 'file'
  }
}

export function normalizeStoreType(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (['file', 'postgres'].includes(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_STATE_STORE 只能是 file/postgres，当前为 ${value || '空'}`)
}

function defaultStoreType(environment) {
  return PROTECTED_ENVIRONMENTS.has(environment) ? 'postgres' : 'file'
}
