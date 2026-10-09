'use strict'
// node scripts/add-trial-words.js <dataDir> [YYYY-MM-DD]
// 写入每日导出及一次性待导入文件，插件下次启动后合并到 uTools 词库。
const fs = require('fs')
const path = require('path')
const core = require('../lib/core.js')
const library = require('../lib/library.js')
if (!process.argv[2])
  throw new Error('请显式指定试用词目录：node scripts/add-trial-words.js <dataDir> [YYYY-MM-DD]')
const dataDir = path.resolve(process.argv[2])
const date = process.argv[3] || core.todayStr()
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式应为 YYYY-MM-DD')
const sentence = (c, cn) => ({ c, cn })
const samples = [
  {
    word: 'robust',
    phonetic0: 'rəʊˈbʌst',
    phonetic1: 'roʊˈbʌst',
    trans: [
      { pos: 'adj.', cn: '稳健的；能抵御误差或干扰的' },
      { pos: 'adj.', cn: '强健的；结实的' }
    ],
    sentences: [
      sentence(
        'The method remains robust under noisy conditions.',
        '该方法在存在噪声的条件下仍然稳健。'
      ),
      sentence(
        'We need a robust approach to missing data.',
        '我们需要一种稳健的方法来处理缺失数据。'
      ),
      sentence('The plants developed a robust root system.', '这些植物长出了强健的根系。')
    ],
    phrases: [sentence('robust analysis', '稳健分析'), sentence('robust evidence', '有力的证据')],
    synos: [{ pos: 'adj.', cn: '强健的；稳健的', ws: ['resilient', 'sturdy'] }],
    relWords: {
      root: 'robust',
      rels: [{ pos: 'n.', words: [sentence('robustness', '稳健性；强健程度')] }]
    },
    etymology: []
  },
  {
    word: 'reproducibility',
    phonetic0: 'rɪˌprəʊdjuːsəˈbɪləti',
    phonetic1: 'rɪˌproʊduːsəˈbɪləti',
    trans: [{ pos: 'n.', cn: '可复现性；结果能够被再次获得的性质' }],
    sentences: [
      sentence(
        'Sharing the analysis code improves reproducibility.',
        '共享分析代码有助于提高可复现性。'
      ),
      sentence(
        'The team documented each step to support reproducibility.',
        '团队记录了每个步骤，以支持结果复现。'
      )
    ],
    phrases: [
      sentence('experimental reproducibility', '实验可复现性'),
      sentence('ensure reproducibility', '确保可复现性')
    ],
    synos: [],
    relWords: {
      root: 'reproduce',
      rels: [
        { pos: 'v.', words: [sentence('reproduce', '复现；复制')] },
        { pos: 'adj.', words: [sentence('reproducible', '可复现的')] }
      ]
    },
    etymology: []
  },
  {
    word: 'elucidate',
    phonetic0: 'iˈluːsɪdeɪt',
    phonetic1: 'iˈluːsɪdeɪt',
    trans: [{ pos: 'v.', cn: '阐明；使复杂问题或机制清楚易懂' }],
    sentences: [
      sentence(
        'The experiments helped elucidate the underlying mechanism.',
        '这些实验有助于阐明其背后的机制。'
      ),
      sentence(
        'Could you elucidate the difference between these terms?',
        '你能解释清楚这些术语之间的区别吗？'
      )
    ],
    phrases: [
      sentence('elucidate a mechanism', '阐明机制'),
      sentence('elucidate the role of', '阐明……的作用')
    ],
    synos: [{ pos: 'v.', cn: '阐明；解释', ws: ['clarify', 'explain'] }],
    relWords: {
      root: 'elucidate',
      rels: [{ pos: 'n.', words: [sentence('elucidation', '阐明；说明')] }]
    },
    etymology: []
  },
  {
    word: 'serendipity',
    phonetic0: 'ˌserənˈdɪpəti',
    phonetic1: 'ˌserənˈdɪpəti',
    trans: [{ pos: 'n.', cn: '意外发现有价值事物的机缘；偶然的幸运发现' }],
    sentences: [
      sentence(
        'The discovery was a mixture of careful observation and serendipity.',
        '这一发现既源于细致观察，也得益于偶然的机缘。'
      ),
      sentence(
        'A little serendipity led us to this quiet bookshop.',
        '一次小小的巧遇把我们带到了这家安静的书店。'
      )
    ],
    phrases: [
      sentence('a moment of serendipity', '一次幸运的巧遇'),
      sentence('scientific serendipity', '科学研究中的偶然发现')
    ],
    synos: [],
    relWords: {
      root: 'serendipity',
      rels: [{ pos: 'adj.', words: [sentence('serendipitous', '偶然发现的；机缘巧合的')] }]
    },
    etymology: []
  },
  {
    word: 'mitochondrial',
    phonetic0: 'ˌmaɪtəʊˈkɒndriəl',
    phonetic1: 'ˌmaɪtoʊˈkɑːndriəl',
    trans: [{ pos: 'adj.', cn: '线粒体的；与线粒体有关的' }],
    sentences: [
      sentence(
        'The study measured changes in mitochondrial activity.',
        '该研究测量了线粒体活性的变化。'
      ),
      sentence(
        'Mitochondrial function was assessed using several complementary assays.',
        '研究使用了多种互补的检测方法来评估线粒体功能。'
      )
    ],
    phrases: [
      sentence('mitochondrial function', '线粒体功能'),
      sentence('mitochondrial membrane', '线粒体膜')
    ],
    synos: [],
    relWords: {
      root: 'mitochondrion',
      rels: [
        {
          pos: 'n.',
          words: [
            sentence('mitochondrion', '线粒体（单数）'),
            sentence('mitochondria', '线粒体（复数）')
          ]
        }
      ]
    },
    etymology: []
  },
  {
    word: 'state-of-the-art',
    phonetic0: 'ˌsteɪt əv ði ˈɑːt',
    phonetic1: 'ˌsteɪt əv ði ˈɑːrt',
    trans: [{ pos: 'adj.', cn: '采用目前最先进技术的；达到当前最高水平的' }],
    sentences: [
      sentence(
        'We compared the method with state-of-the-art baselines.',
        '我们将该方法与当前先进的基线方法进行了比较。'
      ),
      sentence(
        'The laboratory has state-of-the-art imaging equipment.',
        '这间实验室配备了先进的成像设备。'
      )
    ],
    phrases: [
      sentence('state-of-the-art technology', '先进技术'),
      sentence('state-of-the-art equipment', '先进设备')
    ],
    synos: [{ pos: 'adj.', cn: '先进的', ws: ['advanced', 'cutting-edge'] }],
    relWords: { root: '', rels: [] },
    etymology: []
  }
].map(core.validateEntry)
core.ensureDirs(dataDir)
const target = core.dailyPath(dataDir, date)
const existing = fs.existsSync(target)
  ? JSON.parse(fs.readFileSync(target, 'utf8')).map(core.validateEntry)
  : []
const words = new Set(existing.map(e => e.word))
const additions = samples.filter(e => !words.has(e.word))
const merged = existing.concat(additions)
const pendingPath = path.join(dataDir, 'pending-library.json')
const old = fs.existsSync(pendingPath)
  ? library.validateBackup(JSON.parse(fs.readFileSync(pendingPath, 'utf8')))
  : { records: [], daily: {}, prompt: null }
const records = new Map(old.records.map(r => [r.word, r]))
for (const e of merged)
  if (!records.has(e.word))
    records.set(e.word, {
      word: e.word,
      rawWord: e.word,
      rawSentence: e.sentences[0].c,
      createdAt: date,
      updatedAt: date,
      entry: e
    })
const pending = library.validateBackup({
  type: 'typewords-library',
  version: 1,
  records: [...records.values()],
  daily: { ...old.daily, [date]: merged },
  prompt: old.prompt
})
library.writeAtomic(pendingPath, JSON.stringify(pending, null, 2) + '\n')
library.writeAtomic(target, JSON.stringify(merged, null, 2) + '\n')
console.log(
  JSON.stringify(
    {
      date,
      added: additions.map(e => e.word),
      count: merged.length,
      dailyPath: target,
      pendingPath
    },
    null,
    2
  )
)
