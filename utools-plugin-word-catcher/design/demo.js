'use strict'
// 隔离的界面预览：无真实 API、文件系统或 uTools 数据连接。
const demoClone = x => JSON.parse(JSON.stringify(x))
const demoToday = new Date().toLocaleDateString('sv-SE')
const demoEntry = (word, cn, sentence) => ({
  word,
  phonetic0: word === 'resilient' ? 'rɪˈzɪliənt' : '',
  phonetic1: word === 'resilient' ? 'rɪˈzɪliənt' : '',
  trans: [{ pos: 'adj.', cn }],
  sentences: [{ c: sentence, cn: '即使经历挫折，这个系统也能迅速恢复。' }],
  phrases: [{ c: 'a resilient system', cn: '有韧性的系统' }],
  synos: [],
  relWords: { root: '', rels: [] },
  etymology: []
})
let demoRecords = [
  [
    'resilient',
    '有韧性的；能迅速恢复的',
    'A resilient system can recover from setbacks.',
    demoToday
  ],
  ['robust', '稳健的；强健的', 'We need a robust method.', demoToday],
  ['elucidate', '阐明；解释', 'These results elucidate the mechanism.', '2026-10-08'],
  [
    'serendipity',
    '意外发现珍贵事物的机缘',
    'The discovery was a moment of serendipity.',
    '2026-10-08'
  ],
  ['reproducibility', '可重复性', 'Reproducibility is essential in research.', '2026-10-07']
].map(([word, cn, sentence, date]) => ({
  word,
  rawWord: word,
  rawSentence: sentence,
  createdAt: date,
  updatedAt: date,
  entry: demoEntry(word, cn, sentence)
}))
let demoSettings = {
  profiles: [
    {
      name: '演示服务',
      apiBase: 'https://example.invalid/v1',
      apiKey: '',
      model: 'demo-model',
      thinking: 'off',
      models: ['demo-model', 'demo-fast']
    }
  ],
  activeProfile: 0,
  dataDir: '演示目录 / typewords-data'
}
// 仅让预览中“生成”按钮可用，此值不对应任何真实凭证。
demoSettings.profiles[0].apiKey = 'demo-only'
window.services = {
  getSettings: () => demoClone(demoSettings),
  saveSettings: s => {
    demoSettings = demoClone(s)
    return demoClone(s)
  },
  initializeLibrary: () => null,
  listEntries: () => demoClone(demoRecords),
  getDailyInfo: () => ({
    count: demoRecords.filter(r => r.createdAt === demoToday).length,
    path: 'daily/' + demoToday + '.json'
  }),
  getHistoryRecoveryInfo: () => ({ count: 0, errors: [] }),
  cleanSentence: s =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .trim(),
  normalizeWord: s =>
    String(s || '')
      .trim()
      .replace(/^["“‘']+|["”’'.,!?]+$/g, ''),
  tokenize: s => String(s || '').match(/[A-Za-z][A-Za-z0-9'’-]*/g) || [],
  validateEntry: e => demoClone(e),
  generateEntry: async ({ word, sentence }) => {
    await new Promise(r => setTimeout(r, 450))
    return demoEntry(
      word,
      '有韧性的；能迅速恢复的',
      sentence || 'A resilient system can recover from setbacks.'
    )
  },
  fetchModels: async () => ['demo-model', 'demo-fast'],
  testConnection: async () => ({ ms: 120, reply: '演示连接成功' }),
  saveEntry: (entry, raw) => {
    demoRecords = demoRecords.filter(r => r.word !== entry.word)
    demoRecords.unshift({
      word: entry.word,
      entry: demoClone(entry),
      rawWord: raw && raw.word,
      rawSentence: raw && raw.sentence,
      createdAt: demoToday,
      updatedAt: demoToday
    })
  },
  updateEntry: (oldWord, entry) => {
    const r = demoRecords.find(r => r.word === oldWord)
    if (r) Object.assign(r, { word: entry.word, entry: demoClone(entry), updatedAt: demoToday })
  },
  deleteEntry: word => {
    demoRecords = demoRecords.filter(r => r.word !== word)
  },
  closeToUtools: () => false,
  pickDataDir: () => null,
  exportConfigFile: () => null,
  importConfigFile: () => null,
  exportLibraryFile: () => null,
  importLibraryFile: () => null,
  showPromptFile() {},
  showDailyFile() {},
  openDataFolder() {}
}
