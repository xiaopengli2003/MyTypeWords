'use strict'

// 开发命令只访问插件源码和系统临时测试目录；发布目录由明确的文件清单构建。
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const metadata = require('../package.json')
const manifest = require('../plugin.json')
const runtimeFiles = [
  'plugin.json',
  'index.html',
  'style.css',
  'app.js',
  'preload.js',
  'logo.png',
  'lib/core.js',
  'lib/library.js'
]

function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    if (['node_modules', 'dist', 'assets'].includes(item.name)) return []
    const file = path.join(dir, item.name)
    return item.isDirectory() ? sourceFiles(file) : item.name.endsWith('.js') ? [file] : []
  })
}

function checkRelease() {
  assert.strictEqual(metadata.version, manifest.version, 'package.json 与 plugin.json 版本必须一致')
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/)
  for (const file of runtimeFiles) assert.ok(fs.statSync(path.join(root, file)).isFile(), file)
  const logo = fs.readFileSync(path.join(root, manifest.logo))
  assert.strictEqual(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Logo 必须为 PNG')
  assert.ok(
    logo.readUInt32BE(16) <= 256 && logo.readUInt32BE(20) <= 256,
    'Logo 尺寸不得超过 256×256'
  )
}

switch (process.argv[2]) {
  case 'test':
    for (const file of fs
      .readdirSync(path.join(root, 'test'))
      .filter(name => name.endsWith('.test.js'))
      .sort()) {
      console.log(`\n${file}`)
      runNode([path.join('test', file)])
    }
    break
  case 'check':
    checkRelease()
    for (const file of sourceFiles(root)) runNode(['--check', file])
    console.log('JavaScript 语法、版本、运行文件及 Logo 检查通过')
    break
  case 'build': {
    checkRelease()
    const target = path.join(root, 'dist', 'word-catcher-v' + metadata.version)
    fs.rmSync(target, { recursive: true, force: true })
    for (const file of runtimeFiles) {
      const destination = path.join(target, file)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(path.join(root, file), destination)
    }
    console.log(`发布目录：${target}\n在 uTools 开发者工具中选择该目录的 plugin.json 后打包。`)
    break
  }
  default:
    throw new Error('支持的命令：test、check、build')
}
