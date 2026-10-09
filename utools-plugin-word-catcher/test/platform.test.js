'use strict'
// 模拟两平台的宿主路径/API，所有文件均在内存中；不读取真实配置或 API Key。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const core = require('../lib/core.js')
const library = require('../lib/library.js')
const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8')
const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))
const profile = {
  name: '迁移测试',
  apiBase: 'https://example.invalid/v1',
  apiKey: 'test-only',
  model: 'demo',
  models: []
}

function harness(platform, documents, raw, legacyHost = false) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const files = new Map()
  const db = new Map(raw ? [['tw_settings', raw]] : [])
  let dialog
  const context = {
    URL,
    Buffer,
    window: {},
    require: name => {
      if (name === 'process') return { platform }
      if (name === 'path') return paths
      if (name === 'os')
        return { homedir: () => (platform === 'win32' ? 'C:\\Users\\Test' : '/Users/Test') }
      if (name === 'fs')
        return {
          existsSync: target => files.has(target),
          readFileSync: target => {
            if (!files.has(target)) throw new Error('ENOENT')
            return files.get(target)
          }
        }
      if (name === './lib/core.js')
        return { ...core, dailyPath: (dir, date) => paths.join(dir, 'daily', date + '.json') }
      if (name === './lib/library.js')
        return { ...library, writeAtomic: (target, content) => files.set(target, content) }
      return require(name)
    },
    utools: {
      ...(!legacyHost
        ? {
            getPath: name => {
              assert.strictEqual(name, 'documents')
              return documents
            }
          }
        : {}),
      onPluginEnter() {},
      showOpenDialog: options => {
        dialog = options
        return [documents]
      },
      dbStorage: {
        getItem: key => (db.has(key) ? clone(db.get(key)) : null),
        setItem: (key, val) => db.set(key, clone(val)),
        removeItem: key => db.delete(key)
      }
    }
  }
  vm.createContext(context)
  vm.runInContext(preload, context)
  return { services: context.window.services, files, db, paths, dialog: () => dialog }
}

for (const platform of ['darwin', 'win32']) {
  const documents = platform === 'win32' ? 'D:\\OneDrive\\文档' : '/Users/Test/iCloud 文档'
  const h = harness(platform, documents)
  const expected = h.paths.join(documents, 'MyTypeWords', 'typewords-data')
  assert.strictEqual(h.services.getSettings().dataDir, expected)
  assert.strictEqual(h.services.getPlatform(), platform)
  h.services.pickDataDir(expected)
  assert.deepStrictEqual(
    clone(h.dialog().properties),
    platform === 'darwin' ? ['openDirectory', 'createDirectory'] : ['openDirectory']
  )

  // 从另一操作系统同步来的目录不用于本机读写，配置仍可使用。
  const foreign = platform === 'win32' ? '/Users/Old/Documents/词库' : 'C:\\Users\\Old\\词库'
  const migrated = harness(platform, documents, {
    profiles: [profile],
    activeProfile: 0,
    dataDir: foreign
  })
  assert.strictEqual(migrated.services.getSettings().dataDir, expected)
  assert.strictEqual(migrated.services.getSettings().profiles[0].model, 'demo')
  assert.match(migrated.services.getDataDirNotice(), /不适用于本机/)
  assert.throws(
    () => migrated.services.saveSettings({ profiles: [profile], dataDir: foreign }),
    /本机/
  )
  assert.throws(
    () => migrated.services.saveSettings({ profiles: [], dataDir: 'relative/folder' }),
    /绝对/
  )
  assert.throws(
    () => migrated.services.saveSettings({ profiles: [], dataDir: expected + '\0' }),
    /绝对/
  )

  // 复制 config.json 到新目录后，文件内的旧 dataDir 不得将路径重新带回旧电脑。
  h.db.set('tw_settings', { profiles: [], dataDir: expected })
  h.files.set(
    h.paths.join(expected, 'config.json'),
    JSON.stringify({ profiles: [profile], dataDir: foreign })
  )
  const loaded = h.services.getSettings()
  assert.strictEqual(loaded.dataDir, expected)
  assert.strictEqual(loaded.profiles[0].name, '迁移测试')
  h.services.saveSettings(loaded)
  assert.strictEqual(
    JSON.parse(h.files.get(h.paths.join(expected, 'config.json'))).dataDir,
    expected
  )
  migrated.services.saveSettings({ profiles: [profile], dataDir: expected })
  assert.strictEqual(migrated.services.getDataDirNotice(), '')

  // 文件名和快捷键在前端按平台显示。
  const domApp = {
    innerHTML: '',
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  }
  const front = {
    URL,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    document: { getElementById: id => (id === 'app' ? domApp : {}), addEventListener() {} },
    window: { addEventListener() {} },
    services: {
      getSettings: () => loaded,
      getPlatform: () => platform,
      listEntries: () => [],
      getHistoryRecoveryInfo: () => ({ count: 0, errors: [] }),
      getDailyInfo: () => ({ count: 0, path: h.paths.join(expected, 'daily', '2026-10-09.json') })
    }
  }
  vm.createContext(front)
  vm.runInContext(appSource, front)
  assert.strictEqual(
    vm.runInContext("baseName('C:\\\\词库\\\\daily\\\\2026-10-09.json')", front),
    '2026-10-09.json'
  )
  assert.strictEqual(
    vm.runInContext("baseName('/Users/Test/daily/2026-10-09.json')", front),
    '2026-10-09.json'
  )
  assert.strictEqual(
    vm.runInContext('saveShortcut()', front),
    platform === 'darwin' ? '⌘ ↵' : 'Ctrl ↵'
  )

  const fallback = harness(platform, documents, null, true)
  assert.strictEqual(
    fallback.services.getSettings().dataDir,
    fallback.paths.join(
      platform === 'win32' ? 'C:\\Users\\Test' : '/Users/Test',
      'Documents',
      'MyTypeWords',
      'typewords-data'
    )
  )
}
const unc = harness('win32', '\\\\NAS\\Share\\词库')
assert.strictEqual(
  unc.services.getSettings().dataDir,
  '\\\\NAS\\Share\\词库\\MyTypeWords\\typewords-data'
)
unc.services.saveSettings({ profiles: [], dataDir: '\\\\NAS\\Share\\词库' })
console.log(
  '✓ Win/Mac 路径、重定向文档、UNC 目录、配置迁移、目录对话框及快捷键测试通过（模拟宿主）'
)
