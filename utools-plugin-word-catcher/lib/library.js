'use strict'

// 词库备份格式与恢复计划；计划完整校验后才交给 preload 执行。
const fs = require('fs')
const path = require('path')
const core = require('./core.js')

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validateDaily(list, date) {
  if (!validDate(date) || !Array.isArray(list)) throw new Error('每日文件格式错误：' + date)
  const seen = new Set()
  return list.map(raw => {
    const entry = core.validateEntry(raw)
    if (seen.has(entry.word)) throw new Error(`每日文件 ${date} 有重复词条：${entry.word}`)
    seen.add(entry.word)
    return entry
  })
}

function validateBackup(raw) {
  if (
    !raw ||
    raw.type !== 'typewords-library' ||
    raw.version !== 1 ||
    !Array.isArray(raw.records)
  ) {
    throw new Error('请选择词捕导出的词库备份文件（版本 1）')
  }
  const seen = new Set()
  const records = raw.records.map(r => {
    if (!r || !validDate(r.createdAt) || !validDate(r.updatedAt) || r.updatedAt < r.createdAt) {
      throw new Error('词条日期格式错误')
    }
    const entry = core.validateEntry(r.entry)
    if (r.word !== entry.word) throw new Error('词条名称与内容不一致：' + r.word)
    if (seen.has(entry.word)) throw new Error('备份中有重复词条：' + entry.word)
    seen.add(entry.word)
    return {
      word: entry.word,
      rawWord: typeof r.rawWord === 'string' ? r.rawWord : entry.word,
      rawSentence: typeof r.rawSentence === 'string' ? r.rawSentence : '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      entry
    }
  })
  if (!raw.daily || typeof raw.daily !== 'object' || Array.isArray(raw.daily)) {
    throw new Error('备份缺少每日文件数据')
  }
  const daily = {}
  for (const [date, list] of Object.entries(raw.daily)) daily[date] = validateDaily(list, date)
  if (raw.prompt !== null && typeof raw.prompt !== 'string') throw new Error('备份提示词格式错误')
  return { type: 'typewords-library', version: 1, records, daily, prompt: raw.prompt }
}

function createBackup(dataDir, records) {
  const daily = {}
  const dailyDir = path.join(dataDir, 'daily')
  if (fs.existsSync(dailyDir)) {
    for (const name of fs.readdirSync(dailyDir).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue
      daily[name.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dailyDir, name), 'utf8'))
    }
  }
  // 今日导出是本地库的视图；即使文件尚未写入，也能随备份完整带走。
  daily[core.todayStr()] = records.filter(r => r.createdAt === core.todayStr()).map(r => r.entry)
  const promptPath = path.join(dataDir, 'prompts', 'system-prompt.md')
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : null
  return {
    ...validateBackup({ type: 'typewords-library', version: 1, records, daily, prompt }),
    exportedAt: new Date().toISOString()
  }
}

function prepareImport(dataDir, raw, currentRecords) {
  const backup = validateBackup(raw)
  const words = new Set(currentRecords.map(r => r.word))
  const added = backup.records.filter(r => !words.has(r.word))
  const records = currentRecords.concat(added)
  const files = []
  const today = core.todayStr()
  for (const [date, list] of Object.entries(backup.daily)) {
    if (date === today) continue
    const target = core.dailyPath(dataDir, date)
    const existing = fs.existsSync(target)
      ? validateDaily(JSON.parse(fs.readFileSync(target, 'utf8')), date)
      : []
    const existingWords = new Set(existing.map(e => e.word))
    const merged = existing.concat(list.filter(e => !existingWords.has(e.word)))
    files.push({ path: target, content: JSON.stringify(merged, null, 2) + '\n' })
  }
  files.push({
    path: core.dailyPath(dataDir, today),
    content:
      JSON.stringify(
        records.filter(r => r.createdAt === today).map(r => r.entry),
        null,
        2
      ) + '\n'
  })
  const promptPath = path.join(dataDir, 'prompts', 'system-prompt.md')
  if (backup.prompt !== null && !fs.existsSync(promptPath))
    files.push({ path: promptPath, content: backup.prompt })
  return { added, skipped: backup.records.length - added.length, files }
}

function writeAtomic(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temp = target + `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    fs.writeFileSync(temp, content)
    fs.renameSync(temp, target)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}

// 仅预览历史每日文件中的缺失记录。显式恢复时才写入本地库，避免重启复活已删词条。
function readHistory(dataDir, currentRecords, today = core.todayStr()) {
  const dailyDir = path.join(dataDir, 'daily')
  const records = new Map()
  const errors = []
  const currentWords = new Set(currentRecords.map(r => r.word))
  if (!fs.existsSync(dailyDir)) return { records: [], errors }
  let names
  try {
    names = fs.readdirSync(dailyDir).sort()
  } catch (err) {
    return { records: [], errors: ['每日文件目录无法读取：' + err.message] }
  }
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue
    const date = name.slice(0, -5)
    if (date >= today) continue
    try {
      const entries = validateDaily(
        JSON.parse(fs.readFileSync(path.join(dailyDir, name), 'utf8')),
        date
      )
      for (const entry of entries) {
        if (currentWords.has(entry.word)) continue
        const previous = records.get(entry.word)
        records.set(entry.word, {
          word: entry.word,
          rawWord: entry.word,
          rawSentence: entry.sentences[0].c,
          createdAt: previous ? previous.createdAt : date,
          updatedAt: date,
          entry
        })
      }
    } catch (err) {
      errors.push(`${name}：${err.message.slice(0, 180)}`)
    }
  }
  return { records: [...records.values()], errors }
}

module.exports = { createBackup, validateBackup, prepareImport, writeAtomic, readHistory }
