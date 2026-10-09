'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
// 仅暴露演示所需源码，不能让真实词库或配置通过 HTTP 被读取。
const files = new Set([
  '/app.js',
  '/style.css',
  '/logo.png',
  '/design/current.html',
  '/design/frame.html',
  '/design/demo.js',
  '/design/frame.js'
])
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png'
}
const server = http.createServer((req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname
  if (requested === '/') {
    res.writeHead(302, { Location: '/design/current.html' })
    res.end()
    return
  }
  const file = requested
  if (!files.has(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  res.setHeader('Content-Type', mime[path.extname(file)])
  res.setHeader('Cache-Control', 'no-store')
  fs.createReadStream(path.join(root, file))
    .on('error', () => {
      res.destroy()
    })
    .pipe(res)
})
const port = process.env.TYPEWORDS_PREVIEW_PORT ? Number(process.env.TYPEWORDS_PREVIEW_PORT) : 0
server.listen(port, '127.0.0.1', () =>
  console.log('词捕界面预览：http://127.0.0.1:' + server.address().port + '/')
)
