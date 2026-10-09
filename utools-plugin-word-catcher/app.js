'use strict'
/* 词捕 · 前端：词库（主页/搜索/编辑）· 导入词（划词或手动）· 设置（多套 API 配置） */

const app = document.getElementById('app')

// 常用操作图标（feather 风格线性图标）
const ICONS = {
  eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  refresh:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  spinner:
    '<svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>'
}

function icon(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    trash: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
    file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h5"/>',
    prompt: '<path d="M4 4h16v12H8l-4 4zM8 8h8M8 12h5"/>',
    archive: '<path d="M3 4h18v4H3zM5 8v13h14V8M9 12h6"/>',
    sliders: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>'
  }
  return `<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`
}

const S = {
  view: 'list', // list | capture | settings
  mode: null, // 导入词：null | 'word' | 'sentence'
  payload: '', // 输入区内容（划词预填或手动输入）
  word: '',
  generating: false,
  entry: null, // 编辑器中的词条对象
  regen: null, // {word, sentence} 生成时的原始输入，供重新生成
  entries: [],
  search: '',
  dayExpanded: Object.create(null),
  searchDayExpanded: Object.create(null),
  historyRecovery: { count: 0, errors: [] },
  editWord: null, // 词库页编辑中的旧 word
  advanced: false,
  settingsTab: 'ai',
  profileIndex: 0,
  modelOpen: false,
  modelQuery: '',
  modeManual: false,
  generationId: 0,
  captureError: '',
  settingsError: '',
  profileStates: new WeakMap(),
  draft: null, // 设置页编辑草稿（整个 settings 结构）
  settings: null
}

// ---------- 工具 ----------

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}
function toast(msg, ok = true) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = 'toast show' + (ok ? '' : ' err')
  clearTimeout(t._h)
  t._h = setTimeout(() => {
    t.className = 'toast'
  }, 2600)
}
// 原生文件操作可能因目录权限、文件占用或宿主状态失败，统一反馈到页面。
async function fileAction(action, label) {
  try {
    await action()
  } catch (err) {
    toast(label + '失败：' + err.message, false)
  }
}
function saveShortcut() {
  const platform =
    typeof services.getPlatform === 'function'
      ? services.getPlatform()
      : typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
        ? 'darwin'
        : 'win32'
  return platform === 'darwin' ? '⌘ ↵' : 'Ctrl ↵'
}
function dataDirNoticeHTML() {
  const message = typeof services.getDataDirNotice === 'function' ? services.getDataDirNotice() : ''
  return message
    ? `<div class="notice" role="status">${esc(message)} <button class="link" data-action="configure-data">确认目录</button></div>`
    : ''
}
const baseName = p =>
  String(p || '')
    .split(/[\\/]/)
    .pop()
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 渲染 ----------

function header() {
  return `<header class="nav">
    <div class="brand"><img src="logo.png" alt=""><span>词捕</span><span class="brand-note">记住刚遇见的词</span></div>
    <div class="nav-actions"><nav class="tabs" aria-label="主导航">
      <button class="tab ${S.view === 'list' ? 'on' : ''}" data-nav="list">词库</button>
      <button class="tab ${S.view === 'capture' ? 'on' : ''}" data-nav="capture">导入词</button>
      <button class="tab ${S.view === 'settings' ? 'on' : ''}" data-nav="settings">设置</button>
    </nav><button class="exit-plugin" data-action="close-plugin" aria-label="退出插件并收起 uTools" title="退出并收起，下次呼出回到 uTools">×</button></div>
  </header>`
}

function tokenizeSpans() {
  const s = services.cleanSentence(S.payload)
  let out = ''
  let last = 0
  const re = /[A-Za-z][A-Za-z0-9'’-]*/g
  let m
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index))
    const sel = services.normalizeWord(m[0]) === S.word
    out += `<button class="tok${sel ? ' sel' : ''}" data-action="pick" data-tok="${esc(m[0])}" aria-pressed="${sel}">${esc(m[0])}</button>`
    last = m.index + m[0].length
  }
  return out + esc(s.slice(last))
}

function rowTrans(r) {
  return `<div class="pair">
    <input class="pos" placeholder="词性" value="${esc(r.pos)}">
    <input class="cn" placeholder="中文释义" value="${esc(r.cn)}">
    <button data-action="del-row" title="删除">×</button>
  </div>`
}
function rowSent(r) {
  return `<div class="pair col">
    <textarea class="c" rows="2" placeholder="英文例句">${esc(r.c)}</textarea>
    <div class="pair"><input class="cn" placeholder="中文翻译" value="${esc(r.cn)}"><button data-action="del-row" title="删除">×</button></div>
  </div>`
}

function editorHTML(e) {
  const existing = !S.editWord && S.entries.some(r => r.word === e.word)
  return `<section class="card editor-card" id="editor">
    <div class="section-heading"><h2>${S.editWord ? '编辑词条' : '检查词条'}</h2></div>
    <div class="entry-word"><label for="e-word">单词 / 短语</label><input id="e-word" value="${esc(e.word)}" autocomplete="off"></div>
    <div class="form-grid phonetics"><div><label for="e-p0">英式音标</label><input id="e-p0" placeholder="可留空" value="${esc(e.phonetic0)}"></div><div><label for="e-p1">美式音标</label><input id="e-p1" placeholder="可留空" value="${esc(e.phonetic1)}"></div></div>
    <div class="section-label"><label>中文释义</label><button class="link" data-action="add-trans">＋ 添加释义</button></div>
    <div id="transRows">${e.trans.map(rowTrans).join('')}</div>
    <div class="section-label"><label>例句与翻译</label><button class="link" data-action="add-sent">＋ 添加例句</button></div>
    <div id="sentRows">${e.sentences.map(rowSent).join('')}</div>
    <button class="disclosure" data-action="toggle-adv" aria-expanded="${S.advanced}">${S.advanced ? '▾' : '▸'} 完整词条 JSON</button>
    <textarea id="e-json" class="code-input" rows="10" style="${S.advanced ? '' : 'display:none'}" aria-label="完整词条 JSON">${esc(JSON.stringify(e, null, 2))}</textarea>
    ${existing ? '<div class="notice">已在词库，保存将更新内容并保留原日期。</div>' : ''}
    <div class="editor-actions"><button class="primary" data-action="save">${existing ? '更新已有词条' : S.editWord ? '保存修改' : '收入词库'} <kbd>${saveShortcut()}</kbd></button>${S.editWord ? '' : '<button data-action="regen">重新生成</button>'}<button class="link muted" data-action="cancel-edit">${S.editWord ? '取消' : '返回输入'}</button></div>
  </section>`
}

function modeTabs() {
  return `<div class="seg" aria-label="输入模式"><button class="seg-btn ${S.mode !== 'sentence' ? 'on' : ''}" data-action="mode-word">单词 / 短语</button><button class="seg-btn ${S.mode === 'sentence' ? 'on' : ''}" data-action="mode-sentence">从句子选词</button></div>`
}

function activeService() {
  const settings = S.settings || {}
  return (settings.profiles || [])[settings.activeProfile] || null
}

function serviceReady() {
  const p = activeService()
  return !!(p && p.apiBase && p.model && (p.apiKey || isLocalApi(p.apiBase)))
}

function isLocalApi(base) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)
  } catch (e) {
    return false
  }
}

function captureTargetHTML() {
  const duplicate = S.entries.some(r => r.word.toLowerCase() === S.word.trim().toLowerCase())
  return `<div class="target-heading"><label for="wordInput">${S.mode === 'sentence' ? '目标单词' : '目标词'}</label>${duplicate ? '<span class="badge">词库已有</span>' : ''}</div><div class="target-row"><input id="wordInput" value="${esc(S.word)}" placeholder="${S.mode === 'sentence' ? '点击原句中的单词，或手动填写' : '可修改单词或短语'}" autocomplete="off" spellcheck="false"><button class="primary" data-action="generate" ${!S.word.trim() || !serviceReady() ? 'disabled' : ''}>生成词条 <span aria-hidden="true">↗</span></button></div>${S.mode === 'sentence' ? '<p class="field-help">原句将保留为例句</p>' : ''}`
}

function captureView() {
  const p = activeService()
  let body
  if (S.generating) {
    body = `<section class="card loading-card"><div class="loading-orbit">${ICONS.spinner}</div><h2>正在整理 ${esc(S.word)}</h2><button class="link" data-action="cancel-generation">返回输入</button></section>`
  } else if (S.entry) {
    body = editorHTML(S.entry)
  } else {
    body = `<section class="card capture-card"><div class="capture-card-top"><label for="capInput">输入内容</label><div id="capture-mode">${modeTabs()}</div></div><textarea id="capInput" rows="3" placeholder="输入单词、短语或英文句子" spellcheck="false">${esc(S.payload)}</textarea><div class="input-foot"><button class="link muted" data-action="clear-capture">清空</button></div><div id="context-picker" ${S.mode !== 'sentence' ? 'hidden' : ''}><div class="context-label">在原句中选词</div><div class="tokens" id="tokens">${tokenizeSpans()}</div></div><div class="target-block" id="capture-target">${captureTargetHTML()}</div><div id="capture-error" class="inline-status error" role="alert" ${S.captureError ? '' : 'hidden'}>${esc(S.captureError)}</div></section>`
  }
  return (
    header() +
    `<main class="content capture-page">${body}<div class="capture-service">${serviceReady() ? `<span class="status-dot"></span><span>${esc(p.name)} <span class="muted">/ ${esc(p.model)}</span></span>` : '<span class="status-dot warning"></span><span>先配置 AI 服务</span>'}<button class="link" data-action="configure-ai">${serviceReady() ? '更换服务' : '去设置'}</button></div></main>`
  )
}

function itemHTML(r) {
  return `<div class="item">
    <div style="min-width:0">
      <b data-action="edit" data-w="${esc(r.word)}">${esc(r.word)}</b>
      <span class="gray">${esc(((r.entry.trans[0] && r.entry.trans[0].cn) || '').slice(0, 40))}</span>
    </div>
    <div class="ops">
      <button class="link" data-action="edit" data-w="${esc(r.word)}">编辑</button>
      <button class="link danger" data-action="del" data-w="${esc(r.word)}">删除</button>
    </div>
  </div>`
}

function filteredEntries() {
  const q = S.search.trim().toLowerCase()
  return S.entries.filter(
    r =>
      !q ||
      r.word.toLowerCase().includes(q) ||
      r.entry.trans.some(t => t.cn.toLowerCase().includes(q))
  )
}

function entryGroups(list, searching = !!S.search.trim()) {
  const groups = new Map()
  for (const r of list) {
    if (!groups.has(r.createdAt)) groups.set(r.createdAt, [])
    groups.get(r.createdAt).push(r)
  }
  const today = todayStr()
  if (!searching && !groups.has(today)) groups.set(today, [])
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items }))
}

function dayIsOpen(date) {
  const searching = !!S.search.trim()
  const state = searching ? S.searchDayExpanded : S.dayExpanded
  return Object.prototype.hasOwnProperty.call(state, date)
    ? state[date]
    : searching || date === todayStr()
}

// 以创建日期管理全库；搜索跨全部日期，并自动展开匹配分组。
function groupedItems(list) {
  const groups = entryGroups(list)
  return groups
    .map(g => {
      const open = dayIsOpen(g.date)
      const dateLabel = `${g.date.slice(0, 4)}年${+g.date.slice(5, 7)}月${+g.date.slice(8, 10)}日`
      const today = g.date === todayStr()
      return `<section class="day-group${today ? ' today' : ''}"><button class="day-toggle" data-action="toggle-day" data-date="${esc(g.date)}" aria-expanded="${open}" aria-controls="day-${esc(g.date)}"><span class="day-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span><span class="day-title">${esc(dateLabel)}</span><span class="day-count">${g.items.length} 个词条</span></button><div class="day-items" id="day-${esc(g.date)}" ${open ? '' : 'hidden'}>${g.items.length ? g.items.map(itemHTML).join('') : '<div class="day-empty">今天还没有新词</div>'}</div></section>`
    })
    .join('')
}

function listResultsHTML() {
  const list = filteredEntries()
  return S.search.trim() && !list.length
    ? '<div class="empty">没有匹配的词条</div>'
    : groupedItems(list)
}

function foldLabel() {
  return entryGroups(filteredEntries()).some(g => !dayIsOpen(g.date)) ? '展开全部' : '折叠全部'
}

function recoveryHTML() {
  const recovery = S.historyRecovery
  if (recovery.errors.length)
    return `<div class="history-notice error" role="status"><div><b>部分历史文件无法读取</b><p>${esc(recovery.errors.join('；'))}</p></div><button data-action="open-folder">查看文件夹</button></div>`
  if (!recovery.count) return ''
  return `<div class="history-notice"><div><b>${recovery.count} 个历史词条待恢复</b><p>按原日期恢复，同名词保留现有内容。</p></div><button data-action="recover-history">恢复历史词条</button></div>`
}

function listView() {
  const todayCount = S.entries.filter(r => r.createdAt === todayStr()).length
  return (
    header() +
    `<div class="content">
    <div class="library-summary">全部 ${S.entries.length} 个词条<span>今日新增 ${todayCount} 个</span></div>
    <div class="row">
      <input id="search" placeholder="搜索单词或中文释义" aria-label="搜索词库" value="${esc(S.search)}">
      <button data-action="fold-all" ${S.search.trim() && !filteredEntries().length ? 'disabled' : ''}>${foldLabel()}</button>
    </div>
    ${dataDirNoticeHTML()}${recoveryHTML()}
    <div class="list" id="listBox">${listResultsHTML()}</div>
    ${S.editWord ? modalHTML() : ''}
  </div>`
  )
}

function modalHTML() {
  const rec = S.entries.find(r => r.word === S.editWord)
  if (!rec) return ''
  return `<div class="overlay" data-action="overlay-close"><div class="modal">${editorHTML(S.entry || rec.entry)}</div></div>`
}

// ---------- 设置（多套 API 配置） ----------

const THINKING_LABELS = { off: '关闭（推荐）', low: '低', medium: '中', high: '高' }

function curProfile() {
  const d = S.draft
  if (!Array.isArray(d.profiles) || !d.profiles.length) {
    d.profiles = [
      { name: '配置 1', apiBase: '', apiKey: '', model: '', thinking: 'off', models: [] }
    ]
  }
  if (!Number.isInteger(d.activeProfile) || !d.profiles[d.activeProfile]) d.activeProfile = 0
  if (!Number.isInteger(S.profileIndex) || !d.profiles[S.profileIndex])
    S.profileIndex = d.activeProfile
  return d.profiles[S.profileIndex]
}

function profileState(p = curProfile()) {
  if (!S.profileStates.has(p))
    S.profileStates.set(p, {
      fetching: false,
      testing: false,
      modelMessage: '',
      modelError: false,
      testMessage: '',
      testError: false
    })
  return S.profileStates.get(p)
}

function settingsDirty() {
  if (!S.draft) return false
  let draft = S.draft
  // 首次进入设置自动提供空表单，不把这张占位表单算成用户修改。
  const p = draft.profiles && draft.profiles[0]
  if (
    !(S.settings.profiles || []).length &&
    draft.profiles.length === 1 &&
    p.name === '配置 1' &&
    !p.apiBase &&
    !p.apiKey &&
    !p.model &&
    p.thinking === 'off' &&
    !(p.models || []).length
  ) {
    draft = { ...draft, profiles: [], activeProfile: 0 }
  }
  return JSON.stringify(draft) !== JSON.stringify(S.settings)
}

function modelOptionsHTML() {
  const p = curProfile()
  const query = S.modelQuery.trim().toLowerCase()
  const models = (p.models || []).filter(m => m.toLowerCase().includes(query))
  return models.length
    ? models
        .map(
          m =>
            `<button class="model-option ${p.model === m ? 'selected' : ''}" role="option" aria-selected="${p.model === m}" data-action="choose-model" data-model="${esc(m)}"><span>${esc(m)}</span>${p.model === m ? '<span class="model-check">✓</span>' : ''}</button>`
        )
        .join('')
    : '<div class="model-empty">没有匹配的模型</div>'
}

function aiSettingsHTML() {
  const d = S.draft
  const p = curProfile()
  const state = profileState(p)
  const active = S.profileIndex === d.activeProfile
  const models = p.models || []
  return `<section class="card settings-card">
    <div class="profile-toolbar"><div class="profile-select"><label for="profileSelect">服务配置</label><select id="profileSelect">${d.profiles.map((pf, i) => `<option value="${i}" ${i === S.profileIndex ? 'selected' : ''}>${esc(pf.name || '未命名')}${i === d.activeProfile ? ' · 当前使用' : ''}</option>`).join('')}</select></div><button class="tool-button" data-action="add-profile" title="新增服务配置" aria-label="新增服务配置">${icon('plus')}</button>${d.profiles.length > 1 ? `<button class="tool-button danger" data-action="del-profile" title="删除此配置" aria-label="删除此配置">${icon('trash')}</button>` : ''}</div>
    ${active ? '' : '<div class="profile-state"><span class="muted">此配置尚未启用</span><button class="link" data-action="use-profile">设为当前使用</button></div>'}
    <div class="form-grid connection-grid"><div><label for="p-name">配置名称</label><input id="p-name" value="${esc(p.name)}" placeholder="例如：日常阅读"></div><div><label for="p-apiBase">API 基础地址</label><input id="p-apiBase" value="${esc(p.apiBase)}" placeholder="https://…/v1" spellcheck="false"></div></div>
    <label for="p-apiKey">API Key <span class="label-note" id="localKeyNote" ${isLocalApi(p.apiBase) ? '' : 'hidden'}>本地服务可留空</span></label><div class="input-action"><input id="p-apiKey" type="password" value="${esc(p.apiKey)}" placeholder="填写服务商提供的 Key" autocomplete="off"><button class="icon-btn" data-action="toggle-key" title="显示 API Key" aria-label="显示 API Key">${ICONS.eye}</button></div>
    <label for="p-model">生成模型</label>
    <div class="model-control"><div class="input-action model-input"><input id="p-model" value="${esc(p.model)}" placeholder="选择或填写模型 ID" spellcheck="false" autocomplete="off"><button class="tool-button model-toggle" data-action="toggle-model-menu" title="选择模型" aria-label="选择模型" aria-haspopup="listbox" aria-expanded="${S.modelOpen}" aria-controls="model-menu" ${models.length ? '' : 'disabled'}>${icon('chevron')}</button><button class="tool-button fetch-models" data-action="fetch-models" title="${state.fetching ? '正在获取模型' : '获取或刷新模型'}" aria-label="${state.fetching ? '正在获取模型' : '刷新模型'}" ${state.fetching ? 'disabled' : ''}>${state.fetching ? ICONS.spinner : ICONS.refresh}</button></div>
    ${S.modelOpen && models.length ? `<div class="model-menu" id="model-menu"><div class="model-search"><input id="modelSearch" placeholder="搜索 ${models.length} 个模型" value="${esc(S.modelQuery)}" aria-label="搜索模型" autocomplete="off"></div><div class="model-options" id="model-options" role="listbox" aria-label="可用模型">${modelOptionsHTML()}</div></div>` : ''}</div>
    <div class="field-help ${state.modelError ? 'error-text' : ''}" id="modelInfo" role="status">${esc(state.modelMessage || (models.length ? `${models.length} 个可用模型` : '也可手动填写模型 ID'))}</div>
    <details class="advanced-settings"><summary>思考模式</summary><div class="advanced-body"><label for="p-thinking">思考模式</label><select id="p-thinking">${Object.entries(
      THINKING_LABELS
    )
      .map(([v, l]) => `<option value="${v}" ${p.thinking === v ? 'selected' : ''}>${l}</option>`)
      .join('')}</select><p class="field-help">开启需接口支持，可能增加等待。</p></div></details>
    <div class="test-connection"><button data-action="test-api" ${state.testing ? 'disabled' : ''}>${state.testing ? '测试中…' : '测试当前配置'}</button><span class="inline-status ${state.testError ? 'error' : state.testMessage ? 'success' : ''}" id="testResult" role="status">${esc(state.testMessage || '无需先保存')}</span></div>
  </section>`
}

function dataSettingsHTML() {
  const info = services.getDailyInfo()
  const dirChanged = S.draft.dataDir !== S.settings.dataDir
  return `<div class="data-stack"><section class="card settings-card directory-card"><div class="section-label"><label for="s-dataDir">数据目录</label><button class="link" data-action="open-folder">${icon('folder')} 打开目录</button></div><div class="input-action"><input id="s-dataDir" value="${esc(S.draft.dataDir)}" spellcheck="false"><button data-action="pick-folder">选择目录</button></div><p class="field-help">更换目录不会搬迁旧文件</p></section>
    <section class="card file-card"><div class="file-card-head"><div class="file-title">${icon('file')}<b>今日导出</b><span>${esc(todayStr())}</span></div><div class="export-count"><strong>${info.count}</strong><span>个词条</span></div></div><div class="file-card-body"><span class="file-name" title="${esc(info.path)}">${esc(baseName(info.path))}</span><button data-action="open-daily">查看文件</button></div>${dirChanged ? '<div class="field-help">目录未保存，文件仍在原位置</div>' : ''}</section>
    <section class="card prompt-card"><span class="setting-symbol">${icon('prompt')}</span><div><b>生成提示词</b><p>编辑后下次生成生效</p></div><button data-action="show-prompt" title="在文件夹中查看 system-prompt.md">查看文件</button></section></div>`
}

function backupSettingsHTML() {
  const profiles = (S.settings.profiles || []).length
  return `<section class="card backup-panel"><div class="backup-row"><span class="setting-symbol">${icon('archive')}</span><div class="backup-copy"><div class="backup-title"><h2>词库备份</h2><span>${S.entries.length} 个词条</span></div><p>词条、原文、日期、每日存档与提示词</p><span class="backup-note">导入合并，同名内容保留本机</span></div><div class="backup-actions"><button data-action="export-library">${icon('download')} 导出词库</button><button data-action="import-library">${icon('upload')} 合并词库</button></div></div>
    <div class="backup-row"><span class="setting-symbol">${icon('sliders')}</span><div class="backup-copy"><div class="backup-title"><h2>服务配置</h2><span>${profiles} 套配置</span></div><p>API 地址、Key、模型与思考模式</p><span class="backup-note">导入替换配置，立即生效；文件含明文 Key</span></div><div class="backup-actions"><button data-action="export-config">${icon('download')} 导出配置</button><button data-action="import-config">${icon('upload')} 替换配置</button></div></div></section>`
}

function settingsView() {
  curProfile()
  const dirty = settingsDirty()
  const tabs = [
    ['ai', 'AI 服务'],
    ['data', '数据与导出'],
    ['backup', '备份与恢复']
  ]
  return (
    header() +
    `<main class="content settings-page"><nav class="settings-tabs" aria-label="设置分类">${tabs.map(([key, label]) => `<button data-action="settings-tab" data-tab="${key}" class="${S.settingsTab === key ? 'on' : ''}" aria-pressed="${S.settingsTab === key}">${label}</button>`).join('')}</nav><div class="settings-panel">${dataDirNoticeHTML()}${S.settingsTab === 'data' ? dataSettingsHTML() : S.settingsTab === 'backup' ? backupSettingsHTML() : aiSettingsHTML()}</div><div class="settings-savebar" id="settingsSavebar" ${dirty || S.settingsError ? '' : 'hidden'}><div><b id="savebarLabel">未保存修改</b><span id="settingsError" class="error-text" role="alert" ${S.settingsError ? '' : 'hidden'}>${esc(S.settingsError)}</span></div><button class="link muted" data-action="discard-settings" ${dirty ? '' : 'disabled'}>撤销修改</button><button class="primary" data-action="save-settings" ${dirty ? '' : 'disabled'}>保存设置</button></div></main>`
  )
}

function render() {
  app.innerHTML =
    S.view === 'list' ? listView() : S.view === 'settings' ? settingsView() : captureView()
  bindInputs()
  positionModelMenu()
}

// ---------- 事件绑定 ----------

function bindInputs() {
  const on = (sel, ev, fn) => {
    const el = app.querySelector(sel)
    if (el) el.addEventListener(ev, fn)
  }
  on('#capInput', 'input', e => {
    S.payload = e.target.value
    syncCapture()
  })
  on('#wordInput', 'input', e => {
    S.word = e.target.value
    updateCaptureButton()
  })
  on('#wordInput', 'keydown', e => {
    if (e.key === 'Enter') generate()
  })
  on('#capInput', 'keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      generate()
    }
  })
  on('#e-word', 'input', e => {
    if (S.editWord) return
    const existing = S.entries.some(r => r.word === e.target.value.trim())
    const button = app.querySelector('[data-action="save"]')
    if (button)
      button.innerHTML = `${existing ? '更新已有词条' : '收入词库'} <kbd>${saveShortcut()}</kbd>`
  })
  on('#search', 'input', e => {
    S.search = e.target.value
    S.searchDayExpanded = Object.create(null)
    const box = app.querySelector('#listBox')
    if (box) box.innerHTML = listResultsHTML()
    updateFoldButton()
  })

  // 设置页：字段实时写入草稿
  if (S.view === 'settings') {
    const change = (key, value) => {
      curProfile()[key] = value
      S.settingsError = ''
      updateSavebar()
    }
    on('#p-name', 'input', e => {
      change('name', e.target.value)
    })
    for (const key of ['apiBase', 'apiKey'])
      on('#p-' + key, 'input', e => {
        change(key, e.target.value)
        const p = curProfile()
        const keyNote = app.querySelector('#localKeyNote')
        if (keyNote) keyNote.hidden = !isLocalApi(p.apiBase)
        p.models = []
        const state = profileState(p)
        state.modelMessage = '连接已修改，请重新获取模型。'
        state.modelError = false
        state.testMessage = ''
        state.testError = false
        S.modelOpen = false
        const menu = app.querySelector('#model-menu')
        if (menu) menu.remove()
        const picker = app.querySelector('[data-action="toggle-model-menu"]')
        if (picker) {
          picker.disabled = true
          picker.setAttribute('aria-expanded', 'false')
        }
        const info = app.querySelector('#modelInfo')
        if (info) {
          info.textContent = state.modelMessage
          info.classList.remove('error-text')
        }
        const result = app.querySelector('#testResult')
        if (result) {
          result.textContent = '无需先保存'
          result.className = 'inline-status'
        }
        updateSavebar()
      })
    on('#p-model', 'input', e => {
      change('model', e.target.value)
      profileState().testMessage = ''
      updateTestResult()
    })
    on('#p-thinking', 'change', e => {
      change('thinking', e.target.value)
      profileState().testMessage = ''
      updateTestResult()
    })
    on('#s-dataDir', 'input', e => {
      S.draft.dataDir = e.target.value
      S.settingsError = ''
      updateSavebar()
    })
    on('#profileSelect', 'change', e => {
      S.profileIndex = +e.target.value
      S.modelOpen = false
      S.modelQuery = ''
      render()
    })
    on('#modelSearch', 'input', e => {
      S.modelQuery = e.target.value
      const options = app.querySelector('#model-options')
      if (options) options.innerHTML = modelOptionsHTML()
    })
    on('.settings-panel', 'scroll', positionModelMenu)
    on('#model-menu', 'keydown', e => {
      if (e.key === 'Escape') {
        S.modelOpen = false
        render()
        app.querySelector('[data-action="toggle-model-menu"]').focus()
        return
      }
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
      e.preventDefault()
      const buttons = [...app.querySelectorAll('.model-option')]
      if (!buttons.length) return
      const i = buttons.indexOf(document.activeElement)
      const next =
        i === -1
          ? e.key === 'ArrowDown'
            ? 0
            : buttons.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next].focus()
    })
  }
}

function updateSavebar() {
  const dirty = settingsDirty()
  const label = app.querySelector('#savebarLabel')
  if (label) label.textContent = dirty ? '未保存修改' : ''
  const bar = app.querySelector('#settingsSavebar')
  if (bar) bar.hidden = !dirty && !S.settingsError
  for (const action of ['save-settings', 'discard-settings']) {
    const button = app.querySelector(`[data-action="${action}"]`)
    if (button) button.disabled = !dirty
  }
  const error = app.querySelector('#settingsError')
  if (error) {
    error.textContent = S.settingsError
    error.hidden = !S.settingsError
  }
}

function updateTestResult() {
  const state = profileState()
  const result = app.querySelector('#testResult')
  if (result) {
    result.textContent = state.testMessage || '无需先保存'
    result.className =
      'inline-status' + (state.testError ? ' error' : state.testMessage ? ' success' : '')
  }
}

function updateCaptureButton() {
  const button = app.querySelector('[data-action="generate"]')
  if (button) button.disabled = !S.word.trim() || !serviceReady()
}

function syncCapture() {
  const words = services.tokenize(services.cleanSentence(S.payload))
  const nextMode = words.length > 1 ? 'sentence' : 'word'
  if (!S.modeManual && S.mode !== nextMode) {
    S.mode = nextMode
    S.word = ''
  }
  if (S.mode !== 'sentence') S.word = services.normalizeWord(S.payload)
  else if (S.word && !words.some(w => services.normalizeWord(w) === S.word)) S.word = ''
  S.captureError = ''
  const mode = app.querySelector('#capture-mode')
  if (mode) mode.innerHTML = modeTabs()
  const context = app.querySelector('#context-picker')
  if (context) context.hidden = S.mode !== 'sentence'
  const tokens = app.querySelector('#tokens')
  if (tokens) tokens.innerHTML = tokenizeSpans()
  const target = app.querySelector('#capture-target')
  if (target) target.innerHTML = captureTargetHTML()
  const error = app.querySelector('#capture-error')
  if (error) error.hidden = true
  bindCaptureTarget()
}

function bindCaptureTarget() {
  const input = app.querySelector('#wordInput')
  if (!input) return
  input.addEventListener('input', e => {
    S.word = e.target.value
    updateCaptureButton()
  })
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') generate()
  })
}

app.addEventListener('click', e => {
  const el = e.target.closest('[data-action],[data-nav]')
  if (!el) return
  if (el.dataset.nav) {
    switchView(el.dataset.nav)
    return
  }
  const act = el.dataset.action
  if (act === 'overlay-close' && e.target !== el) return
  switch (act) {
    case 'overlay-close':
      S.editWord = null
      S.entry = null
      render()
      break
    case 'mode-word':
      setMode('word')
      break
    case 'mode-sentence':
      setMode('sentence')
      break
    case 'pick':
      pickToken(el.dataset.tok)
      break
    case 'generate':
      generate()
      break
    case 'regen':
      generate(true)
      break
    case 'save':
      save()
      break
    case 'cancel-edit':
      cancelEdit()
      break
    case 'add-trans':
      addRow('transRows', rowTrans({ pos: '', cn: '' }))
      break
    case 'add-sent':
      addRow('sentRows', rowSent({ c: '', cn: '' }))
      break
    case 'del-row':
      ;(el.closest('.pair.col') || el.closest('.pair')).remove()
      break
    case 'toggle-adv':
      toggleAdvanced()
      break
    case 'configure-data':
      S.settingsTab = 'data'
      switchView('settings')
      break
    case 'close-plugin':
      try {
        if (!services.closeToUtools || !services.closeToUtools())
          toast('请使用 uTools 顶部的退出按钮或 Esc 退出插件', false)
      } catch (err) {
        toast('退出失败：' + err.message, false)
      }
      break
    case 'toggle-day':
      toggleDay(el.dataset.date)
      break
    case 'fold-all':
      foldAll()
      break
    case 'recover-history':
      recoverHistory()
      break
    case 'clear-capture':
      resetCapture()
      render()
      app.querySelector('#capInput').focus()
      break
    case 'cancel-generation':
      resetCaptureGeneration()
      render()
      break
    case 'configure-ai':
      S.settingsTab = 'ai'
      switchView('settings')
      break
    case 'edit':
      openEdit(el.dataset.w)
      break
    case 'del':
      del(el.dataset.w)
      break
    case 'open-folder':
      fileAction(() => services.openDataFolder(), '打开目录')
      break
    case 'open-daily':
      fileAction(() => services.showDailyFile(), '查看文件')
      break
    case 'show-prompt':
      fileAction(() => services.showPromptFile(), '查看提示词')
      break
    case 'pick-folder':
      fileAction(pickFolder, '选择目录')
      break
    case 'export-config':
      exportCfg()
      break
    case 'import-config':
      importCfg()
      break
    case 'export-library':
      exportLibrary()
      break
    case 'import-library':
      importLibrary()
      break
    case 'settings-tab':
      S.settingsTab = el.dataset.tab
      S.modelOpen = false
      render()
      break
    case 'use-profile':
      S.draft.activeProfile = S.profileIndex
      render()
      break
    case 'discard-settings':
      S.draft = JSON.parse(JSON.stringify(S.settings))
      S.profileIndex = S.draft.activeProfile
      S.modelOpen = false
      S.settingsError = ''
      render()
      break
    case 'toggle-model-menu':
      S.modelOpen = !S.modelOpen
      S.modelQuery = ''
      render()
      if (S.modelOpen) app.querySelector('#modelSearch').focus()
      break
    case 'choose-model':
      curProfile().model = el.dataset.model
      profileState().testMessage = ''
      S.modelOpen = false
      render()
      break
    case 'add-profile':
      addProfile()
      break
    case 'del-profile':
      delProfile()
      break
    case 'fetch-models':
      fetchModelsUI()
      break
    case 'toggle-key': {
      const k = app.querySelector('#p-apiKey')
      if (k) {
        const show = k.type === 'password'
        k.type = show ? 'text' : 'password'
        el.innerHTML = show ? ICONS.eyeOff : ICONS.eye
        el.title = show ? '隐藏 API Key' : '显示 API Key'
        el.setAttribute('aria-label', el.title)
      }
      break
    }
    case 'save-settings':
      saveSettingsUI()
      break
    case 'test-api':
      testApi()
      break
  }
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.modelOpen) {
    closeModelMenu()
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && (S.entry || S.editWord)) {
    e.preventDefault()
    save()
  }
  if (e.key === 'Escape') {
    if (S.editWord) {
      S.editWord = null
      S.entry = null
      render()
    } else if (S.entry && S.view === 'capture') cancelEdit()
  }
})

document.addEventListener('click', e => {
  if (
    S.modelOpen &&
    !e.target.closest('.model-control') &&
    !e.target.closest('[data-action="fetch-models"]')
  )
    closeModelMenu()
})

function positionModelMenu() {
  const menu = app.querySelector('#model-menu')
  const control = app.querySelector('.model-control')
  if (!menu || !control) return
  const rect = control.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 64
  const upward = below < 180 && above > below
  menu.style.left = rect.left + 'px'
  menu.style.width = rect.width + 'px'
  menu.style.maxHeight = Math.max(100, Math.min(280, upward ? above : below)) + 'px'
  menu.style.top = upward ? 'auto' : rect.bottom + 6 + 'px'
  menu.style.bottom = upward ? window.innerHeight - rect.top + 6 + 'px' : 'auto'
}
window.addEventListener('resize', positionModelMenu)

function closeModelMenu() {
  S.modelOpen = false
  const menu = app.querySelector('#model-menu')
  if (menu) menu.remove()
  const button = app.querySelector('[data-action="toggle-model-menu"]')
  if (button) button.setAttribute('aria-expanded', 'false')
}

// ---------- 行为 ----------

function switchView(v) {
  if (v !== 'settings') S.modelOpen = false
  S.view = v
  if (v === 'list') refreshList()
  else if (v === 'settings') {
    if (!S.draft) {
      S.draft = JSON.parse(JSON.stringify(S.settings))
      S.profileIndex = S.draft.activeProfile
    }
    render()
  } else render()
}

// 划词带内容进入 → 导入词页预填；空手进入由启动路由处理（落词库）
function enterPayload(text) {
  S.view = 'capture'
  resetCapture()
  S.payload = services.cleanSentence(text)
  // 只做推荐，不代替用户选择：单个词元→单词，否则→句子
  const toks = S.payload ? services.tokenize(S.payload) : []
  if (toks.length === 0) S.mode = null
  else if (toks.length === 1) {
    S.mode = 'word'
    S.word = services.normalizeWord(S.payload)
  } else S.mode = 'sentence'
  render()
}

function resetCapture() {
  resetCaptureGeneration()
  S.payload = ''
  S.mode = 'word'
  S.modeManual = false
  S.word = ''
  S.entry = null
  S.regen = null
  S.advanced = false
  S.editWord = null
}

function resetCaptureGeneration() {
  S.generationId++
  S.generating = false
  S.captureError = ''
}

function setMode(m) {
  S.modeManual = true
  S.mode = m
  if (m === 'word') S.word = S.payload ? services.normalizeWord(S.payload) : S.word
  render()
}

function pickToken(tok) {
  S.word = services.normalizeWord(tok)
  const tokens = app.querySelector('#tokens')
  if (tokens) tokens.innerHTML = tokenizeSpans()
  const target = app.querySelector('#capture-target')
  if (target) {
    target.innerHTML = captureTargetHTML()
    bindCaptureTarget()
  }
  updateCaptureButton()
}

async function generate(regenerate = false) {
  if (S.generating) return
  if (!serviceReady()) {
    S.settingsTab = 'ai'
    switchView('settings')
    toast('请先填写并保存当前 AI 服务配置', false)
    return
  }
  if (!S.mode) S.mode = 'word'
  const word = regenerate && S.regen ? S.regen.word : S.word.trim()
  if (!word) {
    toast('请先填写目标单词', false)
    return
  }
  // 原始输入直接交给 AI 修复（大小写/断词/所有格/笔误），程序只做展示级清洗
  if (!regenerate || !S.regen)
    S.regen = { word, sentence: S.mode === 'sentence' ? services.cleanSentence(S.payload) : '' }
  const input = { ...S.regen }
  const generationId = ++S.generationId
  S.generating = true
  S.captureError = ''
  S.entry = null
  render()
  try {
    const entry = await services.generateEntry(input)
    if (generationId !== S.generationId) return
    S.entry = entry
    S.word = S.entry.word // 回填 AI 规范化后的词形
  } catch (err) {
    if (generationId !== S.generationId) return
    S.captureError = '生成失败：' + err.message
  }
  S.generating = false
  render()
}

// 从 DOM 收集编辑器内容；高级模式开启时以完整 JSON 为准
function collectEditor() {
  const jsonTa = app.querySelector('#e-json')
  if (S.advanced && jsonTa) {
    return JSON.parse(jsonTa.value) // 解析失败由 save() 捕获提示
  }
  const val = sel => {
    const el = app.querySelector(sel)
    return el ? el.value : ''
  }
  const base = S.entry || {}
  return {
    word: val('#e-word').trim(),
    phonetic0: val('#e-p0').trim(),
    phonetic1: val('#e-p1').trim(),
    trans: [...app.querySelectorAll('#transRows .pair')]
      .map(p => ({
        pos: p.querySelector('.pos').value.trim(),
        cn: p.querySelector('.cn').value.trim()
      }))
      .filter(r => r.cn),
    sentences: [...app.querySelectorAll('#sentRows .pair.col')]
      .map(p => ({
        c: p.querySelector('.c').value.trim(),
        cn: p.querySelector('.cn').value.trim()
      }))
      .filter(r => r.c),
    phrases: base.phrases || [],
    synos: base.synos || [],
    relWords: base.relWords || { root: '', rels: [] },
    etymology: base.etymology || []
  }
}

function save() {
  let entry
  try {
    entry = services.validateEntry(collectEditor())
  } catch (err) {
    toast('保存失败：' + err.message, false)
    return
  }
  try {
    if (S.editWord) {
      const file = services.updateEntry(S.editWord, entry)
      S.editWord = null
      S.entry = null
      S.view = 'list'
      refreshList()
      toast(file ? `已更新 · 今日 ${file.count} 词` : '已更新')
    } else {
      services.saveEntry(entry, S.regen)
      resetCapture()
      S.view = 'list'
      refreshList()
      toast('已收入词库')
    }
  } catch (err) {
    toast('保存失败：' + err.message, false)
  }
}

function cancelEdit() {
  S.entry = null
  S.advanced = false
  S.editWord = null
  render()
}

function addRow(containerId, html) {
  const box = app.querySelector('#' + containerId)
  if (box) {
    box.insertAdjacentHTML('beforeend', html)
    const inputs = box.lastElementChild.querySelectorAll('input, textarea')
    if (inputs[0]) inputs[0].focus()
  }
}

function toggleAdvanced() {
  const jsonTa = app.querySelector('#e-json')
  if (!S.advanced) {
    // 进入高级模式前，把表单当前内容并回 entry，JSON 才是完整的
    try {
      const cur = collectEditor()
      if (jsonTa) jsonTa.value = JSON.stringify(cur, null, 2)
      S.entry = cur
    } catch (e) {
      /* 保持原状 */
    }
  } else if (jsonTa) {
    // 退出高级模式前，应用 JSON 里的修改
    try {
      S.entry = services.validateEntry(JSON.parse(jsonTa.value))
    } catch (err) {
      toast('JSON 无效，未应用修改：' + err.message, false)
      return
    }
  }
  S.advanced = !S.advanced
  render()
}

function refreshList() {
  S.entries = services.listEntries()
  S.historyRecovery = services.getHistoryRecoveryInfo()
  render()
}

function updateFoldButton() {
  const button = app.querySelector('[data-action="fold-all"]')
  if (!button) return
  button.textContent = foldLabel()
  button.disabled = !!S.search.trim() && !filteredEntries().length
}

function toggleDay(date) {
  const state = S.search.trim() ? S.searchDayExpanded : S.dayExpanded
  state[date] = !dayIsOpen(date)
  const button = app.querySelector(`[data-action="toggle-day"][data-date="${date}"]`)
  const items = app.querySelector('#day-' + date)
  if (button) {
    button.setAttribute('aria-expanded', String(state[date]))
    button.querySelector('.day-chevron').textContent = state[date] ? '▾' : '▸'
  }
  if (items) items.hidden = !state[date]
  updateFoldButton()
}

function foldAll() {
  const groups = entryGroups(filteredEntries())
  const open = groups.some(g => !dayIsOpen(g.date))
  const state = S.search.trim() ? S.searchDayExpanded : S.dayExpanded
  for (const group of groups) state[group.date] = open
  const box = app.querySelector('#listBox')
  if (box) box.innerHTML = listResultsHTML()
  updateFoldButton()
}

function recoverHistory() {
  try {
    const result = services.recoverHistoryFiles()
    refreshList()
    toast(`已恢复 ${result.added} 个历史词条`)
  } catch (err) {
    toast('历史词条恢复失败：' + err.message, false)
  }
}

function openEdit(word) {
  const rec = S.entries.find(r => r.word === word)
  if (!rec) return
  S.editWord = word
  S.entry = rec.entry // collectEditor 以 S.entry 兜底，避免 phrases/synos 等未展示字段丢失
  S.advanced = false
  render()
}

function del(word) {
  if (!confirm(`删除「${word}」？\n当日文件中的记录会同步移除，已导入的历史文件不受影响。`)) return
  try {
    const file = services.deleteEntry(word)
    refreshList()
    toast(file ? `已删除 · 今日 ${file.count} 词` : '已删除')
  } catch (err) {
    toast('删除失败：' + err.message, false)
  }
}

// ---------- 设置行为 ----------

function addProfile() {
  const d = S.draft
  d.profiles.push({
    name: `配置 ${d.profiles.length + 1}`,
    apiBase: '',
    apiKey: '',
    model: '',
    thinking: 'off',
    models: []
  })
  S.profileIndex = d.profiles.length - 1
  S.modelOpen = false
  render()
}

function delProfile() {
  const d = S.draft
  if (d.profiles.length <= 1) return
  const p = curProfile()
  if (!confirm(`删除配置「${p.name || '未命名'}」？`)) return
  const index = S.profileIndex
  d.profiles.splice(index, 1)
  if (d.activeProfile === index) d.activeProfile = 0
  else if (d.activeProfile > index) d.activeProfile--
  S.profileIndex = Math.min(index, d.profiles.length - 1)
  S.modelOpen = false
  render()
}

// 从当前配置的接口拉取模型列表，缓存进配置（保存后持久化）
async function fetchModelsUI() {
  const p = curProfile()
  if (!p.apiBase) {
    toast('请先填写 API 地址', false)
    return
  }
  const state = profileState(p)
  if (state.fetching) return
  const request = JSON.parse(JSON.stringify(p))
  state.fetching = true
  state.modelMessage = ''
  state.modelError = false
  S.modelOpen = false
  render()
  try {
    const ids = await services.fetchModels(request)
    if (p.apiBase !== request.apiBase || p.apiKey !== request.apiKey) {
      state.modelMessage = '连接已修改，请重新获取模型。'
    } else {
      p.models = [...new Set(ids.map(m => String(m).trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      )
      state.modelMessage = `${p.models.length} 个可用模型`
      if (S.view === 'settings' && S.settingsTab === 'ai' && curProfile() === p) {
        S.modelOpen = true
        S.modelQuery = ''
      }
    }
  } catch (err) {
    if (p.apiBase === request.apiBase && p.apiKey === request.apiKey) {
      state.modelMessage = '获取失败：' + err.message
      state.modelError = true
    }
  }
  state.fetching = false
  if (S.view === 'settings') render()
}

function saveSettingsUI() {
  const d = S.draft
  if (!d.dataDir) {
    toast('数据目录不能为空', false)
    return
  }
  try {
    S.settings = services.saveSettings(JSON.parse(JSON.stringify(d)))
    S.draft = JSON.parse(JSON.stringify(S.settings))
    S.profileStates = new WeakMap()
    S.modelOpen = false
    S.settingsError = ''
    render()
    toast('设置已保存')
  } catch (err) {
    S.settingsError = '保存失败：' + err.message
    updateSavebar()
  }
}

async function testApi() {
  const p = curProfile()
  const state = profileState(p)
  if (state.testing) return
  if (!p.apiBase || !p.model || (!p.apiKey && !isLocalApi(p.apiBase))) {
    state.testMessage = '请填写 API 地址、模型，以及远程服务所需的 Key。'
    state.testError = true
    render()
    return
  }
  const request = JSON.parse(JSON.stringify(p))
  state.testing = true
  state.testMessage = ''
  state.testError = false
  render()
  try {
    const r = await services.testConnection(request)
    state.testMessage = `✓ ${request.model} 可用 · ${r.ms} ms`
  } catch (err) {
    state.testMessage = '测试失败：' + err.message
    state.testError = true
  }
  if (['apiBase', 'apiKey', 'model', 'thinking'].some(key => p[key] !== request[key])) {
    state.testMessage = '配置已修改，请重新测试。'
    state.testError = false
  }
  state.testing = false
  if (S.view === 'settings') render()
}

function pickFolder() {
  const dir = services.pickDataDir(S.draft.dataDir)
  if (dir) {
    S.draft.dataDir = dir
    render()
  }
}

// 备份只导出已保存配置，与实际生效的服务一致。
function exportCfg() {
  try {
    const p = services.exportConfigFile(JSON.parse(JSON.stringify(S.settings)))
    if (p) toast('配置已导出：' + p)
  } catch (err) {
    toast('导出失败：' + err.message, false)
  }
}

// 导入即生效（恢复语义），无需再按保存
function importCfg() {
  try {
    const s = services.importConfigFile()
    if (!s) return // 用户取消
    S.settings = s
    S.draft = JSON.parse(JSON.stringify(s))
    S.profileIndex = s.activeProfile
    S.profileStates = new WeakMap()
    S.modelOpen = false
    S.settingsError = ''
    render()
    toast('配置已导入并生效')
  } catch (err) {
    toast('导入失败：' + err.message, false)
  }
}

function exportLibrary() {
  try {
    const result = services.exportLibraryFile()
    if (result) toast(`已备份 ${result.count} 个词条：${result.path}`)
  } catch (err) {
    toast('词库备份失败：' + err.message, false)
  }
}

function importLibrary() {
  try {
    const result = services.importLibraryFile()
    if (!result) return
    S.entries = services.listEntries()
    S.historyRecovery = services.getHistoryRecoveryInfo()
    S.entry = null
    S.editWord = null
    render()
    toast(`已恢复 ${result.added} 个词条，保留 ${result.skipped} 个已有同名词条`)
  } catch (err) {
    toast('词库恢复失败：' + err.message, false)
  }
}

// ---------- 启动与路由 ----------

// 默认主页 = 词库；划词带内容进入（over / regex）→ 直达导入词页
S.settings = services.getSettings()
try {
  const imported = services.initializeLibrary()
  if (imported && imported.added) toast(`已导入 ${imported.added} 个本地词条`)
} catch (err) {
  toast('本地词库导入失败：' + err.message, false)
}
refreshList()

window.addEventListener('tw-enter', e => {
  // 后台实例重入也读取外部修改；保留用户尚未保存的设置草稿。
  const dirty = settingsDirty()
  S.settings = services.getSettings()
  if (!dirty) S.draft = null
  const text = String((e.detail && e.detail.text) || '').trim()
  if (text) enterPayload(text)
  else {
    resetCapture()
    S.view = 'list'
    refreshList()
  }
})
