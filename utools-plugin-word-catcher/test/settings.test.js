'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const http = require('http')
const { setTimeout: delay } = require('timers/promises')
const core = require('../lib/core.js')
const library = require('../lib/library.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-settings-'))
const store = new Map([['tw_settings', { profiles: [], activeProfile: 0, dataDir: root }]])
const profile = name => ({
  name,
  apiBase: 'https://example.invalid/v1',
  apiKey: 'test',
  model: name + '-chat',
  thinking: 'off',
  models: []
})
const clone = value => JSON.parse(JSON.stringify(value))
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/split/')) {
    const payload = req.url.endsWith('/models')
      ? { data: [{ id: '中文模型' }] }
      : { choices: [{ message: { content: '中文回答' } }] }
    const bytes = Buffer.from(JSON.stringify(payload))
    const split = bytes.indexOf(Buffer.from('中')) + 1
    res.setHeader('Content-Type', 'application/json')
    res.write(bytes.subarray(0, split))
    setTimeout(() => res.end(bytes.subarray(split)), 20)
    return
  }
  if (req.url === '/aborted/models') {
    res.write('{')
    setTimeout(() => res.destroy(), 20)
    return
  }
  if (req.url === '/unauthorized/models') {
    res.statusCode = 401
    res.end('{}')
    return
  }
  if (req.url === '/bad-json/models') {
    res.end('invalid')
    return
  }
  const responses = {
    '/v1/models': {
      data: [{ id: ' z-model ' }, { id: 'a-model' }, { id: 'z-model' }, null, { id: '' }]
    },
    '/strings/models': [' b ', 'a', 'b'],
    '/objects/models': [{ model: 'b' }, { id: 'a' }],
    '/empty/models': { data: [] }
  }
  if (responses[req.url]) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(responses[req.url]))
  } else {
    res.statusCode = 404
    res.end('{}')
  }
})

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const back = {
    require: name =>
      name === './lib/core.js' ? core : name === './lib/library.js' ? library : require(name),
    URL,
    Buffer,
    window: {},
    utools: {
      onPluginEnter() {},
      dbStorage: {
        getItem: key => (store.has(key) ? clone(store.get(key)) : null),
        setItem: (key, value) => store.set(key, clone(value)),
        removeItem: key => store.delete(key)
      }
    }
  }
  vm.createContext(back)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), back)
  const services = back.window.services
  // 新用户无需先建目录；“打开目录”初始化空目录并直接打开文件夹。
  let opened
  back.utools.shellOpenPath = async dir => {
    opened = dir
    return ''
  }
  await services.openDataFolder()
  assert.strictEqual(opened, root)
  assert.strictEqual(fs.existsSync(path.join(root, 'daily')), true)
  assert.strictEqual(fs.existsSync(path.join(root, 'prompts')), true)
  assert.strictEqual(fs.existsSync(path.join(root, 'config.json')), false)
  back.utools.shellOpenPath = async () => '模拟打开失败'
  await assert.rejects(services.openDataFolder(), /模拟打开失败/)
  delete back.utools.shellOpenPath
  back.utools.shellShowItemInFolder = dir => {
    opened = dir
  }
  await services.openDataFolder()
  assert.strictEqual(opened, root)
  const base = 'http://127.0.0.1:' + server.address().port
  for (const suffix of ['/v1', '/v1/models/', '/v1/chat/completions']) {
    assert.deepStrictEqual(
      clone(await services.fetchModels({ apiBase: base + suffix, apiKey: '' })),
      ['a-model', 'z-model']
    )
  }
  for (const suffix of ['/strings', '/objects'])
    assert.deepStrictEqual(clone(await services.fetchModels({ apiBase: base + suffix })), [
      'a',
      'b'
    ])
  // TCP 分片可落在 UTF-8 字符中间，模型 ID 和回答不能被替换符污染。
  assert.deepStrictEqual(clone(await services.fetchModels({ apiBase: base + '/split' })), [
    '中文模型'
  ])
  assert.strictEqual(
    (await services.testConnection({ apiBase: base + '/split', model: '中文模型' })).reply,
    '中文回答'
  )
  await assert.rejects(services.fetchModels({ apiBase: base + '/unauthorized' }), /Key 无效/)
  await assert.rejects(services.fetchModels({ apiBase: base + '/bad-json' }), /非 JSON/)
  // 已收到响应但服务端中途断开时，Promise 也必须结束，不能一直停在“获取中”。
  const interrupted = services.fetchModels({ apiBase: base + '/aborted' })
  await assert.rejects(
    Promise.race([
      interrupted,
      delay(1000, undefined, { ref: false }).then(() => {
        throw new Error('请求未结束')
      })
    ]),
    /响应中断|aborted|socket hang up/
  )
  await assert.rejects(services.fetchModels({ apiBase: base + '/empty' }), /未返回模型列表/)
  await assert.rejects(services.fetchModels({ apiBase: base + '/missing' }), /手动填写/)
  await assert.rejects(services.fetchModels({ apiBase: 'file:///tmp/test' }), /http/)
  await assert.rejects(services.fetchModels({ apiBase: 'https://example.invalid' }), /API Key/)

  // IPv6 本机 API：URL 的方括号不能原样传给 Node 的 hostname。
  const ipv6Server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify(
        req.url.endsWith('/models')
          ? { data: [{ id: 'ipv6-model' }] }
          : { choices: [{ message: { content: 'OK' } }] }
      )
    )
  })
  try {
    await new Promise((resolve, reject) => {
      ipv6Server.once('error', reject)
      ipv6Server.listen(0, '::1', resolve)
    })
    const ipv6Profile = {
      apiBase: 'http://[::1]:' + ipv6Server.address().port + '/v1',
      apiKey: '',
      model: 'ipv6-model'
    }
    assert.deepStrictEqual(clone(await services.fetchModels(ipv6Profile)), ['ipv6-model'])
    assert.strictEqual((await services.testConnection(ipv6Profile)).reply, 'OK')
    console.log('✓ IPv6 本地模型列表和生成接口通过真实回环 HTTP 验证')
  } catch (e) {
    if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(e.code)) throw e
    console.log('跳过 IPv6 验证：系统未启用 IPv6 回环')
  } finally {
    await new Promise(resolve => ipv6Server.close(resolve))
  }

  // 数据目录可独立保存；配置导入目标和生成文件使用保存后的本机目录。
  const newDir = path.join(root, 'new-dir')
  services.saveEntry(
    core.validateEntry({
      word: 'existing',
      trans: [{ cn: '已有' }],
      sentences: [{ c: 'An example.' }]
    })
  )
  services.saveSettings({ profiles: [], activeProfile: 0, dataDir: newDir })
  assert.strictEqual(services.getSettings().dataDir, newDir)
  assert.strictEqual(services.getDailyInfo().count, 1)
  assert.throws(() =>
    services.saveSettings({ profiles: [profile('broken')], dataDir: '\0bad-path' })
  )
  assert.strictEqual(services.getSettings().dataDir, newDir)

  const app = {
    innerHTML: '',
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  }
  const toast = {}
  const front = {
    URL,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    document: { getElementById: id => (id === 'app' ? app : toast), addEventListener() {} },
    window: { addEventListener() {} },
    services: {
      ...services,
      getSettings: () => ({
        profiles: [profile('first'), profile('second')],
        activeProfile: 0,
        dataDir: newDir
      })
    }
  }
  vm.createContext(front)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), front)
  const run = code => vm.runInContext(code, front)
  front.services.openDataFolder = async () => {
    throw new Error('模拟目录权限不足')
  }
  await run("fileAction(() => services.openDataFolder(), '打开目录')")
  assert.match(toast.textContent, /打开目录失败.*权限不足/)
  run("switchView('settings')")
  const first = run('curProfile()')
  let finish
  front.services.fetchModels = () =>
    new Promise(resolve => {
      finish = resolve
    })
  const fetching = run('fetchModelsUI()')
  run('S.profileIndex = 1; render()')
  finish(['long-model-name', 'z-model', 'z-model'])
  await fetching
  assert.deepStrictEqual(clone(first.models), ['long-model-name', 'z-model'])
  assert.deepStrictEqual(clone(run('curProfile().models')), [])
  assert.strictEqual(run('S.draft.activeProfile'), 0)
  assert.strictEqual(run('S.modelOpen'), false)

  // 输入中改 Key 时丢弃旧响应；失败信息在对应配置下保留。
  run('S.profileIndex = 0; render()')
  const stale = run('fetchModelsUI()')
  first.apiKey = 'changed'
  finish(['wrong-server-model'])
  await stale
  assert.strictEqual(first.models.includes('wrong-server-model'), false)
  front.services.fetchModels = async () => {
    throw new Error('HTTP 401：无权限')
  }
  await run('fetchModelsUI()')
  assert.match(app.innerHTML, /获取失败.*无权限/)
  assert.strictEqual(first.model, 'first-chat')
  front.services.fetchModels = async () => ['first-chat', 'first-reasoner']
  await run('fetchModelsUI()')
  assert.strictEqual(run('S.modelOpen'), true)
  assert.match(run('modelOptionsHTML()'), /first-chat/)
  assert.match(run('modelOptionsHTML()'), /first-reasoner/)
  run("S.modelQuery = 'reasoner'")
  assert.doesNotMatch(run('modelOptionsHTML()'), /data-model="first-chat"/)

  // 配置切页保留草稿；测试结果不会串到其他配置。
  first.name = 'edited first'
  run("switchView('list'); switchView('settings')")
  assert.strictEqual(run('curProfile().name'), 'edited first')
  front.services.testConnection = () =>
    new Promise(resolve => {
      finish = resolve
    })
  const testing = run('testApi()')
  run('S.profileIndex = 1; render()')
  finish({ ms: 123, reply: 'OK' })
  await testing
  assert.doesNotMatch(app.innerHTML, /123 ms/)
  run('S.profileIndex = 0; render()')
  assert.match(app.innerHTML, /123 ms/)

  // 手动粘贴自动识别句子，模式切换仍尊重用户手动指定。
  run("resetCapture(); S.payload = 'serendipity'; syncCapture()")
  assert.strictEqual(run('S.word'), 'serendipity')
  assert.strictEqual(run('S.mode'), 'word')
  run("S.payload = 'A robust method improves reproducibility.'; syncCapture()")
  assert.strictEqual(run('S.mode'), 'sentence')
  assert.strictEqual(run('S.word'), '')
  run("S.modeManual = true; S.mode = 'word'; S.payload = 'state of the art'; syncCapture()")
  assert.strictEqual(run('S.word'), 'state of the art')

  // 返回输入后旧生成结果不得覆盖新一轮输入。
  front.services.generateEntry = () =>
    new Promise(resolve => {
      finish = resolve
    })
  run("switchView('capture'); S.word = 'robust'")
  const generating = run('generate()')
  run("resetCapture(); S.word = 'new-word'")
  finish(
    core.validateEntry({
      word: 'robust',
      trans: [{ cn: '稳健的' }],
      sentences: [{ c: 'A robust method.' }]
    })
  )
  await generating
  assert.strictEqual(run('S.entry'), null)
  assert.strictEqual(run('S.word'), 'new-word')

  // 一次性导入试用词，消费后不会因重启而复活已删除的词条。
  const queued = {
    type: 'typewords-library',
    version: 1,
    records: [
      {
        word: 'demo',
        rawWord: 'demo',
        rawSentence: '',
        createdAt: core.todayStr(),
        updatedAt: core.todayStr(),
        entry: core.validateEntry({
          word: 'demo',
          trans: [{ cn: '示例' }],
          sentences: [{ c: 'A demo.' }]
        })
      }
    ],
    daily: {},
    prompt: null
  }
  fs.writeFileSync(path.join(newDir, 'pending-library.json'), JSON.stringify(queued))
  assert.strictEqual(services.initializeLibrary().added, 1)
  assert.strictEqual(services.initializeLibrary(), null)
  services.deleteEntry('demo')
  assert.strictEqual(services.initializeLibrary(), null)
  assert.strictEqual(
    services.listEntries().some(r => r.word === 'demo'),
    false
  )
  console.log('✓ 模型接口、配置切换竞态、持久化、输入识别、生成取消及一次性试用词导入测试通过')
}
main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    server.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
