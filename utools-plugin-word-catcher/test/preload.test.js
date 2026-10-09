'use strict'
// node test/preload.test.js：使用隔离目录与模拟 uTools，验证配置、冲突及词库迁移。
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const core = require('../lib/core.js')
const library = require('../lib/library.js')

const pluginDir = path.join(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-regression-'))
const today = core.todayStr()
const historic = '2020-09-14'
const entry = (word, cn = '测试') =>
  core.validateEntry({
    word,
    trans: [{ pos: 'n.', cn }],
    sentences: [{ c: 'An example.', cn: '一个例句。' }]
  })
const clone = value => JSON.parse(JSON.stringify(value))

function harness(name) {
  const dir = path.join(temp, name)
  fs.mkdirSync(dir)
  const db = new Map([['tw_settings', { dataDir: dir, profiles: [], activeProfile: 0 }]])
  const dialogs = { open: null, save: null }
  let failedKey = null
  let failedFile = null
  const mockLibrary = {
    ...library,
    writeAtomic(target, content) {
      if (target === failedFile) {
        failedFile = null
        throw new Error('模拟磁盘写入失败')
      }
      return library.writeAtomic(target, content)
    }
  }
  const context = {
    URL,
    Buffer,
    require: name =>
      name === './lib/core.js' ? core : name === './lib/library.js' ? mockLibrary : require(name),
    window: { dispatchEvent() {} },
    utools: {
      dbStorage: {
        getItem: key => (db.has(key) ? clone(db.get(key)) : null),
        setItem(key, value) {
          if (key === failedKey) {
            failedKey = null
            throw new Error('模拟数据库写入失败')
          }
          db.set(key, clone(value))
        },
        removeItem: key => db.delete(key)
      },
      onPluginEnter() {},
      showOpenDialog: () => dialogs.open,
      showSaveDialog: () => dialogs.save
    }
  }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(path.join(pluginDir, 'preload.js'), 'utf8'), context)
  return {
    dir,
    db,
    dialogs,
    services: context.window.services,
    failDb: key => {
      failedKey = key
    },
    failFile: file => {
      failedFile = file
    }
  }
}

function frontEnd(services) {
  const elements = new Map()
  const app = {
    innerHTML: '',
    addEventListener() {},
    querySelector: sel => elements.get(sel) || null
  }
  const context = {
    services,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
    document: { getElementById: () => app, addEventListener() {} },
    window: { addEventListener() {} }
  }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(path.join(pluginDir, 'app.js'), 'utf8'), context)
  return { context, app, elements }
}

try {
  const source = harness('source')
  const s = source.services

  // 迁移旧版配置时即使目录写入失败，仍允许打开设置修正目录。
  const legacy = harness('legacy-unwritable')
  legacy.db.set('tw_settings', {
    dataDir: legacy.dir,
    apiBase: 'https://example.invalid/v1',
    apiKey: 'test-only',
    model: 'legacy-model'
  })
  legacy.failFile(path.join(legacy.dir, 'config.json'))
  assert.strictEqual(legacy.services.getSettings().profiles[0].model, 'legacy-model')
  assert.match(legacy.services.getDataDirNotice(), /无法写入/)
  const legacyUi = frontEnd(legacy.services)
  vm.runInContext("switchView('settings')", legacyUi.context)
  assert.match(legacyUi.app.innerHTML, /legacy-model/)

  // 首次使用：空配置可打开设置并填写、保存，不需要预先存在 API 配置。
  const ui = frontEnd(s)
  vm.runInContext("switchView('settings')", ui.context)
  assert.match(ui.app.innerHTML, /配置 1/)
  assert.strictEqual(vm.runInContext('settingsDirty()', ui.context), false)
  const savebar = { hidden: false }
  const saveButton = { disabled: true }
  ui.elements.set('#settingsSavebar', savebar)
  ui.elements.set('[data-action="save-settings"]', saveButton)
  vm.runInContext('updateSavebar()', ui.context)
  assert.strictEqual(savebar.hidden, true)
  vm.runInContext("curProfile().name = '新服务'; updateSavebar()", ui.context)
  assert.strictEqual(savebar.hidden, false)
  assert.strictEqual(saveButton.disabled, false)
  vm.runInContext("curProfile().name = '配置 1'; updateSavebar()", ui.context)
  assert.strictEqual(savebar.hidden, true)
  assert.strictEqual(saveButton.disabled, true)
  vm.runInContext("S.settingsError = '保存失败'; updateSavebar()", ui.context)
  assert.strictEqual(savebar.hidden, false)
  vm.runInContext("S.settingsError = ''; updateSavebar()", ui.context)
  assert.strictEqual(savebar.hidden, true)

  vm.runInContext("S.settingsTab = 'backup'; render()", ui.context)
  assert.match(ui.app.innerHTML, /导出词库/)
  assert.match(ui.app.innerHTML, /data-action="import-library"/)
  vm.runInContext("S.settingsTab = 'ai'; render()", ui.context)
  vm.runInContext(
    "curProfile().apiBase = 'https://example.invalid/v1'; curProfile().apiKey = 'test-key'; curProfile().model = 'test-model'; saveSettingsUI()",
    ui.context
  )
  assert.strictEqual(s.getSettings().profiles[0].model, 'test-model')
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(source.dir, 'config.json'), 'utf8')).profiles.length,
    1
  )
  assert.strictEqual(
    fs.readFileSync(path.join(source.dir, 'prompts', 'system-prompt.md'), 'utf8'),
    core.DEFAULT_SYSTEM_PROMPT
  )
  assert.strictEqual(fs.existsSync(core.dailyPath(source.dir, today)), true)
  vm.runInContext('S.draft.activeProfile = 99; settingsView()', ui.context)
  assert.strictEqual(vm.runInContext('S.draft.activeProfile', ui.context), 0)

  // 重命名碰撞：报错之前不触碰 DB 或每日文件；普通编辑与唯一名称仍能同步。
  s.saveEntry(entry('alpha', '甲'), { word: 'ALPHA', sentence: 'Original alpha sentence.' })
  s.saveEntry(entry('beta', '乙'))
  const beforeDb = JSON.stringify([...source.db.entries()])
  const todayPath = core.dailyPath(source.dir, today)
  const beforeDaily = fs.readFileSync(todayPath, 'utf8')
  // preload 是持久化边界，不能仅依赖前端校验。
  assert.throws(() => s.saveEntry({ word: 'invalid' }), /trans/)
  assert.strictEqual(JSON.stringify([...source.db.entries()]), beforeDb)
  assert.strictEqual(fs.readFileSync(todayPath, 'utf8'), beforeDaily)
  assert.throws(() => s.updateEntry('alpha', entry(' beta ', '覆盖')), /词库已有「beta」/)
  assert.strictEqual(JSON.stringify([...source.db.entries()]), beforeDb)
  assert.strictEqual(fs.readFileSync(todayPath, 'utf8'), beforeDaily)
  s.updateEntry('alpha', entry('alpha', '甲更新'))
  assert.strictEqual(
    core.readDaily(source.dir, today).find(e => e.word === 'alpha').trans[0].cn,
    '甲更新'
  )
  s.updateEntry('alpha', entry('gamma', '丙'))
  assert.strictEqual(source.db.has('tw_e:alpha'), false)
  assert.strictEqual(
    core.readDaily(source.dir, today).some(e => e.word === 'gamma'),
    true
  )

  source.failFile(todayPath)
  assert.doesNotThrow(() => vm.runInContext("del('gamma')", ui.context))
  assert.match(ui.app.textContent, /删除失败.*已撤销/)
  assert.strictEqual(
    s.listEntries().some(r => r.word === 'gamma'),
    true
  )

  // 配置导出失败保留目标原文件，不留下半份含 Key 的 JSON。
  const configExport = path.join(temp, 'config-export.json')
  fs.writeFileSync(configExport, 'original')
  source.dialogs.save = configExport
  source.failFile(configExport)
  assert.throws(() => s.exportConfigFile(s.getSettings()), /模拟磁盘写入失败/)
  assert.strictEqual(fs.readFileSync(configExport, 'utf8'), 'original')

  // 无权限、磁盘满及 Windows 文件占用都可能导致写入失败；新增、更新、重命名、删除须回退。
  for (const operation of [
    () => s.saveEntry(entry('new-failed')),
    () => s.saveEntry(entry('gamma', '不应保存')),
    () => s.updateEntry('gamma', entry('gamma', '不应更新')),
    () => s.updateEntry('gamma', entry('renamed-failed')),
    () => s.deleteEntry('gamma')
  ]) {
    const beforeRecords = clone(s.listEntries())
    const beforeIndex = clone(source.db.get('tw_index'))
    const beforeFile = fs.readFileSync(todayPath, 'utf8')
    source.failFile(todayPath)
    assert.throws(operation, /已撤销本次词库修改/)
    assert.deepStrictEqual(clone(s.listEntries()), beforeRecords)
    assert.deepStrictEqual(clone(source.db.get('tw_index')), beforeIndex)
    assert.strictEqual(source.db.has('tw_e:new-failed'), false)
    assert.strictEqual(source.db.has('tw_e:renamed-failed'), false)
    assert.strictEqual(fs.readFileSync(todayPath, 'utf8'), beforeFile)
  }
  for (const key of ['tw_index', 'tw_e:db-failed']) {
    const beforeRecords = clone(s.listEntries())
    const beforeFile = fs.readFileSync(todayPath, 'utf8')
    source.failDb(key)
    assert.throws(() => s.saveEntry(entry('db-failed')), /已撤销本次词库修改/)
    assert.deepStrictEqual(clone(s.listEntries()), beforeRecords)
    assert.strictEqual(source.db.has('tw_e:db-failed'), false)
    assert.strictEqual(fs.readFileSync(todayPath, 'utf8'), beforeFile)
  }

  // 保存设置失败不能在文件、镜像或新目录中留下半套已生效配置。
  const settingsBefore = clone(s.getSettings())
  const configBefore = fs.readFileSync(path.join(source.dir, 'config.json'), 'utf8')
  source.failDb('tw_settings')
  assert.throws(
    () =>
      s.saveSettings({
        ...settingsBefore,
        profiles: [{ ...settingsBefore.profiles[0], name: '不应生效' }]
      }),
    /模拟数据库写入失败/
  )
  assert.deepStrictEqual(clone(s.getSettings()), settingsBefore)
  assert.strictEqual(fs.readFileSync(path.join(source.dir, 'config.json'), 'utf8'), configBefore)
  const failedDir = path.join(temp, 'failed-settings-dir')
  source.failFile(core.dailyPath(failedDir, today))
  assert.throws(() => s.saveSettings({ ...settingsBefore, dataDir: failedDir }), /模拟磁盘写入失败/)
  assert.deepStrictEqual(clone(s.getSettings()), settingsBefore)
  assert.strictEqual(fs.existsSync(path.join(failedDir, 'config.json')), false)

  // 历史词条与每日存档不同也必须分别保留；日期与采集原文参与迁移。
  source.db.set('tw_e:old', {
    word: 'old',
    rawWord: 'OLD',
    rawSentence: 'Original old sentence.',
    createdAt: historic,
    updatedAt: today,
    entry: entry('old', '当前历史释义')
  })
  source.db.set('tw_index', [...source.db.get('tw_index'), 'old'])
  core.writeDaily(source.dir, historic, [entry('old', '历史存档释义'), entry('archive-only')])
  fs.mkdirSync(path.join(source.dir, 'prompts'), { recursive: true })
  fs.writeFileSync(path.join(source.dir, 'prompts', 'system-prompt.md'), '自定义提示词')
  const backupPath = path.join(temp, 'library.json')
  source.dialogs.save = backupPath
  const exported = s.exportLibraryFile()
  assert.strictEqual(exported.count, 3)
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
  assert.strictEqual(backup.records.find(r => r.word === 'gamma').rawWord, 'ALPHA')
  assert.strictEqual(backup.daily[historic][0].trans[0].cn, '历史存档释义')
  assert.strictEqual(backup.prompt, '自定义提示词')
  assert.strictEqual(JSON.stringify(backup).includes('test-key'), false)

  // 在另一数据目录完整恢复，不依赖源机器路径或 API 配置。
  const target = harness('target')
  target.dialogs.open = [backupPath]
  assert.deepStrictEqual(clone(target.services.importLibraryFile()), { added: 3, skipped: 0 })
  assert.deepStrictEqual(clone(target.services.listEntries()), clone(s.listEntries()))
  assert.deepStrictEqual(core.readDaily(target.dir, historic), backup.daily[historic])
  assert.strictEqual(target.services.getDailyInfo().count, 2)
  assert.strictEqual(
    fs.readFileSync(path.join(target.dir, 'prompts', 'system-prompt.md'), 'utf8'),
    '自定义提示词'
  )
  assert.strictEqual(target.services.getSettings().dataDir, target.dir)

  // 重复导入及同名冲突不会覆盖当前内容；每日历史合并也保留已有内容。
  target.services.updateEntry('beta', entry('beta', '本机释义'))
  core.writeDaily(target.dir, historic, [entry('old', '本机存档释义'), entry('local-only')])
  fs.writeFileSync(path.join(target.dir, 'prompts', 'system-prompt.md'), '本机提示词')
  assert.deepStrictEqual(clone(target.services.importLibraryFile()), { added: 0, skipped: 3 })
  assert.strictEqual(target.db.get('tw_e:beta').entry.trans[0].cn, '本机释义')
  assert.strictEqual(
    core.readDaily(target.dir, historic).find(e => e.word === 'old').trans[0].cn,
    '本机存档释义'
  )
  assert.strictEqual(core.readDaily(target.dir, historic).length, 3)
  assert.strictEqual(
    fs.readFileSync(path.join(target.dir, 'prompts', 'system-prompt.md'), 'utf8'),
    '本机提示词'
  )

  // 恢复入口刷新词库与页面计数。
  const restoredUi = frontEnd(target.services)
  vm.runInContext(
    "switchView('settings'); S.settingsTab = 'data'; importLibrary()",
    restoredUi.context
  )
  assert.strictEqual(vm.runInContext('S.entries.length', restoredUi.context), 3)
  assert.match(restoredUi.app.innerHTML, /<strong>2<\/strong><span>个词条/)

  // 错误格式、重复记录、无效日期及非法路径在任何写入前被拒绝。
  const invalidPath = path.join(temp, 'invalid.json')
  const invalidCases = [
    [],
    { ...backup, version: 999 },
    { ...backup, records: [...backup.records, backup.records[0]] },
    { ...backup, records: [{ ...backup.records[0], createdAt: '2020-02-30' }] },
    { ...backup, records: [{ ...backup.records[0], word: 'mismatch' }] },
    { ...backup, daily: { '../outside': [] } },
    { ...backup, daily: { [historic]: [entry('duplicate'), entry('duplicate')] } },
    { ...backup, records: [{ ...backup.records[0], entry: { word: 'broken' } }] }
  ]
  const stableDb = JSON.stringify([...target.db.entries()])
  const stableDaily = fs.readFileSync(core.dailyPath(target.dir, today), 'utf8')
  target.dialogs.open = [invalidPath]
  for (const invalid of invalidCases) {
    fs.writeFileSync(invalidPath, JSON.stringify(invalid))
    assert.throws(() => target.services.importLibraryFile())
    assert.strictEqual(JSON.stringify([...target.db.entries()]), stableDb)
    assert.strictEqual(fs.readFileSync(core.dailyPath(target.dir, today), 'utf8'), stableDaily)
  }

  // 恢复途中失败应撤销已写入的数据；既有文件字节和索引恢复原样。
  for (const failure of ['file', 'record', 'index']) {
    const broken = harness('failure-' + failure)
    broken.services.saveEntry(entry('local'))
    core.writeDaily(broken.dir, historic, [entry('local-archive')])
    const oldDb = JSON.stringify([...broken.db.entries()])
    const oldToday = fs.readFileSync(core.dailyPath(broken.dir, today), 'utf8')
    const oldArchive = fs.readFileSync(core.dailyPath(broken.dir, historic), 'utf8')
    broken.dialogs.open = [backupPath]
    if (failure === 'file') broken.failFile(core.dailyPath(broken.dir, today))
    else broken.failDb(failure === 'index' ? 'tw_index' : 'tw_e:gamma')
    assert.throws(() => broken.services.importLibraryFile(), /已撤销本次恢复/)
    assert.strictEqual(JSON.stringify([...broken.db.entries()]), oldDb)
    assert.strictEqual(fs.readFileSync(core.dailyPath(broken.dir, today), 'utf8'), oldToday)
    assert.strictEqual(fs.readFileSync(core.dailyPath(broken.dir, historic), 'utf8'), oldArchive)
    assert.strictEqual(fs.existsSync(path.join(broken.dir, 'prompts', 'system-prompt.md')), false)
  }

  target.dialogs.open = null
  assert.strictEqual(target.services.importLibraryFile(), null)
  target.dialogs.save = null
  assert.strictEqual(target.services.exportLibraryFile(), null)
  console.log('✓ 首次配置、重命名冲突、完整词库迁移、合并去重、错误校验与失败回退测试通过')
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
