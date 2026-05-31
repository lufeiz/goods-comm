import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isRealMiniProgramAppId,
  miniProgramAppIdEnvKey,
  patchMiniProgramAppId,
  readMiniProgramAppId,
  resolveMiniProgramAppId
} from './mini-program-deploy-config.mjs'

const root = await mkdtemp(join(tmpdir(), 'goods-comm-mini-program-config-'))

try {
  await testWeixinPatch()
  await testAlipayPatch()
  await testPlaceholderSkip()
  await testMissingConfigFailsForRealAppId()
} finally {
  await rm(root, {
    recursive: true,
    force: true
  })
}

console.log('Mini program deploy config smoke checks passed')

async function testWeixinPatch() {
  const directory = await makeConfigDir('weixin', 'project.config.json', {
    appid: 'touristappid',
    projectname: 'goods-comm'
  })
  const values = {
    GOODS_COMM_WECHAT_APP_ID: 'wx1234567890abcdef'
  }

  assert.equal(miniProgramAppIdEnvKey('mp-weixin'), 'GOODS_COMM_WECHAT_APP_ID')
  assert.equal(resolveMiniProgramAppId(values, 'mp-weixin'), values.GOODS_COMM_WECHAT_APP_ID)

  const result = await patchMiniProgramAppId({
    platform: 'mp-weixin',
    directory,
    values
  })

  assert.equal(result.patched, true)
  assert.equal(await readMiniProgramAppId({ platform: 'mp-weixin', directory }), values.GOODS_COMM_WECHAT_APP_ID)
}

async function testAlipayPatch() {
  const directory = await makeConfigDir('alipay', 'mini.project.json', {
    appid: 'touristappid',
    projectname: 'goods-comm'
  })
  const values = {
    GOODS_COMM_ALIPAY_APP_ID: '2021000000000000'
  }

  assert.equal(miniProgramAppIdEnvKey('mp-alipay'), 'GOODS_COMM_ALIPAY_APP_ID')
  assert.equal(resolveMiniProgramAppId(values, 'mp-alipay'), values.GOODS_COMM_ALIPAY_APP_ID)

  const result = await patchMiniProgramAppId({
    platform: 'mp-alipay',
    directory,
    values
  })

  assert.equal(result.patched, true)
  assert.equal(await readMiniProgramAppId({ platform: 'mp-alipay', directory }), values.GOODS_COMM_ALIPAY_APP_ID)
}

async function testPlaceholderSkip() {
  const directory = await makeConfigDir('placeholder', 'project.config.json', {
    appid: 'touristappid',
    projectname: 'goods-comm'
  })
  const values = {
    GOODS_COMM_WECHAT_APP_ID: 'REPLACE_WITH_REAL_WECHAT_APP_ID'
  }

  assert.equal(isRealMiniProgramAppId('touristappid'), false)
  assert.equal(resolveMiniProgramAppId(values, 'mp-weixin'), '')

  const result = await patchMiniProgramAppId({
    platform: 'mp-weixin',
    directory,
    values
  })

  assert.equal(result.patched, false)
  assert.equal(result.reason, 'missing-real-appid')
  assert.equal(await readMiniProgramAppId({ platform: 'mp-weixin', directory }), 'touristappid')
}

async function testMissingConfigFailsForRealAppId() {
  const directory = join(root, 'missing-config')
  await mkdir(directory)

  await assert.rejects(
    () => patchMiniProgramAppId({
      platform: 'mp-alipay',
      directory,
      appId: '2021000000000001'
    }),
    /mini\.project\.json/
  )
}

async function makeConfigDir(name, fileName, content) {
  const directory = join(root, name)
  await mkdir(directory)
  await writeFile(join(directory, fileName), `${JSON.stringify(content, null, 2)}\n`)

  const raw = await readFile(join(directory, fileName), 'utf8')
  assert.ok(raw.includes(content.projectname))

  return directory
}
