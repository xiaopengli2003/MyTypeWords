'use strict'
// 词捕 · preload：Node 侧能力（多套 API 配置、AI 调用、本地库、每日文件）暴露给前端

const core = require('./lib/core.js')
const library = require('./lib/library.js')
const fs = require('fs')
const path = require('path')
const platform = require('process').platform

function isLocalDataDir(value) {
  if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value)) return false
  // Windows 的根路径（如 /Users/old）缺少盘符，不能作为迁移后的本机目录。
  if (platform === 'win32') return /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value)
  return value.startsWith('/')
}

function defaultDataDir() {
  let documents
  try {
    documents = typeof utools.getPath === 'function' && utools.getPath('documents')
  } catch (e) {
    /* 兼容旧宿主 */
  }
  if (!isLocalDataDir(documents)) documents = path.join(require('os').homedir(), 'Documents')
  return path.join(documents, 'MyTypeWords', 'typewords-data')
}
let dataDirNotice = ''

const SETTINGS_KEY = 'tw_settings'
const INDEX_KEY = 'tw_index'
const ENTRY_PREFIX = 'tw_e:'
let nativeDialogDepth = 0
let nativeDialogClosedAt = 0
function nativeDialog(kind, options) {
  nativeDialogDepth++
  try {
    return utools[kind](options)
  } finally {
    nativeDialogDepth--
    nativeDialogClosedAt = Date.now()
  }
}

const DEFAULT_SETTINGS = {
  profiles: [],
  activeProfile: 0,
  dataDir: defaultDataDir()
}

// ---------- 设置（多套 API 配置；持久化为 数据目录/config.json，uTools 本地库保镜像） ----------

const CONFIG_VERSION = 1

function normalizeApiBase(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|models)$/i, '')
}

function validateProfile(p, needModel = true) {
  if (!p || !p.apiBase) throw new Error('请填写 API 基础地址')
  let url
  try {
    url = new URL(normalizeApiBase(p.apiBase))
  } catch (e) {
    throw new Error('API 地址无效，请使用完整的 http:// 或 https:// 地址')
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('API 地址必须使用 http:// 或 https://')
  if (!p.apiKey && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('远程服务需要填写 API Key')
  if (needModel && !p.model) throw new Error('请选择或填写模型 ID')
}

function guessName(apiBase) {
  if (/bigmodel|zhipu/i.test(apiBase)) return '智谱 GLM'
  if (/deepseek/i.test(apiBase)) return 'DeepSeek'
  return '自定义'
}

// 任意来源（本地库 / config.json / 导入文件）→ 规范结构，剔除未知字段
function normalizeSettings(s) {
  s = s || {}
  const out = {
    version: CONFIG_VERSION,
    profiles: [],
    activeProfile: 0,
    dataDir:
      typeof s.dataDir === 'string' && s.dataDir.trim()
        ? s.dataDir.trim()
        : DEFAULT_SETTINGS.dataDir
  }
  const think = v => (['off', 'low', 'medium', 'high'].includes(v) ? v : 'off')
  if (Array.isArray(s.profiles) && s.profiles.length) {
    out.profiles = s.profiles.map(p => ({
      name: String((p && p.name) || '').slice(0, 50) || '配置',
      apiBase: normalizeApiBase(p && p.apiBase),
      apiKey: String((p && p.apiKey) || '').trim(),
      model: String((p && p.model) || '').trim(),
      thinking: think(p && p.thinking),
      models: Array.isArray(p && p.models)
        ? [
            ...new Set(
              p.models
                .filter(m => typeof m === 'string')
                .map(m => m.trim())
                .filter(Boolean)
            )
          ].sort((a, b) => a.localeCompare(b))
        : []
    }))
    out.activeProfile =
      Number.isInteger(s.activeProfile) &&
      s.activeProfile >= 0 &&
      s.activeProfile < out.profiles.length
        ? s.activeProfile
        : 0
  } else if (s.apiBase || s.apiKey) {
    // 旧版单配置自动迁移为第一个配置
    out.profiles = [
      {
        name: guessName(s.apiBase || ''),
        apiBase: normalizeApiBase(s.apiBase),
        apiKey: String(s.apiKey || '').trim(),
        model: String(s.model || '').trim(),
        thinking: think(s.thinking),
        models: []
      }
    ]
  }
  return out
}

const configPath = dataDir => path.join(dataDir, 'config.json')

function loadSettings() {
  const raw = utools.dbStorage.getItem(SETTINGS_KEY)
  const mirror = normalizeSettings(raw)
  if (!isLocalDataDir(mirror.dataDir)) {
    mirror.dataDir = DEFAULT_SETTINGS.dataDir
    dataDirNotice = '原数据目录不适用于本机，已使用本机文档目录。请确认目录或恢复词库。'
  }
  // 旧版单配置：统一格式并立即落盘 config.json，随后读取（数据目录未变，文件读取与回落一致）
  if (mirror.profiles.length && (!raw || !Array.isArray(raw.profiles))) {
    try {
      return saveSettings(mirror)
    } catch (err) {
      // 新电脑目录权限不足时仍能进入设置、重新选择目录，不能在启动时白屏。
      dataDirNotice = '旧版配置已载入，数据目录无法写入。请确认目录后保存设置。'
      return mirror
    }
  }
  // config.json 为准（可跨机迁移、可手工编辑）；不可读时回落镜像
  try {
    // 目录随电脑变化：配置属于当前打开的目录，不能跳回文件内记录的旧电脑路径。
    const fromFile = normalizeSettings({
      ...JSON.parse(fs.readFileSync(configPath(mirror.dataDir), 'utf8')),
      dataDir: mirror.dataDir
    })
    if (fromFile.profiles.length) {
      utools.dbStorage.setItem(SETTINGS_KEY, fromFile) // 刷新镜像
      return fromFile
    }
  } catch (e) {
    /* 无配置文件 → 用镜像，保存时落盘 */
  }
  return mirror
}

function saveSettings(s) {
  let n = normalizeSettings(s)
  if (!isLocalDataDir(n.dataDir)) throw new Error('请选择本机的绝对数据目录路径')
  n.dataDir = path.normalize(n.dataDir)
  // 目标目录已有含 API 配置（如重新指向迁移过来的词库文件夹）且当前为空 → 采用已有配置，防止覆盖
  try {
    const existing = normalizeSettings(JSON.parse(fs.readFileSync(configPath(n.dataDir), 'utf8')))
    if (!n.profiles.length && existing.profiles.length) {
      n = Object.assign({}, existing, { dataDir: n.dataDir })
    }
  } catch (e) {
    /* 目标目录无配置 → 正常写入 */
  }
  for (const p of n.profiles) {
    if (!p.apiBase) continue // 允许保存尚未填写完成的配置以及独立的数据目录设置。
    let url
    try {
      url = new URL(p.apiBase)
    } catch (e) {
      throw new Error(`「${p.name}」的 API 地址无效`)
    }
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error(`「${p.name}」的地址必须使用 http:// 或 https://`)
  }
  // 写入失败明确提示；配置文件与本地镜像保持一致。
  const target = configPath(n.dataDir)
  const oldMirror = utools.dbStorage.getItem(SETTINGS_KEY)
  const files = [{ path: target, content: JSON.stringify(n, null, 2) + '\n' }]
  const today = core.todayStr()
  if (
    !oldMirror ||
    oldMirror.dataDir !== n.dataDir ||
    !fs.existsSync(core.dailyPath(n.dataDir, today))
  ) {
    const entries = listEntries()
      .filter(r => r.createdAt === today)
      .map(r => r.entry)
    files.push({
      path: core.dailyPath(n.dataDir, today),
      content: JSON.stringify(entries, null, 2) + '\n'
    })
  }
  const prompt = path.join(n.dataDir, 'prompts', 'system-prompt.md')
  if (!fs.existsSync(prompt)) files.push({ path: prompt, content: core.DEFAULT_SYSTEM_PROMPT })
  const snapshots = files.map(file => ({
    ...file,
    before: fs.existsSync(file.path) ? fs.readFileSync(file.path) : null
  }))
  const written = []
  let mirrorTouched = false
  try {
    for (const file of snapshots) {
      library.writeAtomic(file.path, file.content)
      written.push(file)
    }
    mirrorTouched = true
    utools.dbStorage.setItem(SETTINGS_KEY, n)
  } catch (err) {
    const errors = []
    const rollback = fn => {
      try {
        fn()
      } catch (e) {
        errors.push(e.message)
      }
    }
    if (mirrorTouched)
      rollback(() => {
        if (oldMirror == null) utools.dbStorage.removeItem(SETTINGS_KEY)
        else utools.dbStorage.setItem(SETTINGS_KEY, oldMirror)
      })
    for (const file of written.reverse())
      rollback(() => {
        if (file.before === null) fs.unlinkSync(file.path)
        else library.writeAtomic(file.path, file.before)
      })
    if (errors.length) throw new Error(`${err.message}；部分设置回退失败：${errors.join('；')}`)
    throw err
  }
  dataDirNotice = ''
  return n
}

function activeProfile() {
  const s = loadSettings()
  return s.profiles[s.activeProfile]
}

// ---------- 配置备份（选择文件夹 / 导出 / 导入） ----------

function pickDataDir(current) {
  const res = nativeDialog('showOpenDialog', {
    defaultPath: current,
    properties: platform === 'darwin' ? ['openDirectory', 'createDirectory'] : ['openDirectory']
  })
  return Array.isArray(res) && res[0] ? res[0] : null
}

function exportConfigFile(s) {
  const target = nativeDialog('showSaveDialog', {
    defaultPath: '词捕-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!target) return null
  library.writeAtomic(target, JSON.stringify(normalizeSettings(s), null, 2) + '\n')
  return target
}

function importConfigFile() {
  const res = nativeDialog('showOpenDialog', {
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (!Array.isArray(res) || !res[0]) return null
  const raw = JSON.parse(fs.readFileSync(res[0], 'utf8'))
  const n = normalizeSettings({ ...raw, dataDir: loadSettings().dataDir })
  if (!n.profiles.length) throw new Error('配置文件中没有 API 配置')
  return saveSettings(n)
}

// system prompt 存放在 数据目录/prompts/system-prompt.md，用户可自行润色，改完即生效
function getPrompt(settings) {
  try {
    const t = fs.readFileSync(path.join(settings.dataDir, 'prompts', 'system-prompt.md'), 'utf8')
    if (t.trim().length > 100) return t
  } catch (e) {
    /* 回落到内置默认 */
  }
  return core.DEFAULT_SYSTEM_PROMPT
}

// ---------- LLM 调用（OpenAI 兼容，Node http 直连无 CORS） ----------

// 两类请求共用编码、超时和断流处理，避免 UTF-8 分片损坏或响应中断后悬挂。
function httpJson(urlStr, apiKey, { method = 'GET', body, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(urlStr)
    } catch (err) {
      return reject(new Error('API 地址无效：' + urlStr))
    }
    const transport = url.protocol === 'http:' ? require('http') : require('https')
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = transport.request(
      {
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        timeout,
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {})
        }
      },
      res => {
        let text = ''
        // 由流解码器保留跨包的字符字节，不能逐个 Buffer 转成字符串。
        res.setEncoding('utf8')
        res.on('data', chunk => {
          text += chunk
        })
        res.on('error', reject)
        res.on('aborted', () => reject(new Error('API 响应中断，请重试')))
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}：${text.slice(0, 200)}`))
          }
          try {
            resolve(JSON.parse(text))
          } catch (err) {
            reject(new Error('API 返回非 JSON：' + text.slice(0, 200)))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    req.end(data)
  })
}

// 思考模式 → 按接口类型映射：智谱 GLM 用 thinking 开关；其他 OpenAI 兼容接口用 reasoning_effort
function applyThinking(payload, p) {
  const depth = p.thinking || 'off'
  let host = ''
  try {
    host = new URL(p.apiBase).hostname
  } catch (e) {
    /* 地址异常时不附加 */
  }
  if (/bigmodel|zhipu/i.test(host)) {
    payload.thinking = { type: depth === 'off' ? 'disabled' : 'enabled' }
  } else if (depth !== 'off') {
    payload.reasoning_effort = depth
  }
}

async function chat(p, messages, maxTokens) {
  validateProfile(p)
  const url = normalizeApiBase(p.apiBase) + '/chat/completions'
  const payload = { model: p.model.trim(), temperature: 0.3, messages }
  applyThinking(payload, p)
  if (maxTokens) payload.max_tokens = maxTokens
  const res = await httpJson(url, p.apiKey, { method: 'POST', body: payload, timeout: 90000 })
  const content =
    res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content
  if (typeof content !== 'string')
    throw new Error('API 返回结构异常：' + JSON.stringify(res).slice(0, 200))
  return content
}

// 从服务商接口拉取可用模型列表（OpenAI 兼容 GET /models），按服务商自动适配
async function fetchModels(p) {
  validateProfile(p, false)
  const url = normalizeApiBase(p.apiBase) + '/models'
  let res
  try {
    res = await httpJson(url, p.apiKey)
  } catch (err) {
    const m = /HTTP (\d{3})/.exec(String((err && err.message) || ''))
    if (m) {
      const code = +m[1]
      if (code === 401 || code === 403) throw new Error('API Key 无效或无权限，请检查 Key')
      if (code === 404) throw new Error('该服务商不支持获取模型列表，请手动填写模型 ID')
    }
    throw err
  }
  // 兼容 { data: [{ id }] }、裸对象数组、纯字符串数组等返回形态
  const list = Array.isArray(res) ? res : Array.isArray(res && res.data) ? res.data : []
  const ids = [
    ...new Set(
      list
        .map(m => (typeof m === 'string' ? m : m && (m.id || m.model)) || '')
        .filter(x => typeof x === 'string')
        .map(x => x.trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b))
  if (!ids.length) throw new Error('该服务商未返回模型列表，请手动填写模型 ID')
  return ids
}

// 生成词条；输出解析失败自动补救重试一次
async function generateEntry(input) {
  const s = loadSettings()
  const p = activeProfile()
  validateProfile(p)
  core.ensureDirs(s.dataDir)
  const messages = [
    { role: 'system', content: getPrompt(s) },
    {
      role: 'user',
      content:
        '输入：' +
        JSON.stringify({ word: input.word, sentence: input.sentence || null }) +
        '\n请生成词条 JSON。'
    }
  ]
  const content = await chat(p, messages)
  try {
    return core.validateEntry(core.extractJson(content))
  } catch (err) {
    messages.push(
      { role: 'assistant', content },
      {
        role: 'user',
        content: `你的输出无法解析（${err.message}）。请重新输出：只输出一个符合 Schema 的 JSON 对象，不要任何其他文字。`
      }
    )
    return core.validateEntry(core.extractJson(await chat(p, messages)))
  }
}

async function testConnection(p) {
  validateProfile(p)
  const t0 = Date.now()
  const reply = await chat(p, [{ role: 'user', content: '请只回复两个字母：OK' }], 256)
  return { ms: Date.now() - t0, reply: reply.trim().slice(0, 50) }
}

// ---------- 本地词条库（uTools db）+ 每日文件同步 ----------

function getIndex() {
  return utools.dbStorage.getItem(INDEX_KEY) || []
}
function putIndex(idx) {
  utools.dbStorage.setItem(INDEX_KEY, idx)
}
function getRecord(word) {
  return utools.dbStorage.getItem(ENTRY_PREFIX + word)
}

function listEntries() {
  return getIndex()
    .map(w => getRecord(w))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt + b.updatedAt).localeCompare(a.createdAt + a.updatedAt))
}

// 用 db 中「今日创建」的词条重建当日文件（db 为主，文件为导出视图）
function rebuildTodayFile(dataDir) {
  const today = core.todayStr()
  const list = listEntries()
    .filter(r => r.createdAt === today)
    .map(r => r.entry)
  core.ensureDirs(dataDir)
  library.writeAtomic(core.dailyPath(dataDir, today), JSON.stringify(list, null, 2) + '\n')
  return { path: core.dailyPath(dataDir, today), count: list.length }
}

// 目录无权限、磁盘满或 Windows 文件占用时，不能留下“提示失败却已修改”的词库。
function mutateEntries(words, mutate, syncToday) {
  const dataDir = syncToday ? loadSettings().dataDir : null
  const index = getIndex().slice()
  const before = [...new Set(words)].map(word => ({ word, record: getRecord(word) }))
  try {
    mutate()
    return syncToday ? rebuildTodayFile(dataDir) : null
  } catch (err) {
    const errors = []
    for (const item of before) {
      try {
        if (item.record == null) utools.dbStorage.removeItem(ENTRY_PREFIX + item.word)
        else utools.dbStorage.setItem(ENTRY_PREFIX + item.word, item.record)
      } catch (e) {
        errors.push(e.message)
      }
    }
    try {
      putIndex(index)
    } catch (e) {
      errors.push(e.message)
    }
    throw new Error(
      `${err.message}；${errors.length ? '部分词库回退失败：' + errors.join('；') : '已撤销本次词库修改'}`
    )
  }
}

function saveEntry(entry, raw) {
  entry = core.validateEntry(entry)
  const today = core.todayStr()
  const old = getRecord(entry.word)
  const record = {
    word: entry.word,
    rawWord: (raw && raw.word) || (old && old.rawWord) || entry.word,
    rawSentence: (raw && raw.sentence) || (old && old.rawSentence) || '',
    createdAt: old ? old.createdAt : today,
    updatedAt: today,
    entry
  }
  const file = mutateEntries(
    [entry.word],
    () => {
      utools.dbStorage.setItem(ENTRY_PREFIX + entry.word, record)
      const idx = getIndex()
      if (!idx.includes(entry.word)) {
        idx.push(entry.word)
        putIndex(idx)
      }
    },
    true
  )
  return { record, file }
}

function updateEntry(oldWord, entry) {
  entry = core.validateEntry(entry)
  const old = getRecord(oldWord)
  if (!old) throw new Error('词条不存在：' + oldWord)
  if (entry.word !== oldWord && getRecord(entry.word)) {
    throw new Error(`词库已有「${entry.word}」，请使用其他名称；两个词条均已保留`)
  }
  const record = Object.assign({}, old, { word: entry.word, entry, updatedAt: core.todayStr() })
  // 只同步当日文件；历史文件视为已导入存档，不做回写
  return mutateEntries(
    [oldWord, entry.word],
    () => {
      utools.dbStorage.removeItem(ENTRY_PREFIX + oldWord)
      const idx = getIndex().filter(w => w !== oldWord)
      if (!idx.includes(entry.word)) idx.push(entry.word)
      putIndex(idx)
      utools.dbStorage.setItem(ENTRY_PREFIX + entry.word, record)
    },
    record.createdAt === core.todayStr()
  )
}

function deleteEntry(word) {
  const rec = getRecord(word)
  if (!rec) return null
  return mutateEntries(
    [word],
    () => {
      utools.dbStorage.removeItem(ENTRY_PREFIX + word)
      putIndex(getIndex().filter(w => w !== word))
    },
    rec.createdAt === core.todayStr()
  )
}

function getDailyInfo() {
  const s = loadSettings()
  const today = core.todayStr()
  return {
    path: core.dailyPath(s.dataDir, today),
    count: core.readDaily(s.dataDir, today).length
  }
}

function getHistoryRecoveryInfo() {
  const result = library.readHistory(loadSettings().dataDir, listEntries())
  return { count: result.records.length, errors: result.errors }
}

function recoverHistoryFiles() {
  const result = library.readHistory(loadSettings().dataDir, listEntries())
  if (result.errors.length) throw new Error('请先修复历史文件：' + result.errors.join('；'))
  if (!result.records.length) return { added: 0, skipped: 0 }
  // 每日文件仍是存档，不回写；日期和最新存档内容带入主词库。
  return restoreLibrary({
    type: 'typewords-library',
    version: 1,
    records: result.records,
    daily: {},
    prompt: null
  })
}

// 词库备份只包含词条、每日存档和提示词，API 设置由配置备份单独迁移。
function exportLibraryFile() {
  const backup = library.createBackup(loadSettings().dataDir, listEntries())
  const target = nativeDialog('showSaveDialog', {
    defaultPath: `词捕-词库-${core.todayStr()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (!target) return null
  library.writeAtomic(target, JSON.stringify(backup, null, 2) + '\n')
  return { path: target, count: backup.records.length }
}

function importLibraryFile() {
  const res = nativeDialog('showOpenDialog', {
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (!Array.isArray(res) || !res[0]) return null
  const raw = JSON.parse(fs.readFileSync(res[0], 'utf8'))
  return restoreLibrary(raw)
}

function restoreLibrary(raw) {
  const plan = library.prepareImport(loadSettings().dataDir, raw, listEntries())
  const oldIndex = utools.dbStorage.getItem(INDEX_KEY)
  const changes = plan.added.map(r => ({
    key: ENTRY_PREFIX + r.word,
    before: getRecord(r.word),
    after: r
  }))
  // 索引遗漏但本地库仍有同名记录时也不覆盖。
  if (changes.some(c => c.before)) throw new Error('词库索引与记录不一致，请先检查本地词库')
  const snapshots = plan.files.map(file => ({
    ...file,
    before: fs.existsSync(file.path) ? fs.readFileSync(file.path) : null
  }))
  const writtenFiles = []
  const writtenRecords = []
  let indexTouched = false
  try {
    for (const file of snapshots) {
      library.writeAtomic(file.path, file.content)
      writtenFiles.push(file)
    }
    for (const change of changes) {
      writtenRecords.push(change)
      utools.dbStorage.setItem(change.key, change.after)
    }
    indexTouched = true
    putIndex(getIndex().concat(plan.added.map(r => r.word)))
  } catch (err) {
    const rollbackErrors = []
    const rollback = fn => {
      try {
        fn()
      } catch (e) {
        rollbackErrors.push(e.message)
      }
    }
    for (const change of writtenRecords.reverse())
      rollback(() => utools.dbStorage.removeItem(change.key))
    if (indexTouched)
      rollback(() => {
        if (oldIndex == null) utools.dbStorage.removeItem(INDEX_KEY)
        else putIndex(oldIndex)
      })
    for (const file of writtenFiles.reverse())
      rollback(() => {
        if (file.before === null) fs.unlinkSync(file.path)
        else library.writeAtomic(file.path, file.before)
      })
    if (rollbackErrors.length)
      throw new Error(`${err.message}；部分数据回退失败：${rollbackErrors.join('；')}`)
    throw new Error(`${err.message}；已撤销本次恢复`)
  }
  return { added: plan.added.length, skipped: plan.skipped }
}

// 本地脚本可将已授权导入放在此文件；成功后归档，避免删除词条后再次自动添加。
function initializeLibrary() {
  const pending = path.join(loadSettings().dataDir, 'pending-library.json')
  if (!fs.existsSync(pending)) return null
  const result = restoreLibrary(JSON.parse(fs.readFileSync(pending, 'utf8')))
  fs.renameSync(pending, pending.replace('.json', `.applied-${Date.now()}.json`))
  return result
}

function showDailyFile() {
  const settings = loadSettings()
  const result = rebuildTodayFile(settings.dataDir)
  utools.shellShowItemInFolder(result.path)
}

function showPromptFile() {
  const target = path.join(loadSettings().dataDir, 'prompts', 'system-prompt.md')
  if (!fs.existsSync(target)) library.writeAtomic(target, core.DEFAULT_SYSTEM_PROMPT)
  utools.shellShowItemInFolder(target)
}

async function openDataFolder() {
  const dataDir = loadSettings().dataDir
  // 首次安装尚未保存词条时目录也能打开；不提前写入或覆盖服务配置。
  core.ensureDirs(dataDir)
  if (typeof utools.shellOpenPath === 'function') {
    const error = await utools.shellOpenPath(dataDir)
    if (error) throw new Error(error)
  } else {
    utools.shellShowItemInFolder(dataDir)
  }
}

// 隐藏主窗口后退出插件，下一次呼出回到 uTools 搜索框。
// 不监听 blur：文件对话框、切换焦点等不等同于收起主窗口。
let pluginActive = false
function isMainWindow() {
  return typeof utools.getWindowType === 'function' && utools.getWindowType() === 'main'
}
function leavePlugin() {
  if (!pluginActive || typeof utools.outPlugin !== 'function') return false
  pluginActive = false // outPlugin 也可能触发可见性变化，先防止重入。
  try {
    utools.outPlugin()
    return true
  } catch (err) {
    pluginActive = true
    throw err
  }
}
function closeToUtools() {
  if (!isMainWindow() || typeof utools.hideMainWindow !== 'function') return false
  if (!leavePlugin()) return false
  utools.hideMainWindow()
  return true
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    // macOS 完全遮挡也会报告 hidden；保护原生对话框及其关闭后延迟送达的事件。
    if (
      document.visibilityState === 'hidden' &&
      pluginActive &&
      !nativeDialogDepth &&
      Date.now() - nativeDialogClosedAt > 500 &&
      isMainWindow()
    ) {
      try {
        leavePlugin()
      } catch (err) {
        /* 宿主已关闭时不阻止退出 */
      }
    }
  })
}
if (typeof utools.onPluginOut === 'function')
  utools.onPluginOut(() => {
    pluginActive = false
  })

// ---------- 暴露给前端 ----------

window.services = {
  getPlatform: () => platform,
  getDataDirNotice: () => dataDirNotice,
  normalizeWord: core.normalizeWord,
  cleanSentence: core.cleanText,
  tokenize: core.tokenize,
  validateEntry: e => core.validateEntry(e),
  getSettings: loadSettings,
  saveSettings,
  generateEntry,
  testConnection,
  fetchModels,
  saveEntry,
  updateEntry,
  deleteEntry,
  listEntries,
  getDailyInfo,
  getHistoryRecoveryInfo,
  recoverHistoryFiles,
  pickDataDir,
  exportConfigFile,
  importConfigFile,
  exportLibraryFile,
  importLibraryFile,
  initializeLibrary,
  showDailyFile,
  showPromptFile,
  closeToUtools,
  openDataFolder
}

utools.onPluginEnter(({ code, type, payload }) => {
  pluginActive = true
  try {
    if (typeof utools.setExpandHeight === 'function') utools.setExpandHeight(620)
    else if (typeof utools.setExpendHeight === 'function') utools.setExpendHeight(620)
  } catch (e) {
    /* 分离窗口中高度由窗口自身管理 */
  }
  // text 类型的 payload 是功能指令名称（例如“词捕”），不是待收录文本。
  const hasContent = type === 'over' || type === 'regex' || (!type && code === 'capture-text')
  window.dispatchEvent(
    new CustomEvent('tw-enter', {
      detail: { code, type, text: hasContent && typeof payload === 'string' ? payload : '' }
    })
  )
})
