import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseDims, resolveInside, startGallery } from '../src/server.mjs'

// ---------- minimal image headers ----------

const png = (w, h) => {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(w, 16)
  buf.writeUInt32BE(h, 20)
  return buf
}
const gif = (w, h) => {
  const buf = Buffer.alloc(13)
  buf.write('GIF89a', 0, 'ascii')
  buf.writeUInt16LE(w, 6)
  buf.writeUInt16LE(h, 8)
  return buf
}
const webp = (w, h) => {
  const buf = Buffer.alloc(30)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(22, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8X', 12, 'ascii')
  buf.writeUInt32LE(10, 16)
  buf.writeUIntLE(w - 1, 24, 3)
  buf.writeUIntLE(h - 1, 27, 3)
  return buf
}
const jpeg = (w, h) => Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
])

test('parseDims reads PNG, GIF, WebP and JPEG headers', () => {
  assert.deepEqual(parseDims(png(1024, 1536), '.png'), [1024, 1536])
  assert.deepEqual(parseDims(gif(64, 32), '.gif'), [64, 32])
  assert.deepEqual(parseDims(webp(1920, 1080), '.webp'), [1920, 1080])
  assert.deepEqual(parseDims(jpeg(800, 600), '.jpg'), [800, 600])
  assert.equal(parseDims(Buffer.from('not an image'), '.png'), null)
})

test('resolveInside rejects traversal and hidden paths', () => {
  const root = path.resolve('gallery-root')
  assert.equal(resolveInside(root, 'A/b.png'), path.join(root, 'A', 'b.png'))
  assert.equal(resolveInside(root, '../secret.png'), null)
  assert.equal(resolveInside(root, 'A/../../secret.png'), null)
  assert.equal(resolveInside(root, '.local-gallery/state.json'), null)
  assert.equal(resolveInside(root, ''), null)
})

// ---------- server ----------

let root
let gallery

function call(pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: gallery.port, path: pathname, method, headers: { Host: `127.0.0.1:${gallery.port}`, ...headers } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}
const origin = () => ({ Origin: `http://127.0.0.1:${gallery.port}` })

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'local-gallery-'))
  await mkdir(path.join(root, 'Characters', 'Heroes'), { recursive: true })
  await mkdir(path.join(root, '.hidden'))
  await writeFile(path.join(root, 'Characters', 'hero.png'), png(300, 200))
  await writeFile(path.join(root, 'Characters', 'Heroes', 'angel.gif'), gif(40, 80))
  await writeFile(path.join(root, 'cover.webp'), webp(1600, 900))
  await writeFile(path.join(root, 'notes.txt'), 'ignored')
  await writeFile(path.join(root, '.hidden', 'secret.png'), png(10, 10))
  gallery = await startGallery({ root, port: 0 })
})

after(async () => {
  await gallery?.close()
  await rm(root, { recursive: true, force: true })
})

test('library lists media files with folders and dimensions', async () => {
  const { status, json } = await call('/api/library')
  assert.equal(status, 200)
  assert.deepEqual(json.folders.sort(), ['Characters', 'Characters/Heroes'])
  const byPath = Object.fromEntries(json.items.map(item => [item.path, item]))
  assert.deepEqual(Object.keys(byPath).sort(), ['Characters/Heroes/angel.gif', 'Characters/hero.png', 'cover.webp'])
  assert.equal(byPath['Characters/hero.png'].folder, 'Characters')
  assert.equal(byPath['Characters/hero.png'].w, 300)
  assert.equal(byPath['Characters/hero.png'].h, 200)
  assert.equal(byPath['cover.webp'].folder, '')
})

test('info identifies the gallery and its folder', async () => {
  const { json } = await call('/api/info')
  assert.equal(json.name, 'local-gallery')
  assert.equal(json.root, path.resolve(root))
})

test('media is served with ranges, downloads and no traversal', async () => {
  const full = await call('/media/Characters/hero.png')
  assert.equal(full.status, 200)
  assert.equal(full.headers['content-type'], 'image/png')
  const part = await call('/media/Characters/hero.png', { headers: { Range: 'bytes=0-7' } })
  assert.equal(part.status, 206)
  assert.equal(part.headers['content-length'], '8')
  const dl = await call('/media/cover.webp?download=1')
  assert.match(dl.headers['content-disposition'], /attachment/)
  assert.equal((await call('/media/..%2Fsecret.png')).status, 404)
  assert.equal((await call('/media/.hidden/secret.png')).status, 404)
  assert.equal((await call('/media/notes.txt')).status, 404)
})

test('requests with another Host header are rejected', async () => {
  const res = await call('/api/library', { headers: { Host: 'attacker.example' } })
  assert.equal(res.status, 403)
})

test('writes from another origin are rejected', async () => {
  const res = await call('/api/favorite', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: ['cover.webp'], value: true }),
  })
  assert.equal(res.status, 403)
})

test('favorites are saved in the hidden state folder', async () => {
  const res = await call('/api/favorite', {
    method: 'POST',
    headers: { ...origin(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: ['cover.webp'], value: true }),
  })
  assert.equal(res.status, 200)
  const saved = JSON.parse(await readFile(path.join(root, '.local-gallery', 'state.json'), 'utf8'))
  assert.deepEqual(saved.favorites, ['cover.webp'])
  const lib = await call('/api/library')
  assert.equal(lib.json.items.find(item => item.path === 'cover.webp').favorite, true)
  const bad = await call('/api/favorite', {
    method: 'POST',
    headers: { ...origin(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: ['../outside.png'], value: true }),
  })
  assert.equal(bad.status, 400)
})

test('thumbnails must be WebP and are then listed', async () => {
  const rejected = await call('/api/thumb?path=Characters%2Fhero.png', { method: 'POST', headers: origin(), body: png(10, 10) })
  assert.equal(rejected.status, 415)
  const accepted = await call('/api/thumb?path=Characters%2Fhero.png', { method: 'POST', headers: origin(), body: webp(30, 20) })
  assert.equal(accepted.status, 200)
  assert.match(accepted.json.thumb, /^\/thumb\/[a-f0-9]{24}\.webp$/)
  const thumb = await call(accepted.json.thumb)
  assert.equal(thumb.status, 200)
  const lib = await call('/api/library')
  assert.equal(lib.json.items.find(item => item.path === 'Characters/hero.png').thumb, accepted.json.thumb)
})

test('a second start for the same folder reuses the running gallery', async () => {
  const again = await startGallery({ root, port: gallery.port, portRange: 2 })
  assert.equal(again.reused, true)
  assert.equal(again.port, gallery.port)
})

test('a missing folder is reported', async () => {
  await assert.rejects(startGallery({ root: path.join(root, 'missing'), port: 0 }), /Folder not found/)
})
