'use strict'
// 词捕核心逻辑测试：node test/core.test.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const core = require('../lib/core.js')

// ---- normalizeWord：标点/引号/所有格/断词 ----
assert.strictEqual(core.normalizeWord('  "protein,"  '), 'protein')
assert.strictEqual(core.normalizeWord('‘scatter’'), 'scatter')
assert.strictEqual(core.normalizeWord('“membrane.'), 'membrane')
assert.strictEqual(core.normalizeWord("protein's"), 'protein')
assert.strictEqual(core.normalizeWord('protein’s'), 'protein')
assert.strictEqual(core.normalizeWord('anti-\ntrust'), 'antitrust')
assert.strictEqual(core.normalizeWord('well-'), 'well')
assert.strictEqual(core.normalizeWord('state-of-the-art'), 'state-of-the-art') // 内部连字符保留
assert.strictEqual(core.normalizeWord('STATE'), 'STATE') // 大小写不擅动，交给 AI
assert.strictEqual(core.normalizeWord('  word  '), 'word')

// ---- cleanText：PDF 换行/断词/连字/空白 ----
assert.strictEqual(
  core.cleanText('The mitochon-\ndrial membrane\nwas\n\nmeasured.'),
  'The mitochondrial membrane was measured.'
)
assert.strictEqual(core.cleanText('ﬁndings ﬂow'), 'findings flow')
assert.strictEqual(core.cleanText('a\u00A0b'), 'a b')
assert.strictEqual(core.normalizeWord('coordi-\nnation'), 'coordination')

// ---- tokenize：含数字/连字符/撇号词元 ----
assert.deepStrictEqual(
  core.tokenize("IL-6 levels, and Covid-19 data; it's a state-of-the-art method."),
  ['IL-6', 'levels', 'and', 'Covid-19', 'data', "it's", 'a', 'state-of-the-art', 'method']
)

// ---- extractJson：容忍代码块与前后废话 ----
assert.deepStrictEqual(core.extractJson('```json\n{"a":1}\n```'), { a: 1 })
assert.deepStrictEqual(core.extractJson('好的，结果如下：{"a":1} 请查收'), { a: 1 })
assert.deepStrictEqual(core.extractJson('{"word":"x","trans":[],"sentences":[]}'), {
  word: 'x',
  trans: [],
  sentences: []
})
assert.throws(() => core.extractJson('完全没有 JSON'))

// ---- validateEntry：补齐键、剔脏、强校验 ----
const e = core.validateEntry({
  word: ' x ',
  phonetic0: 123, // 宽容转为字符串
  trans: [{ pos: 'n.', cn: '测试' }, { pos: 'v.', cn: '' }, null],
  sentences: [{ c: ' A b. ', cn: '译' }],
  junk: 1
})
assert.strictEqual(e.word, 'x')
assert.strictEqual(e.phonetic0, '123') // 非字符串 → 宽容转字符串
assert.strictEqual(e.trans.length, 1)
assert.deepStrictEqual(e.phrases, [])
assert.deepStrictEqual(e.synos, [])
assert.deepStrictEqual(e.relWords, { root: '', rels: [] })
assert.deepStrictEqual(e.etymology, [])
assert.strictEqual('note' in e, false) // note 字段已移除，即使 AI 返回也会被丢弃
assert.throws(() => core.validateEntry({ word: 'x', trans: [], sentences: [{ c: 'a' }] }), /trans/)
assert.throws(
  () => core.validateEntry({ word: '', trans: [{ cn: 'a' }], sentences: [{ c: 'a' }] }),
  /word/
)
assert.throws(() => core.validateEntry('not an object'))

// ---- 每日文件：读写/合并去重/删除 ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-test-'))
core.writeDaily(dir, '2026-09-14', [{ word: 'a' }])
core.writeDaily(
  dir,
  '2026-09-14',
  [{ word: 'a' }, { word: 'a', v: 2 }, { word: 'b' }].filter(
    (w, i, arr) => arr.findIndex(x => x.word === w.word) === i
  )
)
assert.strictEqual(core.readDaily(dir, '2026-09-14').length, 2)
core.writeDaily(dir, '2026-09-14', [{ word: 'a', v: 1 }, { word: 'b' }])
core.writeDaily(dir, '2026-09-14', [{ word: 'a', v: 9 }, { word: 'b' }]) // 模拟同词替换后
const day = core.readDaily(dir, '2026-09-14')
assert.strictEqual(day[0].v, 9)
core.removeFromDaily(dir, 'a', '2026-09-14')
assert.strictEqual(core.readDaily(dir, '2026-09-14').length, 1)
assert.deepStrictEqual(core.readDaily(dir, '1999-01-01'), []) // 不存在 → 空数组
assert.match(core.todayStr(), /^\d{4}-\d{2}-\d{2}$/)
assert.strictEqual(core.dailyPath(dir, '2026-09-14'), path.join(dir, 'daily', '2026-09-14.json'))

fs.rmSync(dir, { recursive: true, force: true })
console.log('✓ 全部测试通过')
