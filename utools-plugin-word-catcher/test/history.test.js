'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const core = require('../lib/core.js')
const library = require('../lib/library.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-history-'))
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (word, cn = '测试') =>
  core.validateEntry({ word, trans: [{ cn }], sentences: [{ c: 'An example.' }] })
const store = new Map([['tw_settings', { dataDir: root, profiles: [], activeProfile: 0 }]])
let onEnter
let dialogOptions
const heights = []
const back = {
  URL,
  Buffer,
  CustomEvent: class {
    constructor(name, options) {
      this.type = name
      this.detail = options.detail
    }
  },
  require: name =>
    name === './lib/core.js' ? core : name === './lib/library.js' ? library : require(name),
  window: { dispatchEvent() {} },
  utools: {
    onPluginEnter: fn => {
      onEnter = fn
    },
    setExpandHeight: n => heights.push(['new', n]),
    setExpendHeight: n => heights.push(['old', n]),
    showOpenDialog: options => {
      dialogOptions = options
      return undefined
    },
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
try {
  // 8.x 优先新高度 API；旧版本仍可用，缺少高度接口也可进入。
  onEnter({ code: 'capture-keyword', type: 'text', payload: '' })
  assert.deepStrictEqual(heights, [['new', 620]])
  delete back.utools.setExpandHeight
  onEnter({ code: 'capture-keyword', payload: '' })
  assert.deepStrictEqual(heights[1], ['old', 620])
  delete back.utools.setExpendHeight
  assert.doesNotThrow(() => onEnter({ payload: '' }))
  assert.strictEqual(services.pickDataDir(root), null)
  assert.deepStrictEqual(clone(dialogOptions.properties), ['openDirectory', 'createDirectory'])

  services.saveEntry(entry('current', '本地当前释义'))
  services.saveEntry(entry('second'))
  const early = '2020-09-14'
  const later = '2021-10-08'
  core.writeDaily(root, early, [
    entry('current', '不应覆盖'),
    entry('archive-only', '旧释义'),
    entry('legacy')
  ])
  core.writeDaily(root, later, [entry('archive-only', '最新存档释义')])
  const beforeFiles = [early, later].map(d => fs.readFileSync(core.dailyPath(root, d), 'utf8'))
  const beforeDb = JSON.stringify([...store])
  assert.deepStrictEqual(clone(services.getHistoryRecoveryInfo()), { count: 2, errors: [] })
  assert.strictEqual(JSON.stringify([...store]), beforeDb) // 检查文件不会自动恢复或写入 DB。
  assert.strictEqual(services.recoverHistoryFiles().added, 2)
  assert.strictEqual(services.listEntries().length, 4)
  const recovered = store.get('tw_e:archive-only')
  assert.strictEqual(recovered.createdAt, early)
  assert.strictEqual(recovered.updatedAt, later)
  assert.strictEqual(recovered.entry.trans[0].cn, '最新存档释义')
  assert.strictEqual(store.get('tw_e:current').entry.trans[0].cn, '本地当前释义')
  assert.strictEqual(services.getDailyInfo().count, 2)
  assert.deepStrictEqual(
    [early, later].map(d => fs.readFileSync(core.dailyPath(root, d), 'utf8')),
    beforeFiles
  )
  assert.strictEqual(services.recoverHistoryFiles().added, 0)
  services.deleteEntry('legacy')
  assert.strictEqual(services.getHistoryRecoveryInfo().count, 1)
  assert.strictEqual(
    services.listEntries().some(r => r.word === 'legacy'),
    false
  ) // 检查或重启不会复活删除记录。
  services.recoverHistoryFiles()

  // 错误历史文件先报告，不写入部分恢复数据。
  const corrupt = core.dailyPath(root, '2022-01-01')
  fs.writeFileSync(corrupt, '[broken')
  const stable = JSON.stringify([...store])
  assert.strictEqual(services.getHistoryRecoveryInfo().errors.length, 1)
  assert.throws(() => services.recoverHistoryFiles(), /请先修复历史文件/)
  assert.strictEqual(JSON.stringify([...store]), stable)
  fs.unlinkSync(corrupt)

  // 日期分组不依赖输入顺序；跨年完整日期，今日默认展开，历史默认折叠。
  const app = { innerHTML: '', addEventListener() {}, querySelector: () => null }
  const front = {
    services,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    document: { getElementById: () => app, addEventListener() {} },
    window: { addEventListener() {} }
  }
  vm.createContext(front)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), front)
  const run = code => vm.runInContext(code, front)
  const dates = run('entryGroups(S.entries.slice().reverse()).map(g => g.date)')
  assert.deepStrictEqual(clone(dates), [core.todayStr(), early])
  assert.strictEqual(run(`dayIsOpen('${core.todayStr()}')`), true)
  assert.strictEqual(run(`dayIsOpen('${early}')`), false)
  assert.match(app.innerHTML, /全部 4 个词条/)
  assert.match(app.innerHTML, /2020年9月14日/)
  assert.match(app.innerHTML, new RegExp(`id="day-${early}" hidden`))
  run(`toggleDay('${early}')`)
  assert.strictEqual(run(`dayIsOpen('${early}')`), true)
  run("switchView('settings'); switchView('list')")
  assert.strictEqual(run(`dayIsOpen('${early}')`), true)
  run('foldAll()')
  assert.strictEqual(run(`dayIsOpen('${early}')`), false)
  assert.strictEqual(run(`dayIsOpen('${core.todayStr()}')`), false)
  run('foldAll()')
  assert.strictEqual(run(`dayIsOpen('${early}')`), true)

  // 搜索历史词自动展开；清除搜索不改变此前的折叠状态。
  run(
    `S.dayExpanded['${early}'] = false; S.search = 'ARCHIVE'; S.searchDayExpanded = Object.create(null)`
  )
  assert.strictEqual(run('filteredEntries().length'), 1)
  assert.strictEqual(run(`dayIsOpen('${early}')`), true)
  assert.match(run('listResultsHTML()'), /archive-only/)
  assert.doesNotMatch(run('listResultsHTML()'), new RegExp(`id="day-${early}" hidden`))
  run(`toggleDay('${early}'); S.search = ''`)
  assert.strictEqual(run(`dayIsOpen('${early}')`), false)
  run("S.search = '最新存档'")
  assert.strictEqual(run('filteredEntries().length'), 1)
  run("S.search = 'no-match'")
  assert.match(run('listResultsHTML()'), /没有匹配/)
  run("S.search = ''; S.entries = S.entries.filter(r => r.createdAt !== todayStr()); render()")
  assert.match(app.innerHTML, /今天还没有新词/)
  assert.match(app.innerHTML, /全部 2 个词条/)
  assert.match(app.innerHTML, /2020年9月14日/)
  services.updateEntry('archive-only', entry('archive-only', '编辑历史词'))
  assert.strictEqual(store.get('tw_e:archive-only').createdAt, early)
  assert.strictEqual(store.get('tw_e:archive-only').updatedAt, core.todayStr())
  assert.strictEqual(services.getDailyInfo().count, 2)
  assert.deepStrictEqual(
    [early, later].map(d => fs.readFileSync(core.dailyPath(root, d), 'utf8')),
    beforeFiles
  )
  console.log('✓ 历史日期分组、折叠状态、跨日期搜索、存档恢复及 uTools 8 高度 API 兼容测试通过')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
