import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const distRoot = resolve(root, 'dist/backend')
const artifactPackage = {
  name: 'goods-comm-backend-artifact',
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    start: 'node backend/src/server.mjs'
  },
  dependencies: {
    pg: '^8.21.0'
  },
  engines: {
    node: '>=20'
  }
}

await rm(distRoot, {
  recursive: true,
  force: true
})
await mkdir(distRoot, {
  recursive: true
})

await cp(resolve(root, 'backend'), resolve(distRoot, 'backend'), {
  recursive: true
})
await cp(resolve(root, 'src/bff'), resolve(distRoot, 'src/bff'), {
  recursive: true
})
await cp(resolve(root, 'src/config'), resolve(distRoot, 'src/config'), {
  recursive: true
})
await cp(resolve(root, 'src/data'), resolve(distRoot, 'src/data'), {
  recursive: true
})
await cp(resolve(root, 'src/domain'), resolve(distRoot, 'src/domain'), {
  recursive: true
})
await cp(resolve(root, 'src/services'), resolve(distRoot, 'src/services'), {
  recursive: true
})
await cp(resolve(root, 'src/utils'), resolve(distRoot, 'src/utils'), {
  recursive: true
})

await writeFile(resolve(distRoot, 'package.json'), JSON.stringify(artifactPackage, null, 2))
await writeFile(resolve(distRoot, 'package-lock.json'), JSON.stringify(await buildBackendPackageLock(), null, 2))

console.log(`Backend artifact built at ${distRoot}`)

async function buildBackendPackageLock() {
  const rootPackageLock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
  const packages = {
    '': {
      name: artifactPackage.name,
      version: artifactPackage.version,
      dependencies: artifactPackage.dependencies,
      engines: artifactPackage.engines
    }
  }
  const visited = new Set()

  for (const dependency of Object.keys(artifactPackage.dependencies)) {
    collectDependency(rootPackageLock, packages, visited, dependency)
  }

  return {
    name: artifactPackage.name,
    version: artifactPackage.version,
    lockfileVersion: rootPackageLock.lockfileVersion,
    requires: true,
    packages
  }
}

function collectDependency(rootPackageLock, packages, visited, dependency) {
  if (visited.has(dependency)) {
    return
  }

  visited.add(dependency)

  const packagePath = `node_modules/${dependency}`
  const packageEntry = rootPackageLock.packages?.[packagePath]

  if (!packageEntry) {
    throw new Error(`Cannot build backend package-lock: missing ${packagePath} in root package-lock.json`)
  }

  packages[packagePath] = packageEntry

  for (const childDependency of Object.keys(packageEntry.dependencies || {})) {
    collectDependency(rootPackageLock, packages, visited, childDependency)
  }

  for (const optionalDependency of Object.keys(packageEntry.optionalDependencies || {})) {
    collectDependency(rootPackageLock, packages, visited, optionalDependency)
  }
}
