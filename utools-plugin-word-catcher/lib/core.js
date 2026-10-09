'use strict'
// 词捕 · 核心逻辑：文本清洗、词条校验、每日文件读写
// 纯函数 + 显式传入 dataDir 的文件操作，便于 Node 环境直接测试

const fs = require('fs')
const path = require('path')

const DEFAULT_SYSTEM_PROMPT = `你是一位帮助中文科研/技术人员积累英语词汇的词典编纂助手。用户在阅读英文论文、技术文档或网页时划词记录生词，你为每个词生成一条可直接导入 TypeWords 的词条 JSON。

## 输入

调用方会传入 JSON：{"word": "...", "sentence": "..." 或 null}

- word：用户记下的单词或短语，来自划词或手动输入。
- sentence：该词出现的原句（可选），来自划词或手动粘贴。

## 第一步：修复输入

输入可能残留划词/复制带来的问题，先在内部修复，再据此生成词条：

- word：去除残留的引号、标点、所有格；接回断词（anti- + trust → antitrust）；判断大小写——缩写/专有名词/产品名保留原样大小写（API、mRNA、iPhone），普通词的排版大写转为小写原形（Protein → protein）。
- sentence：修复 PDF 复制常见问题——断词接回（mitochon- drial → mitochondrial）、缺失或多余的空格、残留换行、乱码字符、错位标点。修复保持原意与原措辞，不增删、不改写内容。
- 修复后的 sentence 即为第一条例句：sentences[0].c 输出修复后的原句，cn 翻译它，并结合该语境确定首要义项。
- 若 word 疑似截断或笔误，按最可能的完整词处理。

## 生成规则

1. 只输出一个 JSON 对象：不要 markdown 代码块、不要任何解释文字。
2. 输出 word 用规范书写形式：普通词用小写原形（lemma，如 regulations→regulation）；缩写、专有名词、产品名保留原样大小写。
3. 含连字符的复合词（如 state-of-the-art、well-being）作为整体解释，不拆分。
4. phonetic0 为英式音标，phonetic1 为美式音标，均不带斜杠。
5. trans 按“该词在学术/技术语境中最常用的义项优先”排序；pos 用标准缩写（n. / v. / adj. / adv. 等）；cn 为简体中文释义。
6. sentences：修复后的用户原句（若有）排第一；再补 2~3 条自造例句，兼顾技术语境与一般语境，cn 为自然中文翻译。
7. phrases：2~4 个真实常用的搭配或短语，优先学术/技术语境；没有合适的就给空数组。
8. synos：1~3 组近义词；没有合适的就给空数组。
9. relWords：有明确词根或常见派生词时填写；否则 root 给空字符串、rels 给空数组。
10. etymology：1~2 条简要中文词源，通俗不冗长；没有可靠的就给空数组。
11. 中文要自然，英文要地道；不确定的义项宁可少写，不要编造。不要输出 note 字段。

## Schema（所有键必须存在，无内容给空数组/空字符串）

{"word":"clarification","phonetic0":"ˌklærɪfɪˈkeɪʃn","phonetic1":"ˌklærəfəˈkeɪʃn","trans":[{"pos":"n.","cn":"澄清，阐明"}],"sentences":[{"c":"I am seeking clarification of the regulations.","cn":"我正在努力弄清楚这些规则。"}],"phrases":[{"c":"seek clarification","cn":"寻求澄清"}],"synos":[{"pos":"n.","cn":"澄清，说明","ws":["explanation"]}],"relWords":{"root":"clarify","rels":[{"pos":"v.","words":[{"c":"clarify","cn":"澄清；阐明"}]}]},"etymology":[{"t":"clarification:","d":"来自拉丁语 clarificare，意为「使清楚」。"}]}`

// ---------- 文本清洗 ----------

const LIGATURES = { ﬁ: 'fi', ﬂ: 'fl', ﬀ: 'ff', ﬃ: 'ffi', ﬄ: 'ffl' }

// 统一清洗句子/选中文本：连字、换行、PDF 断词、多余空白
function cleanText(s) {
  if (typeof s !== 'string') return ''
  let t = s.replace(/\u00A0/g, ' ')
  t = t.replace(/[ﬁﬂﬀﬃﬄ]/g, ch => LIGATURES[ch] || ch)
  t = t.replace(/\r\n?/g, '\n')
  // PDF 行尾断词：小写-换行-小写 直接接回（mitochon-\ndrial → mitochondrial）
  t = t.replace(/([a-z])-\n([a-z])/g, '$1$2')
  // 剩余换行一律当空格（排版换行不是语义换行）
  t = t.replace(/\n+/g, ' ')
  t = t.replace(/[ \t]{2,}/g, ' ').trim()
  return t
}

// 清洗目标单词：去包裹符号/标点/所有格/断词残连字符。
// 注意：不改大小写——全大写是缩写(API)还是排版(标题)程序无法判定，交给 AI 按词形规则处理，用户可手改。
function normalizeWord(raw) {
  let w = cleanText(raw)
  for (;;) {
    const next = w
      .replace(/^[\s"'“”‘’「『《(\[{·•*_]+/, '')
      .replace(/[\s"'“”‘’」』》)\]},.;。;:!?…·•*_]+$/, '')
    if (next === w) break
    w = next
  }
  w = w.replace(/['’]s$/i, '') // 所有格
  w = w.replace(/^[-–—]+/, '').replace(/[-–—]+$/, '') // 孤立连字符（划词截断残留）
  w = w.replace(/\s{2,}/g, ' ').trim()
  return w
}

// 从句子中提取可点击的词元（含 IL-6、Covid-19、it's、state-of-the-art 等）
function tokenize(sentence) {
  const tokens = []
  const re = /[A-Za-z][A-Za-z0-9'’-]*/g
  let m
  while ((m = re.exec(sentence))) tokens.push(m[0])
  return tokens
}

// ---------- 词条校验 ----------

function emptyEntry(word) {
  return {
    word,
    phonetic0: '',
    phonetic1: '',
    trans: [],
    sentences: [],
    phrases: [],
    synos: [],
    relWords: { root: '', rels: [] },
    etymology: []
  }
}

// 宽进严出：接受 AI 可能的畸形输出，补齐所有键，剔除无效项；不合格则抛错
function validateEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('词条不是 JSON 对象')
  const e = emptyEntry(typeof raw.word === 'string' ? raw.word.trim() : '')
  if (!e.word) throw new Error('缺少 word 字段')
  const arr = v => (Array.isArray(v) ? v : [])
  const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
  e.phonetic0 = str(raw.phonetic0).trim()
  e.phonetic1 = str(raw.phonetic1).trim()
  e.trans = arr(raw.trans)
    .map(t => ({ pos: str(t && t.pos).trim(), cn: str(t && t.cn).trim() }))
    .filter(t => t.cn)
  e.sentences = arr(raw.sentences)
    .map(s => ({ c: str(s && s.c).trim(), cn: str(s && s.cn).trim() }))
    .filter(s => s.c)
  e.phrases = arr(raw.phrases)
    .map(p => ({ c: str(p && p.c).trim(), cn: str(p && p.cn).trim() }))
    .filter(p => p.c)
  e.synos = arr(raw.synos)
    .map(s => ({
      pos: str(s && s.pos).trim(),
      cn: str(s && s.cn).trim(),
      ws: arr(s && s.ws)
        .map(w => str(w).trim())
        .filter(Boolean)
    }))
    .filter(s => s.ws.length)
  if (raw.relWords && typeof raw.relWords === 'object') {
    e.relWords.root = str(raw.relWords.root).trim()
    e.relWords.rels = arr(raw.relWords.rels)
      .map(r => ({
        pos: str(r && r.pos).trim(),
        words: arr(r && r.words)
          .map(w => ({ c: str(w && w.c).trim(), cn: str(w && w.cn).trim() }))
          .filter(w => w.c)
      }))
      .filter(r => r.words.length)
  }
  e.etymology = arr(raw.etymology)
    .map(t => ({ t: str(t && t.t).trim(), d: str(t && t.d).trim() }))
    .filter(t => t.t || t.d)
  if (!e.trans.length) throw new Error('trans 为空，至少需要一条释义')
  if (!e.sentences.length) throw new Error('sentences 为空，至少需要一条例句')
  return e
}

// 从 LLM 输出中提取 JSON 对象（容忍 markdown 代码块与前后缀说明文字）
function extractJson(text) {
  let t = String(text == null ? '' : text).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('输出中未找到 JSON 对象')
  return JSON.parse(t.slice(start, end + 1))
}

// ---------- 每日文件 ----------

function todayStr(d) {
  const t = d || new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

function ensureDirs(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'daily'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'prompts'), { recursive: true })
}

function dailyPath(dataDir, dateStr) {
  return path.join(dataDir, 'daily', `${dateStr}.json`)
}

function readDaily(dataDir, dateStr) {
  try {
    const list = JSON.parse(fs.readFileSync(dailyPath(dataDir, dateStr), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function writeDaily(dataDir, dateStr, list) {
  ensureDirs(dataDir)
  fs.writeFileSync(dailyPath(dataDir, dateStr), JSON.stringify(list, null, 2) + '\n')
}

function removeFromDaily(dataDir, word, dateStr) {
  const list = readDaily(dataDir, dateStr)
  const next = list.filter(w => w.word !== word)
  if (next.length !== list.length) writeDaily(dataDir, dateStr, next)
  return next
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  cleanText,
  normalizeWord,
  tokenize,
  emptyEntry,
  validateEntry,
  extractJson,
  todayStr,
  ensureDirs,
  dailyPath,
  readDaily,
  writeDaily,
  removeFromDaily
}
