// local-gallery server: lists media files in a folder, serves them, caches
// browser-made thumbnails and stores favourites in <root>/.local-gallery/.
// Zero dependencies. Binds to 127.0.0.1 only.

import { createServer } from 'node:http'
import { createReadStream, watch } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const PACKAGE = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

export const NAME = PACKAGE.name
export const VERSION = PACKAGE.version
export const STATE_DIR_NAME = '.local-gallery'
export const DEFAULT_PORT = 8790
const HOST = '127.0.0.1'
const MAX_THUMB_BYTES = 4 * 1024 * 1024

export const MEDIA_TYPES = {
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.webp': ['image', 'image/webp'],
  '.gif': ['image', 'image/gif'],
  '.avif': ['image', 'image/avif'],
  '.bmp': ['image', 'image/bmp'],
  '.svg': ['image', 'image/svg+xml'],
  '.mp4': ['video', 'video/mp4'],
  '.webm': ['video', 'video/webm'],
  '.mov': ['video', 'video/quicktime'],
  '.m4v': ['video', 'video/mp4'],
}
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

// ---------- pure helpers (exported for tests) ----------

/** Resolve a gallery-relative path ("Folder/file.png") inside root, or null if it escapes or is hidden. */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null
  const parts = rel.split(/[\\/]+/).filter(Boolean)
  if (!parts.length || parts.some(p => p === '..' || p === '.' || p.startsWith('.'))) return null
  const abs = path.resolve(root, ...parts)
  const back = path.relative(root, abs)
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null
  return abs
}

/** Read width and height from the first bytes of an image file. Returns [w, h] or null. */
export function parseDims(buf, ext) {
  if (ext === '.png' && buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
  }
  if (ext === '.gif' && buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') return [buf.readUInt16LE(6), buf.readUInt16LE(8)]
  if (ext === '.bmp' && buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') {
    return [Math.abs(buf.readInt32LE(18)), Math.abs(buf.readInt32LE(22))]
  }
  if (ext === '.webp' && buf.length >= 30 && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff]
    if (chunk === 'VP8L') {
      const b = buf.subarray(21, 25)
      return [1 + (b[0] | ((b[1] & 0x3f) << 8)), 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10))]
    }
    if (chunk === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)]
  }
  if ((ext === '.jpg' || ext === '.jpeg') && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xff) { i++; continue }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}

const thumbKey = (rel, size, mtimeMs) => createHash('sha1').update(`${rel}|${size}|${Math.round(mtimeMs)}`).digest('hex').slice(0, 24)

async function readHead(file, bytes) {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

async function exists(file) {
  try { await stat(file); return true } catch { return false }
}

/** Open a URL, file or folder with the operating system. */
function osOpen(target, { select = false } = {}) {
  if (process.platform === 'win32') {
    if (/^https?:/.test(target)) return spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref()
    // explorer.exe needs the quoted path verbatim; Windows paths cannot contain quotes.
    spawn('explorer.exe', [select ? `/select,"${target}"` : `"${target}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref()
  } else if (process.platform === 'darwin') {
    spawn('open', select ? ['-R', target] : [target], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('xdg-open', [select ? path.dirname(target) : target], { detached: true, stdio: 'ignore' }).unref()
  }
}
export const openInBrowser = url => osOpen(url)

async function probe(port) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/info`, { signal: AbortSignal.timeout(1500) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

// ---------- server ----------

/**
 * Start a gallery for `root`.
 * Resolves to { url, port, root, reused, close() }. When another local-gallery
 * already serves the same folder on a candidate port, it is reused (reused: true).
 * Busy ports are skipped, up to `portRange` attempts.
 */
export async function startGallery({ root, port = DEFAULT_PORT, portRange = 20, log = () => {} } = {}) {
  const ROOT = path.resolve(root || process.cwd())
  if (!(await stat(ROOT).catch(() => null))?.isDirectory()) throw new Error(`Folder not found: ${ROOT}`)

  const STATE_DIR = path.join(ROOT, STATE_DIR_NAME)
  const THUMB_DIR = path.join(STATE_DIR, 'thumbs')
  const STATE_FILE = path.join(STATE_DIR, 'state.json')
  const toRel = abs => path.relative(ROOT, abs).split(path.sep).join('/')
  const resolveRel = rel => resolveInside(ROOT, rel)

  // Favourites and video dimensions.
  let state = { version: 1, favorites: [], dims: {} }
  try {
    state = { ...state, ...JSON.parse(await readFile(STATE_FILE, 'utf8')) }
  } catch { /* first run */ }

  async function ensureStateDir() {
    if (await exists(THUMB_DIR)) return
    await mkdir(THUMB_DIR, { recursive: true })
    if (process.platform === 'win32') execFile('attrib', ['+h', STATE_DIR], () => {})
  }

  let saving = Promise.resolve()
  function saveState() {
    saving = saving.then(async () => {
      await ensureStateDir()
      const tmp = `${STATE_FILE}.tmp`
      await writeFile(tmp, JSON.stringify(state, null, 2))
      await rename(tmp, STATE_FILE)
    }).catch(err => log(`Could not save state: ${err.message}`))
    return saving
  }

  const dimCache = new Map()
  async function imageDims(abs, ext, key) {
    if (dimCache.has(key)) return dimCache.get(key)
    let dims = null
    try {
      dims = parseDims(await readHead(abs, ext === '.jpg' || ext === '.jpeg' ? 512 * 1024 : 64), ext)
    } catch { /* unreadable header: the browser measures it instead */ }
    dimCache.set(key, dims)
    return dims
  }

  async function scan() {
    const folders = []
    const items = []
    async function walk(dir) {
      let entries = []
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'Thumbs.db' || entry.name === 'desktop.ini' || entry.name === 'node_modules') continue
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          folders.push(toRel(abs))
          await walk(abs)
          continue
        }
        const ext = path.extname(entry.name).toLowerCase()
        const type = MEDIA_TYPES[ext]
        if (!entry.isFile() || !type) continue
        let info
        try { info = await stat(abs) } catch { continue }
        const rel = toRel(abs)
        const key = thumbKey(rel, info.size, info.mtimeMs)
        const dims = type[0] === 'image' ? await imageDims(abs, ext, key) : state.dims[key] || null
        items.push({
          path: rel,
          folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
          name: entry.name,
          type: type[0],
          ext: ext.slice(1),
          size: info.size,
          mtime: Math.round(info.mtimeMs),
          w: dims?.[0] || null,
          h: dims?.[1] || null,
          key,
          thumb: (await exists(path.join(THUMB_DIR, `${key}.webp`))) ? `/thumb/${key}.webp` : null,
        })
      }
    }
    await walk(ROOT)
    const favorites = new Set(state.favorites)
    for (const item of items) item.favorite = favorites.has(item.path)
    return { name: NAME, version: VERSION, root: ROOT, sep: path.sep, folders, items }
  }

  // Remove cached thumbnails whose source file changed or disappeared.
  async function pruneThumbs() {
    try {
      const keys = new Set((await scan()).items.map(i => i.key))
      for (const name of await readdir(THUMB_DIR)) {
        if (!keys.has(name.replace(/\.webp$/, ''))) await rm(path.join(THUMB_DIR, name), { force: true })
      }
      for (const key of Object.keys(state.dims)) if (!keys.has(key)) delete state.dims[key]
    } catch { /* nothing cached yet */ }
  }

  // Live updates over server-sent events.
  const clients = new Set()
  let pending = null
  const notify = () => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      for (const res of clients) res.write('event: change\ndata: {}\n\n')
    }, 400)
  }

  let allowedHosts = new Set()
  let allowedOrigins = new Set()

  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra })
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  }

  async function readBody(req, limit) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 })
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  async function readJson(req) {
    try { return JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) } catch { return null }
  }

  async function serveFile(req, res, abs, type, extra = {}) {
    let info
    try { info = await stat(abs) } catch { return send(res, 404, { error: 'Not found' }) }
    if (!info.isFile()) return send(res, 404, { error: 'Not found' })
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Last-Modified': info.mtime.toUTCString(),
      ...extra,
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : info.size - Number(range[2])
      let end = range[1] && range[2] ? Number(range[2]) : info.size - 1
      start = Math.max(0, start)
      end = Math.min(end, info.size - 1)
      if (start > end) return send(res, 416, '', 'text/plain', { 'Content-Range': `bytes */${info.size}` })
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(abs, { start, end }).pipe(res)
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size })
    if (req.method === 'HEAD') return res.end()
    createReadStream(abs).pipe(res)
  }

  async function handle(req, res) {
    // Reject other host names (DNS rebinding) and cross-site writes.
    if (!allowedHosts.has(req.headers.host || '')) return send(res, 403, { error: 'Host not allowed' })
    const url = new URL(req.url, `http://${req.headers.host}`)
    const route = url.pathname

    if (req.method === 'POST') {
      const origin = req.headers.origin
      if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'Origin not allowed' })
      if (!origin && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
        return send(res, 403, { error: 'Cross-site request' })
      }

      if (route === '/api/favorite') {
        const body = await readJson(req)
        if (!body || !Array.isArray(body.paths) || body.paths.some(p => !resolveRel(p))) return send(res, 400, { error: 'Bad request' })
        const favorites = new Set(state.favorites)
        for (const p of body.paths) body.value ? favorites.add(p) : favorites.delete(p)
        state.favorites = [...favorites].sort()
        await saveState()
        return send(res, 200, { ok: true })
      }

      if (route === '/api/reveal') {
        const body = await readJson(req)
        const abs = body?.path ? resolveRel(body.path) : ROOT
        if (!abs) return send(res, 400, { error: 'Bad path' })
        const info = await stat(abs).catch(() => null)
        if (!info) return send(res, 404, { error: 'Not found' })
        osOpen(abs, { select: !info.isDirectory() })
        return send(res, 200, { ok: true })
      }

      if (route === '/api/thumb') {
        const abs = resolveRel(url.searchParams.get('path'))
        if (!abs || !MEDIA_TYPES[path.extname(abs).toLowerCase()]) return send(res, 400, { error: 'Bad path' })
        const info = await stat(abs).catch(() => null)
        if (!info?.isFile()) return send(res, 404, { error: 'Not found' })
        const body = await readBody(req, MAX_THUMB_BYTES)
        if (body.length < 16 || body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WEBP') {
          return send(res, 415, { error: 'Thumbnail must be WebP' })
        }
        const key = thumbKey(toRel(abs), info.size, info.mtimeMs)
        await ensureStateDir()
        await writeFile(path.join(THUMB_DIR, `${key}.webp`), body)
        const w = Number(url.searchParams.get('w'))
        const h = Number(url.searchParams.get('h'))
        if (MEDIA_TYPES[path.extname(abs).toLowerCase()][0] === 'video' && w > 0 && h > 0) {
          state.dims[key] = [Math.round(w), Math.round(h)]
          await saveState()
        }
        return send(res, 200, { thumb: `/thumb/${key}.webp` })
      }

      return send(res, 404, { error: 'Not found' })
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' })

    if (route === '/api/info') return send(res, 200, { name: NAME, version: VERSION, root: ROOT }, undefined, { 'Cache-Control': 'no-store' })
    if (route === '/api/library') return send(res, 200, await scan(), undefined, { 'Cache-Control': 'no-store' })

    if (route === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }

    if (route.startsWith('/media/')) {
      let rel
      try { rel = decodeURIComponent(route.slice(7)) } catch { return send(res, 400, { error: 'Bad path' }) }
      const abs = resolveRel(rel)
      const type = abs && MEDIA_TYPES[path.extname(abs).toLowerCase()]
      if (!type) return send(res, 404, { error: 'Not found' })
      const extra = {
        'Cache-Control': url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache',
        // Opened directly (e.g. an SVG in a new tab), media must not run scripts on this origin.
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      }
      if (url.searchParams.has('download')) {
        extra['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`
      }
      return serveFile(req, res, abs, type[1], extra)
    }

    if (route.startsWith('/thumb/')) {
      const name = route.slice(7)
      if (!/^[a-f0-9]{24}\.webp$/.test(name)) return send(res, 404, { error: 'Not found' })
      return serveFile(req, res, path.join(THUMB_DIR, name), 'image/webp', { 'Cache-Control': 'public, max-age=31536000, immutable' })
    }

    const file = route === '/' ? 'index.html' : route.slice(1)
    if (!/^[a-z0-9-]+\.(html|css|js|svg)$/.test(file)) return send(res, 404, { error: 'Not found' })
    return serveFile(req, res, path.join(PUBLIC, file), STATIC_TYPES[path.extname(file)], { 'Cache-Control': 'no-cache' })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(err => {
      if (!err.status) log(`Request failed: ${err.stack || err.message}`)
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Server error' })
      else res.end()
    })
  })

  const listen = p => new Promise((resolve, reject) => {
    const onError = err => { server.off('listening', onListening); reject(err) }
    const onListening = () => { server.off('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(p, HOST)
  })

  let boundPort = null
  const attempts = port === 0 ? 1 : Math.max(1, portRange)
  for (let i = 0; i < attempts; i++) {
    const candidate = port === 0 ? 0 : port + i
    try {
      await listen(candidate)
      boundPort = server.address().port
      break
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err
      const other = await probe(candidate)
      if (other?.name === NAME && other.root === ROOT) {
        return { url: `http://${HOST}:${candidate}/`, port: candidate, root: ROOT, reused: true, close: async () => {} }
      }
    }
  }
  if (boundPort === null) throw new Error(`No free port between ${port} and ${port + attempts - 1}`)

  allowedHosts = new Set([`${HOST}:${boundPort}`, `localhost:${boundPort}`])
  allowedOrigins = new Set([...allowedHosts].map(h => `http://${h}`))

  let watcher = null
  try {
    watcher = watch(ROOT, { recursive: true }, (_event, file) => {
      if (file && String(file).split(/[\\/]/).some(p => p.startsWith('.'))) return
      notify()
    })
    watcher.on('error', () => {})
  } catch (err) {
    log(`Live refresh unavailable: ${err.message}`)
  }
  const ping = setInterval(() => { for (const res of clients) res.write(': ping\n\n') }, 25000)
  ping.unref()
  pruneThumbs()

  return {
    url: `http://${HOST}:${boundPort}/`,
    port: boundPort,
    root: ROOT,
    reused: false,
    async close() {
      clearInterval(ping)
      clearTimeout(pending)
      watcher?.close()
      for (const res of clients) res.end()
      clients.clear()
      await saving
      await new Promise(resolve => server.close(() => resolve()))
    },
  }
}
