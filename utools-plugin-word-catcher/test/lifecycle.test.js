'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const core = require('../lib/core.js')
const library = require('../lib/library.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-lifecycle-'))
const store = new Map([['tw_settings', { profiles: [], dataDir: root }]])
const clone = x => JSON.parse(JSON.stringify(x))
let enter,
  out,
  visibility,
  detail,
  windowType = 'main'
const calls = []
const back = {
  require: n => (n === './lib/core.js' ? core : n === './lib/library.js' ? library : require(n)),
  URL,
  Buffer,
  CustomEvent: class {
    constructor(name, options) {
      this.detail = options.detail
    }
  },
  window: {
    dispatchEvent: event => {
      detail = event.detail
    }
  },
  document: {
    visibilityState: 'visible',
    addEventListener: (name, fn) => {
      assert.strictEqual(name, 'visibilitychange')
      visibility = fn
    }
  },
  utools: {
    onPluginEnter: fn => {
      enter = fn
    },
    onPluginOut: fn => {
      out = fn
    },
    getWindowType: () => windowType,
    outPlugin: (...args) => {
      calls.push(['out', ...args])
      out(false)
    },
    hideMainWindow: () => {
      calls.push(['hide'])
      return true
    },
    dbStorage: {
      getItem: k => (store.has(k) ? clone(store.get(k)) : null),
      setItem: (k, v) => store.set(k, clone(v)),
      removeItem: k => store.delete(k)
    }
  }
}
try {
  vm.createContext(back)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), back)
  visibility() // 初始页面加载不退出。
  for (const command of ['词捕', '记单词', '记生词']) {
    enter({ code: 'capture-keyword', type: 'text', payload: command })
    assert.strictEqual(detail.text, '')
  }
  enter({ code: 'capture-text', type: 'over', payload: 'A resilient system.' })
  assert.strictEqual(detail.text, 'A resilient system.')
  enter({ code: 'capture-text', type: 'over', payload: '词捕' }) // 不按文字硬编码排除。
  assert.strictEqual(detail.text, '词捕')
  enter({ code: 'capture-text', type: 'regex', payload: 'robust' })
  assert.strictEqual(detail.text, 'robust')
  enter({ code: 'capture-text', type: 'files', payload: [] })
  assert.strictEqual(detail.text, '')
  assert.deepStrictEqual(calls, []) // 可见状态 / 焦点变化不退出。
  back.document.visibilityState = 'hidden'
  visibility()
  visibility()
  assert.deepStrictEqual(calls, [['out']]) // 不结束进程，且不重入。
  enter({ type: 'text', payload: '词捕' })
  windowType = 'detach'
  visibility()
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(back.window.services.closeToUtools(), false)
  windowType = 'main'
  out(false)
  visibility()
  assert.strictEqual(calls.length, 1)
  enter({ type: 'text', payload: '词捕' })
  assert.strictEqual(back.window.services.closeToUtools(), true)
  assert.deepStrictEqual(calls.slice(-2), [['out'], ['hide']])
  visibility()
  assert.strictEqual(calls.length, 3)
  enter({ type: 'text', payload: '词捕' })
  back.utools.showOpenDialog = () => {
    visibility()
    return null
  }
  back.window.services.pickDataDir(root)
  visibility()
  assert.strictEqual(calls.length, 3) // 对话框期间及延迟可见性事件均不得退出。

  let route
  const app = { innerHTML: '', addEventListener() {}, querySelector: () => null }
  const front = {
    services: back.window.services,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    document: { getElementById: () => app, addEventListener() {} },
    window: {
      addEventListener: (name, fn) => {
        if (name === 'tw-enter') route = fn
      }
    }
  }
  vm.createContext(front)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), front)
  const run = code => vm.runInContext(code, front)
  route({ detail: { text: 'A resilient system.' } })
  assert.strictEqual(run('S.view'), 'capture')
  assert.strictEqual(run('S.payload'), 'A resilient system.')
  const id = run('S.generationId')
  route({ detail: { text: '' } })
  assert.strictEqual(run('S.view'), 'list')
  assert.strictEqual(run('S.payload'), '')
  assert.ok(run('S.generationId') > id) // 普通重入后旧生成结果不得回填。
  run("switchView('capture')")
  assert.match(app.innerHTML, /spellcheck="false"><\/textarea>/)
  // 后台重入读取手工修改的 config.json；未保存的表单仍保留。
  const config = path.join(root, 'config.json')
  const settings = {
    dataDir: root,
    profiles: [
      { name: '服务', apiBase: 'https://example.invalid/v1', apiKey: 'test-only', model: 'before' }
    ]
  }
  back.window.services.saveSettings(settings)
  route({ detail: { text: '' } })
  assert.strictEqual(run('S.settings.profiles[0].model'), 'before')
  run("switchView('settings'); curProfile().name = '尚未保存'")
  fs.writeFileSync(
    config,
    JSON.stringify({ ...settings, profiles: [{ ...settings.profiles[0], model: 'after' }] })
  )
  route({ detail: { text: '' } })
  assert.strictEqual(run('S.settings.profiles[0].model'), 'after')
  assert.strictEqual(run('S.draft.profiles[0].name'), '尚未保存')
  console.log('✓ 启动指令不预填、划词保留、普通重入清空及主窗口隐藏退出测试通过')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
