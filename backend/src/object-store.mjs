import { LocalObjectStore } from './local-object-store.mjs'
import { CosObjectStore } from './cos-object-store.mjs'

const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])

export function createRuntimeObjectStore(options = {}) {
  const environment = options.environment || 'dev'
  const allowUnsafeLocalStore = options.allowUnsafeLocalStore || process.env.GOODS_COMM_ALLOW_LOCAL_OBJECT_STORE_IN_PROTECTED_ENV === 'true'

  if (options.objectStore) {
    if (PROTECTED_ENVIRONMENTS.has(environment) && !options.objectStore.productionSafe && !allowUnsafeLocalStore) {
      throw new Error(`${environment} 环境不能使用未声明 productionSafe 的对象存储`)
    }

    return {
      store: options.objectStore,
      type: options.objectStore.type || options.objectStoreType || 'custom'
    }
  }

  const objectStoreType = normalizeObjectStoreType(options.objectStoreType || process.env.GOODS_COMM_OBJECT_STORE || defaultObjectStoreType(environment))

  if (PROTECTED_ENVIRONMENTS.has(environment) && objectStoreType === 'local' && !allowUnsafeLocalStore) {
    throw new Error(`${environment} 环境不能使用本地对象存储，请配置 GOODS_COMM_OBJECT_STORE=cos`)
  }

  if (objectStoreType === 'cos') {
    return {
      store: new CosObjectStore(options),
      type: 'cos'
    }
  }

  return {
    store: new LocalObjectStore({
      rootDir: options.objectRootDir,
      publicBaseUrl: options.publicAssetBaseUrl,
      maxImageBytes: options.maxImageBytes
    }),
    type: 'local'
  }
}

export function normalizeObjectStoreType(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (['local', 'cos'].includes(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_OBJECT_STORE 只能是 local/cos，当前为 ${value || '空'}`)
}

function defaultObjectStoreType(environment) {
  return PROTECTED_ENVIRONMENTS.has(environment) ? 'cos' : 'local'
}
