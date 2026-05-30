import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'

const root = process.cwd()
const h5Root = resolve(root, getArgValue('--dist') || 'dist/build/h5')
const chromePath = getArgValue('--chrome') || process.env.GOODS_COMM_CHROME_PATH || findChromePath()
const timeoutMs = Number(getArgValue('--timeout-ms') || process.env.GOODS_COMM_H5_RENDER_TIMEOUT_MS || 30000)

if (!existsSync(join(h5Root, 'index.html'))) {
  throw new Error(`H5 build output is missing at ${h5Root}; run npm run build:h5 first`)
}

if (!chromePath) {
  throw new Error('Chrome executable is missing; set GOODS_COMM_CHROME_PATH or install Google Chrome/Chromium for H5 render smoke')
}

async function main() {
  const server = await startStaticServer(h5Root)
  const baseUrl = `http://127.0.0.1:${server.port}`
  const browser = await startChrome(chromePath)
  let page

  try {
    page = await createPage(browser.debugPort)
    await configureBrowser(page, baseUrl)
    await runMainFlow(page, baseUrl)
    assertNoBrowserErrors(page.diagnostics)
    console.log('H5 render smoke checks passed for login, location, publish, and trade sale flow')
  } finally {
    await page?.close().catch(() => {})
    await browser.close()
    await server.close()
  }
}

async function runMainFlow(page, baseUrl) {
  const itemTitle = `H5 smoke folding chair ${Date.now()}`

  await page.navigate(`${baseUrl}/#/`)
  await page.waitForSelector('home-page')
  await page.assertText('home-page', '邻里旧货')
  await page.assertVisibleAny(['home-good-list', 'home-empty-state'])
  await page.setInput('home-search-input', '折叠椅')
  await page.click('home-search-button')
  await page.assertVisibleAny(['home-good-list', 'home-empty-state'])

  await page.navigateHash('/pages/mine/mine')
  await page.waitForSelector('mine-page')
  await page.ensureAgreementAccepted()
  await page.callPageMethod('mine-page', 'login')
  await page.waitForSelector('mine-logout-button')
  const seller = await page.getStorage('goods.authUser')
  assert.ok(seller?.id, 'seller must be logged in through the H5 UI')

  await page.navigateHash('/pages/publish/publish')
  await page.waitForSelector('publish-page')
  await page.waitForText('publish-location-summary', '石门二路社区')
  await page.setInput('publish-title-input', itemTitle)
  await page.setInput('publish-price-input', '38')
  await page.setInput('publish-description-input', 'H5 render smoke verified item')
  await page.callPageProxy('publish-page', (proxy, title) => {
    proxy.form.title = title
    proxy.form.price = '38'
    proxy.form.description = 'H5 render smoke verified item'
  }, itemTitle)
  await page.callPageProxy('publish-page', (proxy) => {
    proxy.form.images = [{
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      status: 'local_pending_upload'
    }]
  })
  await page.waitForFunction(() => document.querySelectorAll('.image-cell').length >= 1, 'publish image preview')
  await page.callPageMethod('publish-page', 'submit')
  await page.waitForFunction((title) => {
    const items = readStorage('goods.items') || []
    return Array.isArray(items) && items.some((item) => item.title === title && item.status === 'online')

    function readStorage(key) {
      const raw = window.localStorage?.getItem(key)
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw)
        return parsed?.data ?? parsed
      } catch (error) {
        return raw
      }
    }
  }, 'published item stored as online', itemTitle)

  const publishedItem = await page.evaluate((title) => {
    const items = readStorage('goods.items') || []
    return items.find((item) => item.title === title) || null

    function readStorage(key) {
      const raw = window.localStorage?.getItem(key)
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw)
        return parsed?.data ?? parsed
      } catch (error) {
        return raw
      }
    }
  }, itemTitle)
  assert.ok(publishedItem?.id, 'published item id must be available for detail route')

  await page.setBuyerIdentity()
  await page.navigateHash('/pages/mine/mine')
  await page.waitForSelector('mine-page')
  await page.ensureAgreementAccepted()
  await page.callPageMethod('mine-page', 'login')
  await page.waitForSelector('mine-logout-button')
  const buyer = await page.getStorage('goods.authUser')
  assert.ok(buyer?.id, 'buyer must be logged in through the H5 UI')
  assert.notEqual(buyer.id, seller.id, 'buyer and seller must be distinct users')

  await page.navigateHash(`/pages/detail/detail?id=${encodeURIComponent(publishedItem.id)}`)
  await page.waitForSelector('detail-page')
  await page.waitForText('detail-title-block', itemTitle)
  await page.waitForText('detail-eligibility-panel', '可交易')
  await page.callPageMethod('detail-page', 'startTrade')
  await page.waitForFunction(() => {
    const trades = readStorage('goods.trades') || []
    return Array.isArray(trades) && trades.some((trade) => trade.status === 'pending_seller_confirm')

    function readStorage(key) {
      const raw = window.localStorage?.getItem(key)
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw)
        return parsed?.data ?? parsed
      } catch (error) {
        return raw
      }
    }
  }, 'buyer trade intent created')

  await page.setStorage('goods.authUser', seller)
  await page.navigateHash('/pages/mine/mine')
  await page.waitForSelector('mine-page')
  await page.navigateHash('/pages/orders/orders')
  await page.waitForSelector('orders-page')
  await page.waitForSelector('orders-trade-card')
  await page.callPageProxy('orders-page', async (proxy) => {
    proxy.confirmTradeAction = () => Promise.resolve(true)
    await proxy.updateStatus(proxy.trades[0], 'pending_meetup')
  })
  await page.waitForFunction(() => document.querySelector('[data-testid="orders-trade-status"][data-status="pending_meetup"]'), 'seller confirmed trade')
  await page.waitForSelector('orders-trade-contact')
  await page.callPageProxy('orders-page', async (proxy) => {
    proxy.confirmTradeAction = () => Promise.resolve(true)
    await proxy.updateStatus(proxy.trades[0], 'completed')
  })
  await page.waitForFunction(() => document.querySelector('[data-testid="orders-trade-status"][data-status="completed"]'), 'seller completed trade')
}

async function configureBrowser(page, baseUrl) {
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.send('Log.enable')
  await page.send('Browser.grantPermissions', {
    origin: baseUrl,
    permissions: ['geolocation']
  }).catch(() => {})
  await page.send('Emulation.setGeolocationOverride', {
    latitude: 31.22945,
    longitude: 121.45494,
    accuracy: 35
  })
}

async function createPage(debugPort) {
  const target = await fetchJson(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: 'PUT'
  })
  const page = new CdpPage(target.webSocketDebuggerUrl)
  await page.open()
  page.on('Runtime.exceptionThrown', (params) => {
    page.diagnostics.push(`exception: ${params.exceptionDetails?.text || params.exceptionDetails?.exception?.description || 'unknown exception'}`)
  })
  page.on('Runtime.consoleAPICalled', (params) => {
    if (['error', 'assert'].includes(params.type)) {
      const text = (params.args || []).map((arg) => arg.value || arg.description || '').filter(Boolean).join(' ')
      page.diagnostics.push(`console.${params.type}: ${text}`)
    }
  })
  page.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') {
      page.diagnostics.push(`log.error: ${params.entry.text}`)
    }
  })
  return page
}

class CdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    this.diagnostics = []
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl)
    await once(this.ws, 'open')
    this.ws.addEventListener('message', (event) => this.handleMessage(event))
    this.ws.addEventListener('error', (event) => {
      this.diagnostics.push(`cdp websocket error: ${event.message || 'unknown error'}`)
    })
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || []
    handlers.push(handler)
    this.handlers.set(method, handlers)
  }

  send(method, params = {}) {
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params })

    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        method
      })
      this.ws.send(payload)
    })
  }

  async navigate(url) {
    await this.patchRuntimeOnNextDocument()
    await this.send('Page.navigate', { url })
    await this.waitForFunction(() => document.readyState === 'complete', 'document ready')
    await this.patchRuntime()
  }

  async navigateHash(route) {
    await this.evaluate((nextRoute) => {
      window.location.hash = `#${nextRoute}`
    }, route)
    await this.delay(250)
    await this.patchRuntime()
  }

  async patchRuntimeOnNextDocument() {
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: browserRuntimePatchSource()
    })
  }

  async patchRuntime() {
    await this.evaluate(browserRuntimePatch)
  }

  async close() {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      return
    }

    await this.send('Page.close').catch(() => {})
    this.ws.close()
  }

  async evaluate(fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed')
    }

    return result.result?.value
  }

  async waitForSelector(testId) {
    await this.waitForFunction((id) => Boolean(document.querySelector(`[data-testid="${id}"]`)), `selector ${testId}`, testId)
  }

  async assertVisibleAny(testIds) {
    const visible = await this.evaluate((ids) => ids.some((id) => Boolean(document.querySelector(`[data-testid="${id}"]`))), testIds)
    assert.ok(visible, `expected one of these test ids to be visible: ${testIds.join(', ')}`)
  }

  async assertText(testId, text) {
    const visible = await this.evaluate((id, expected) => {
      const node = document.querySelector(`[data-testid="${id}"]`)
      return Boolean(node?.textContent?.includes(expected))
    }, testId, text)
    assert.ok(visible, `${testId} must include text: ${text}`)
  }

  async waitForText(testId, text) {
    await this.waitForFunction((id, expected) => {
      const node = document.querySelector(`[data-testid="${id}"]`)
      return Boolean(node?.textContent?.includes(expected))
    }, `${testId} text ${text}`, testId, text)
  }

  async setInput(testId, value) {
    const updated = await this.evaluate((id, nextValue) => {
      const root = document.querySelector(`[data-testid="${id}"]`)
      const input = root?.matches?.('input, textarea')
        ? root
        : root?.querySelector?.('input, textarea')

      if (!input) {
        return false
      }

      input.focus()
      input.value = nextValue
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: nextValue
      }))
      input.dispatchEvent(new Event('change', {
        bubbles: true,
        composed: true
      }))
      return true
    }, testId, value)
    assert.ok(updated, `${testId} input must be editable`)
  }

  async click(testId) {
    await this.clickBySelector(`[data-testid="${testId}"]`)
  }

  async clickBySelector(selector) {
    const clicked = await this.evaluate((targetSelector) => {
      const node = document.querySelector(targetSelector)
      if (!node) {
        return false
      }

      const target = node.matches('button, input, textarea, label')
        ? node
        : node.querySelector('button, input, textarea, label') || node

      target.scrollIntoView({
        block: 'center',
        inline: 'center'
      })
      for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        try {
          target.dispatchEvent(new Event(eventName, {
            bubbles: true,
            composed: true,
            cancelable: true
          }))
        } catch (error) {
          // Some synthetic event types are not constructible in every runtime.
        }
      }
      target.click()
      return true
    }, selector)
    assert.ok(clicked, `click target must exist: ${selector}`)
    await this.delay(250)
    await this.patchRuntime()
  }

  async callPageMethod(testId, methodName, ...args) {
    const result = await this.evaluate(async (id, name, methodArgs) => {
      const proxy = findVueProxyByTestId(id, name)
      if (!proxy) {
        return {
          ok: false,
          reason: `Vue proxy not found for ${id}`
        }
      }

      if (typeof proxy[name] !== 'function') {
        return {
          ok: false,
          reason: `Method ${name} not found for ${id}`
        }
      }

      await proxy[name](...methodArgs)
      return {
        ok: true
      }

      function findVueProxyByTestId(targetId, requiredMethod = '') {
        let node = document.querySelector(`[data-testid="${targetId}"]`)
        while (node) {
          let component = node.__vueParentComponent || node.__vue_app__?._instance
          while (component) {
            if (component.proxy && (!requiredMethod || typeof component.proxy[requiredMethod] === 'function')) {
              return component.proxy
            }
            component = component.parent
          }
          node = node.parentElement
        }
        return null
      }
    }, testId, methodName, args)

    assert.ok(result?.ok, result?.reason || `${testId}.${methodName} must be callable`)
    await this.delay(300)
    await this.patchRuntime()
  }

  async callPageProxy(testId, fn, ...args) {
    const result = await this.evaluate(async (id, source, methodArgs) => {
      const proxies = findVueProxiesByTestId(id)
      if (!proxies.length) {
        return {
          ok: false,
          reason: `Vue proxy not found for ${id}`
        }
      }

      const runner = eval(`(${source})`)
      let lastError = ''
      for (const proxy of proxies) {
        try {
          await Promise.race([
            runner(proxy, ...methodArgs),
            new Promise((resolvePromise, rejectPromise) => {
              setTimeout(() => rejectPromise(new Error('proxy action timed out')), 10000)
            })
          ])
          return {
            ok: true
          }
        } catch (error) {
          lastError = error?.message || String(error)
        }
      }

      return {
        ok: false,
        reason: `No Vue proxy accepted action for ${id}: ${lastError}`
      }

      function findVueProxiesByTestId(targetId) {
        const proxies = []
        let node = document.querySelector(`[data-testid="${targetId}"]`)
        while (node) {
          let component = node.__vueParentComponent || node.__vue_app__?._instance
          while (component) {
            if (component.proxy && !proxies.includes(component.proxy)) {
              proxies.push(component.proxy)
            }
            component = component.parent
          }
          node = node.parentElement
        }
        return proxies
      }
    }, testId, fn.toString(), args)

    assert.ok(result?.ok, result?.reason || `${testId} proxy action must be callable`)
    await this.delay(300)
    await this.patchRuntime()
  }

  async waitForFunction(fn, label, ...args) {
    const deadline = Date.now() + timeoutMs
    let lastError = ''

    while (Date.now() < deadline) {
      try {
        const matched = await this.evaluate(fn, ...args)
        if (matched) {
          return
        }
      } catch (error) {
        lastError = error.message
      }
      await this.delay(100)
    }

    let snapshot = ''
    try {
      snapshot = await this.evaluate(() => {
        const bodyText = document.body?.innerText || ''
        const storage = {}
        for (const key of ['goods.userAgreement', 'goods.authUser', 'goods.h5.clientId']) {
          storage[key] = window.localStorage?.getItem(key) || ''
        }
        return JSON.stringify({
          hash: window.location.hash,
          bodyText: bodyText.slice(0, 1200),
          storage,
          smoke: window.__goodsCommH5Smoke || null
        }, null, 2)
      })
    } catch (error) {
      snapshot = `snapshot unavailable: ${error.message}`
    }

    throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ''}\n${snapshot}`)
  }

  async getStorage(key) {
    return this.evaluate((storageKey) => {
      const raw = window.localStorage?.getItem(storageKey)
      if (!raw) {
        return null
      }

      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && 'type' in parsed && 'data' in parsed) {
          return parsed.data
        }
        return parsed
      } catch (error) {
        return raw
      }
    }, key)
  }

  async setStorage(key, value) {
    await this.evaluate((storageKey, nextValue) => {
      const type = typeof nextValue
      const raw = type === 'string'
        ? nextValue
        : JSON.stringify({
            type,
            data: nextValue
          })
      window.localStorage?.setItem(storageKey, raw)
    }, key, value)
  }

  async setBuyerIdentity() {
    await this.evaluate(() => {
      window.localStorage?.removeItem('goods.authUser')
      window.localStorage?.setItem('goods.h5.clientId', `h5_buyer_${Date.now()}`)
    })
  }

  async ensureAgreementAccepted() {
    const accepted = await this.getStorage('goods.userAgreement')

    if (!accepted?.acceptedAt) {
      await this.click('mine-agreement-toggle')
      await this.waitForFunction(() => {
        const raw = window.localStorage?.getItem('goods.userAgreement')
        if (!raw) {
          return false
        }

        try {
          const parsed = JSON.parse(raw)
          return Boolean(parsed?.data?.acceptedAt || parsed?.acceptedAt)
        } catch (error) {
          return false
        }
      }, 'agreement acceptance persisted')
    }
  }

  delay(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
  }

  handleMessage(event) {
    const message = JSON.parse(event.data)

    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) {
        return
      }

      this.pending.delete(message.id)

      if (message.error) {
        pending.reject(new Error(`${pending.method} failed: ${message.error.message}`))
        return
      }

      pending.resolve(message.result || {})
      return
    }

    const handlers = this.handlers.get(message.method) || []
    for (const handler of handlers) {
      handler(message.params || {})
    }
  }
}

function browserRuntimePatchSource() {
  return `(${browserRuntimePatch.toString()})();`
}

function browserRuntimePatch() {
  window.__goodsCommH5Smoke = window.__goodsCommH5Smoke || {
    modals: [],
    toasts: []
  }

  if (!window.uni || window.uni.__goodsCommH5SmokePatched) {
    return false
  }

  window.uni.showToast = (options = {}) => {
    window.__goodsCommH5Smoke.toasts.push(String(options.title || ''))
    options.success?.({})
    options.complete?.({})
    return Promise.resolve({})
  }

  window.uni.showModal = (options = {}) => {
    window.__goodsCommH5Smoke.modals.push({
      title: String(options.title || ''),
      content: String(options.content || '')
    })
    const result = {
      confirm: true,
      cancel: false
    }
    options.success?.(result)
    options.complete?.(result)
    return Promise.resolve(result)
  }

  window.uni.chooseImage = (options = {}) => {
    const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    const result = {
      tempFilePaths: [imageUrl],
      tempFiles: [{
        path: imageUrl,
        size: 68
      }]
    }
    options.success?.(result)
    options.complete?.(result)
  }

  window.uni.__goodsCommH5SmokePatched = true
  return true
}

async function startStaticServer(rootDir) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
      if (requestUrl.pathname === '/favicon.ico') {
        response.writeHead(204, {
          'cache-control': 'no-store'
        })
        response.end()
        return
      }
      const pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
      const filePath = resolve(rootDir, `.${pathname}`)

      if (!isInside(rootDir, filePath)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }

      const fileStat = await stat(filePath)
      const finalPath = fileStat.isDirectory() ? join(filePath, 'index.html') : filePath
      const body = await readFile(finalPath)
      response.writeHead(200, {
        'content-type': contentType(finalPath),
        'cache-control': 'no-store'
      })
      response.end(body)
    } catch (error) {
      response.writeHead(404)
      response.end('Not found')
    }
  })

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', resolvePromise)
  })

  return {
    port: server.address().port,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise))
  }
}

async function startChrome(executablePath) {
  const debugPort = await getFreePort()
  const userDataDir = join(tmpdir(), `goods-comm-h5-render-${process.pid}-${Date.now()}`)
  await mkdir(userDataDir, {
    recursive: true
  })

  const chrome = spawn(executablePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  })

  const stderr = []
  chrome.stderr?.on('data', (chunk) => {
    stderr.push(String(chunk))
  })

  chrome.once('exit', (code) => {
    if (code && code !== 0) {
      stderr.push(`Chrome exited with code ${code}`)
    }
  })

  await waitFor(async () => {
    await fetchJson(`http://127.0.0.1:${debugPort}/json/version`)
    return true
  }, 10000, () => `Chrome DevTools endpoint did not start. stderr: ${stderr.join('').slice(-2000)}`)

  return {
    debugPort,
    close: async () => {
      await fetch(`http://127.0.0.1:${debugPort}/json/close`).catch(() => {})
      chrome.kill('SIGTERM')
      await Promise.race([
        once(chrome, 'exit').catch(() => {}),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))
      ])

      if (chrome.exitCode === null) {
        chrome.kill('SIGKILL')
      }

      await rm(userDataDir, {
        recursive: true,
        force: true
      })
    }
  }
}

async function getFreePort() {
  const server = createServer()
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const port = server.address().port
  await new Promise((resolvePromise) => server.close(resolvePromise))
  return port
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }
  return response.json()
}

async function waitFor(fn, ms, errorMessage) {
  const deadline = Date.now() + ms
  let lastError

  while (Date.now() < deadline) {
    try {
      if (await fn()) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }

  throw new Error(typeof errorMessage === 'function' ? errorMessage(lastError) : errorMessage)
}

function assertNoBrowserErrors(diagnostics) {
  const actionable = diagnostics
    .filter((item) => item)
    .filter((item) => !item.includes('favicon.ico'))

  assert.deepEqual(actionable, [], `Browser runtime errors were reported:\n${actionable.join('\n')}`)
}

function findChromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]

  return candidates.find((candidate) => existsSync(candidate)) || ''
}

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function isInside(rootDir, filePath) {
  const normalizedRoot = resolve(rootDir)
  const normalizedFile = resolve(filePath)
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${sep}`)
}

function contentType(filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  }

  return types[extname(filePath)] || 'application/octet-stream'
}

await main()
