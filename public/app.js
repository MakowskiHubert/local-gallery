// local-gallery UI: folders, justified tiles, lightbox. Talks to src/server.mjs.

import { LANGUAGES, STRINGS, resolveLanguage } from './i18n.js'

const $ = selector => document.querySelector(selector)

const ICONS = {
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  filter: '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  images: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  play: '<path d="M6 3l14 9-14 9V3z"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
}
const icon = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`

// Target row heights for the justified grid.
const SIZES = { s: 180, m: 280, l: 420 }
const GAP = 2
const MAX_ROW_ITEMS = 14
const THUMB_MAX_H = 720
const THUMB_MAX_W = 1440
const THUMBABLE = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'])

// ---------- preferences and language ----------

const PREFS_KEY = 'local-gallery.prefs.v1'
const prefs = { size: 'm', sort: 'new', type: 'all', favOnly: false, lang: 'auto', collapsed: [], ...readPrefs() }
function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {} } catch { return {} }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
}

let lang = 'en'
let collator, dateFmt, numFmt
function t(key, vars) {
  const value = STRINGS[lang][key] ?? STRINGS.en[key] ?? key
  if (typeof value === 'function') return value(vars)
  return vars ? value.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : value
}
function applyLanguage() {
  lang = resolveLanguage(prefs.lang)
  document.documentElement.lang = lang
  collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' })
  dateFmt = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' })
  numFmt = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 })
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n) })
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle) })
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)) })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder) })
}

const SORTS = {
  new: (a, b) => b.mtime - a.mtime || collator.compare(a.name, b.name),
  old: (a, b) => a.mtime - b.mtime || collator.compare(a.name, b.name),
  az: (a, b) => collator.compare(a.name, b.name),
  za: (a, b) => collator.compare(b.name, a.name),
}

const state = {
  lib: null,
  byPath: new Map(),
  tree: null,
  counts: new Map(),
  order: new Map(),
  nav: 'all',
  query: '',
  selected: new Set(),
  lastSelected: -1,
  view: [],
  sections: [],
  tiles: new Map(),
  lb: -1,
  offline: false,
}

// ---------- helpers ----------

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const encodePath = p => p.split('/').map(encodeURIComponent).join('/')
const mediaUrl = item => `/media/${encodePath(item.path)}?v=${item.mtime}`
const absPath = item => state.lib.root + state.lib.sep + item.path.split('/').join(state.lib.sep)
const folderLabel = folder => folder ? folder.split('/').join(' / ') : t('topLevel')
const aspect = item => item._ar || (item.w && item.h ? item.w / item.h : item.type === 'video' ? 16 / 9 : 1)

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${numFmt.format(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${numFmt.format(bytes / 1024 ** 2)} MB`
  return `${numFmt.format(bytes / 1024 ** 3)} GB`
}

let toastTimer
function toast(message) {
  const el = $('#toast')
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800)
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ---------- library ----------

function setLibrary(lib) {
  for (const item of lib.items) {
    const old = state.byPath.get(item.path)
    if (old && old.key === item.key) {
      item._ar = old._ar
      if (!item.thumb && old.thumb) item.thumb = old.thumb
    }
  }
  state.lib = lib
  state.byPath = new Map(lib.items.map(item => [item.path, item]))

  // Folder tree, sorted naturally, parents before children.
  const root = { path: '', name: '', children: [] }
  const nodes = new Map([['', root]])
  const depth = p => p.split('/').length
  for (const p of [...lib.folders].sort((a, b) => depth(a) - depth(b) || collator.compare(a, b))) {
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    const node = { path: p, name: p.slice(p.lastIndexOf('/') + 1), children: [] }
    nodes.set(p, node)
    ;(nodes.get(parent) || root).children.push(node)
  }
  const sortTree = node => { node.children.sort((a, b) => collator.compare(a.name, b.name)); node.children.forEach(sortTree) }
  sortTree(root)
  state.tree = root
  state.order = new Map([['', -1]])
  const walk = node => node.children.forEach(child => { state.order.set(child.path, state.order.size); walk(child) })
  walk(root)

  state.counts = new Map()
  for (const item of lib.items) {
    let folder = item.folder
    while (folder) {
      state.counts.set(folder, (state.counts.get(folder) || 0) + 1)
      folder = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
    }
  }

  for (const p of [...state.selected]) if (!state.byPath.has(p)) state.selected.delete(p)
  if (state.nav.startsWith('f:') && state.nav !== 'f:' && !nodes.has(state.nav.slice(2))) state.nav = 'all'
}

async function reload() {
  const res = await fetch('/api/library', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const current = state.lb >= 0 ? state.view[state.lb]?.path : null
  setLibrary(await res.json())
  state.offline = false
  render({ keepScroll: true })
  if (current) {
    const i = state.view.findIndex(item => item.path === current)
    if (i >= 0) { state.lb = i; updateLightboxChrome() } else closeLightbox()
  }
}

// ---------- navigation ----------
// Hash routes: #all, #favorites, #/Folder/Subfolder ("#/" is the top level).

function navFromHash() {
  let h = location.hash.slice(1)
  try { h = decodeURIComponent(h) } catch { return 'all' }
  if (h === 'favorites') return 'fav'
  if (h.startsWith('/')) return `f:${h.slice(1)}`
  return 'all'
}
function hashFor(nav) {
  if (nav === 'fav') return '#favorites'
  if (nav.startsWith('f:')) return `#/${encodePath(nav.slice(2))}`
  return '#all'
}
function go(nav) {
  document.body.classList.remove('nav-open')
  if (hashFor(nav) === location.hash) return
  location.hash = hashFor(nav)
}
window.addEventListener('hashchange', () => {
  state.nav = navFromHash()
  state.selected.clear()
  if (state.lib) render()
  window.scrollTo(0, 0)
})

function navButton(key, iconName, label, n) {
  return `<button class="nav-item${state.nav === key ? ' active' : ''}" type="button" data-nav="${esc(key)}" title="${esc(label)}">${icon(iconName)}<span class="label">${esc(label)}</span><span class="n">${n}</span></button>`
}
function treeNode(node) {
  const kids = node.children.length > 0
  const collapsed = prefs.collapsed.includes(node.path)
  const twisty = kids
    ? `<button class="twisty" type="button" data-twisty="${esc(node.path)}" aria-label="${t(collapsed ? 'expand' : 'collapse')}">${icon('down')}</button>`
    : '<span class="twisty-space"></span>'
  return `<li class="${collapsed ? 'collapsed' : ''}"><div class="tree-row">${twisty}${navButton(`f:${node.path}`, 'folder', node.name, state.counts.get(node.path) || 0)}</div>${kids ? `<ul>${node.children.map(treeNode).join('')}</ul>` : ''}</li>`
}
function renderNav() {
  const items = state.lib.items
  const favs = items.filter(item => item.favorite).length
  const rootFiles = items.filter(item => item.folder === '').length
  let html = navButton('all', 'images', t('all'), items.length) + navButton('fav', 'heart', t('favorites'), favs)
  html += `<div class="nav-label">${t('folders')}</div>`
  if (rootFiles) html += `<ul class="tree"><li><div class="tree-row"><span class="twisty-space"></span>${navButton('f:', 'folder', t('topLevel'), rootFiles)}</div></li></ul>`
  html += `<ul class="tree">${state.tree.children.map(treeNode).join('')}</ul>`
  if (!state.tree.children.length && !rootFiles) html += `<div class="nav-note">${t('noSubfolders')}</div>`
  $('#nav').innerHTML = html
  $('#root-path').textContent = state.lib.root
}

$('#nav').addEventListener('click', event => {
  const twisty = event.target.closest('[data-twisty]')
  if (twisty) {
    const p = twisty.dataset.twisty
    prefs.collapsed = prefs.collapsed.includes(p) ? prefs.collapsed.filter(x => x !== p) : [...prefs.collapsed, p]
    savePrefs()
    renderNav()
    return
  }
  const nav = event.target.closest('[data-nav]')
  if (nav) go(nav.dataset.nav)
})

// ---------- header, filters and view ----------

function renderHeader(count) {
  const nav = state.nav
  let html
  let title
  if (nav === 'all') html = `<span class="crumb">${esc(title = t('all'))}</span>`
  else if (nav === 'fav') html = `<span class="crumb">${esc(title = t('favorites'))}</span>`
  else if (nav === 'f:') html = `<span class="crumb">${esc(title = t('topLevel'))}</span>`
  else {
    const parts = nav.slice(2).split('/')
    title = parts[parts.length - 1]
    html = parts.map((part, i) => i === parts.length - 1
      ? `<span class="crumb">${esc(part)}</span>`
      : `<button class="crumb" type="button" data-nav="f:${esc(parts.slice(0, i + 1).join('/'))}">${esc(part)}</button>`
    ).join(`<span class="sep">${icon('right')}</span>`)
  }
  $('#crumbs').innerHTML = html
  $('#count').textContent = `${count} ${t('files', count)}`
  document.title = `${title} · ${t('appName')}`
}
$('#crumbs').addEventListener('click', event => {
  const nav = event.target.closest('[data-nav]')
  if (nav) go(nav.dataset.nav)
})

function option(pref, value, label) {
  return `<button class="opt${prefs[pref] === value ? ' on' : ''}" type="button" data-pref="${pref}" data-val="${value}">${esc(label)}<span class="tick">${icon('check')}</span></button>`
}
function segment(pref, value, label) {
  return `<button class="${prefs[pref] === value ? 'on' : ''}" type="button" data-pref="${pref}" data-val="${value}">${esc(label)}</button>`
}
function renderMenus() {
  $('#filter-menu').innerHTML = `<h4>${t('fileType')}</h4>${option('type', 'all', t('everything'))}${option('type', 'image', t('images'))}${option('type', 'video', t('videos'))}<div class="sep-line"></div><button class="opt${prefs.favOnly ? ' on' : ''}" type="button" data-pref="favOnly" data-val="toggle">${icon('heart')}${t('favoritesOnly')}<span class="tick">${icon('check')}</span></button>`
  const languages = Object.entries({ auto: t('auto'), ...LANGUAGES }).map(([code, label]) => segment('lang', code, label)).join('')
  $('#view-menu').innerHTML = `<h4>${t('tileSize')}</h4><div class="seg">${segment('size', 's', t('small'))}${segment('size', 'm', t('medium'))}${segment('size', 'l', t('large'))}</div><h4>${t('sortBy')}</h4>${option('sort', 'new', t('newest'))}${option('sort', 'old', t('oldest'))}${option('sort', 'az', t('nameAz'))}${option('sort', 'za', t('nameZa'))}<div class="sep-line"></div><h4>${t('language')}</h4><div class="seg">${languages}</div>`
  $('#filter-btn').classList.toggle('on', prefs.type !== 'all' || prefs.favOnly)
}

function toggleMenu(button, menu) {
  const open = menu.hidden
  closeMenus()
  if (!open) return
  menu.hidden = false
  button.setAttribute('aria-expanded', 'true')
}
function closeMenus() {
  for (const [b, m] of [['#filter-btn', '#filter-menu'], ['#view-btn', '#view-menu']]) {
    $(m).hidden = true
    $(b).setAttribute('aria-expanded', 'false')
  }
  closePop()
}
$('#filter-btn').addEventListener('click', event => { event.stopPropagation(); toggleMenu($('#filter-btn'), $('#filter-menu')) })
$('#view-btn').addEventListener('click', event => { event.stopPropagation(); toggleMenu($('#view-btn'), $('#view-menu')) })
for (const menu of ['#filter-menu', '#view-menu']) {
  $(menu).addEventListener('click', event => {
    event.stopPropagation()
    const opt = event.target.closest('[data-pref]')
    if (!opt) return
    const { pref, val } = opt.dataset
    prefs[pref] = pref === 'favOnly' ? !prefs.favOnly : val
    savePrefs()
    if (pref === 'lang') applyLanguage()
    renderMenus()
    if (!state.lib) return
    if (pref === 'size') layout()
    else render({ keepScroll: pref !== 'type' && pref !== 'favOnly' })
  })
}
document.addEventListener('click', event => {
  if (!event.target.closest('.menu, .pop')) closeMenus()
})

let searchTimer
$('#search').addEventListener('input', event => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { state.query = event.target.value.trim(); if (state.lib) render() }, 120)
})

// ---------- grid ----------

function visibleItems() {
  const q = norm(state.query)
  const nav = state.nav
  let list = state.lib.items
  if (nav === 'fav') list = list.filter(item => item.favorite)
  else if (nav === 'f:') list = list.filter(item => item.folder === '')
  else if (nav.startsWith('f:')) {
    const p = nav.slice(2)
    list = list.filter(item => item.folder === p || item.folder.startsWith(`${p}/`))
  }
  if (prefs.type !== 'all') list = list.filter(item => item.type === prefs.type)
  if (prefs.favOnly && nav !== 'fav') list = list.filter(item => item.favorite)
  if (q) list = list.filter(item => norm(item.name).includes(q) || norm(item.folder).includes(q))
  return [...list].sort(SORTS[prefs.sort] || SORTS.new)
}

function emptyState(title, html) {
  return `<div class="empty"><div><h2>${esc(title)}</h2><p>${html}</p></div></div>`
}

function render({ keepScroll = false } = {}) {
  const y = window.scrollY
  closePop()
  renderNav()
  renderMenus()
  const list = visibleItems()
  renderHeader(list.length)

  const groups = new Map()
  for (const item of list) {
    if (!groups.has(item.folder)) groups.set(item.folder, [])
    groups.get(item.folder).push(item)
  }
  const sections = [...groups].sort((a, b) => (state.order.get(a[0]) ?? 1e9) - (state.order.get(b[0]) ?? 1e9))
  state.view = sections.flatMap(([, items]) => items)
  state.sections = []
  state.tiles = new Map()

  const content = $('#content')
  content.textContent = ''
  if (!state.lib.items.length) {
    content.innerHTML = emptyState(t('emptyTitle'), esc(t('emptyText', { root: '\u0000' })).replace('\u0000', `<code>${esc(state.lib.root)}</code>`))
  } else if (!list.length) {
    content.innerHTML = emptyState(t('noMatchTitle'), esc(t('noMatchText')))
  }

  const ownFolder = state.nav.startsWith('f:') ? state.nav.slice(2) : null
  const showHeads = sections.length > 1 || (sections.length === 1 && sections[0][0] !== ownFolder)
  let index = 0
  for (const [folder, items] of sections) {
    const section = document.createElement('section')
    section.className = 'sec'
    if (showHeads) {
      section.innerHTML = `<div class="sec-head"><button class="sec-title" type="button" data-nav="f:${esc(folder)}">${icon('folder')}<span>${esc(folderLabel(folder))}</span></button><span class="sec-count">${items.length}</span></div>`
    }
    const grid = document.createElement('div')
    grid.className = 'grid'
    const tiles = items.map(item => tileElement(item, index++))
    grid.append(...tiles)
    section.append(grid)
    content.append(section)
    state.sections.push({ grid, items, tiles })
  }
  layout()
  if (keepScroll) window.scrollTo(0, y)
  updateSelection()
}

function tileElement(item, i) {
  const el = document.createElement('div')
  el.className = `tile${item.favorite ? ' fav' : ''}${state.selected.has(item.path) ? ' selected' : ''}${item.type === 'video' ? ' video' : ''}`
  el.dataset.i = i
  el.dataset.msg = t('cannotLoad')
  const media = item.type === 'video' && !item.thumb
    ? `<video muted playsinline preload="metadata" src="${mediaUrl(item)}#t=0.5"></video>`
    : `<img loading="lazy" decoding="async" draggable="false" alt="${esc(item.name)}" src="${item.thumb || mediaUrl(item)}">`
  el.innerHTML = `${media}
    <button class="sel" type="button" data-act="select" title="${t('select')}" aria-label="${t('select')}">${icon('check')}</button>
    <span class="fav-badge">${icon('heart')}</span>
    <div class="actions">
      <button class="act${item.favorite ? ' on' : ''}" type="button" data-act="fav" title="${t(item.favorite ? 'removeFavorite' : 'addFavorite')}">${icon('heart')}</button>
      <button class="act" type="button" data-act="download" title="${t('download')}">${icon('download')}</button>
      <button class="act" type="button" data-act="copy" title="${t(item.type === 'image' ? 'copyImage' : 'copyPath')}">${icon('copy')}</button>
      <button class="act" type="button" data-act="more" title="${t('more')}">${icon('more')}</button>
    </div>
    ${item.type === 'video' ? `<span class="play-badge">${icon('play')}</span>` : ''}
    <div class="name">${esc(item.name)}</div>`
  watchMedia(item, el.firstElementChild)
  if (item.type === 'video') {
    el.addEventListener('mouseenter', () => startPreview(item, el))
    el.addEventListener('mouseleave', () => stopPreview(el))
  }
  state.tiles.set(item.path, el)
  return el
}

function watchMedia(item, media) {
  if (media.tagName === 'IMG') {
    media.addEventListener('load', () => {
      const w = media.naturalWidth, h = media.naturalHeight
      if (!w || !h) return
      measured(item, w, h, !item.thumb || media.src.includes('/media/'))
      if (item.type === 'image' && !item.thumb && THUMBABLE.has(item.ext) &&
          (h > THUMB_MAX_H * 1.15 || w > THUMB_MAX_W * 1.15 || item.size > 700_000)) {
        queueThumb(item, media, w, h)
      }
    }, { once: true })
    media.addEventListener('error', () => media.parentElement?.classList.add('broken'), { once: true })
  } else {
    media.addEventListener('loadeddata', () => {
      measured(item, media.videoWidth, media.videoHeight, true)
      queueThumb(item, media, media.videoWidth, media.videoHeight)
    }, { once: true })
    media.addEventListener('error', () => media.parentElement?.classList.add('broken'), { once: true })
  }
}

// Correct the layout when the real media size differs from what the server reported.
function measured(item, w, h, full) {
  if (!w || !h) return
  if (full && (!item.w || !item.h)) { item.w = w; item.h = h }
  if (Math.abs(w / h - aspect(item)) > 0.01) {
    item._ar = w / h
    if (full) { item.w = w; item.h = h }
    scheduleLayout()
  }
}

function startPreview(item, el) {
  let video = el.querySelector('video')
  if (!video) {
    video = document.createElement('video')
    video.className = 'preview'
    video.muted = true
    video.playsInline = true
    video.src = mediaUrl(item)
    el.prepend(video)
  }
  video.loop = true
  video.play().catch(() => {})
}
function stopPreview(el) {
  const video = el.querySelector('video')
  if (!video) return
  video.pause()
  if (video.classList.contains('preview')) video.remove()
}

// Justified rows: choose row breaks for the whole section at once (dynamic
// programming), so every row fills the width with a height close to the target.
// Only the last row may stay unfilled, when stretching it would make it too tall.
function justify(ratios, width, target, gap) {
  const n = ratios.length
  const boxes = new Array(n)
  const best = new Array(n + 1).fill(Infinity)
  const from = new Array(n + 1).fill(0)
  const filled = new Array(n + 1).fill(true)
  best[0] = 0
  for (let j = 1; j <= n; j++) {
    let sum = 0
    for (let i = j - 1; i >= 0 && j - i <= MAX_ROW_ITEMS; i--) {
      sum += ratios[i]
      const count = j - i
      const h = (width - gap * (count - 1)) / sum
      const dev = (h - target) / target
      let cost = dev < 0 ? dev * dev : 1.6 * dev * dev
      if (h > target * 2.2) cost += 50
      let fill = true
      if (j === n && h > target) {
        // Last row: leaving it at the target height costs a little for the empty space.
        const loose = 0.35 * (1 - (sum * target + gap * (count - 1)) / width)
        if (loose < cost) { cost = loose; fill = false }
      }
      if (best[i] + cost < best[j]) {
        best[j] = best[i] + cost
        from[j] = i
        filled[j] = fill
      }
    }
  }
  const rows = []
  for (let j = n; j > 0; j = from[j]) rows.unshift([from[j], j, j === n ? filled[j] : true])
  let y = 0
  for (const [start, end, fill] of rows) {
    let sum = 0
    for (let k = start; k < end; k++) sum += ratios[k]
    const count = end - start
    const h = fill ? (width - gap * (count - 1)) / sum : target
    let x = 0
    for (let k = start; k < end; k++) {
      const left = Math.round(x)
      x += ratios[k] * h
      const right = fill && k === end - 1 ? width : Math.round(x)
      boxes[k] = { x: left, y: Math.round(y), w: Math.max(1, right - left), h: Math.round(y + h) - Math.round(y) }
      x += gap
    }
    y += h + gap
  }
  return { boxes, height: Math.max(0, Math.round(y - gap)) }
}

function layout() {
  // Setting the grid heights can add or remove the page scrollbar, which changes
  // the available width, so repeat until the widths are stable.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    for (const section of state.sections) {
      const width = section.grid.clientWidth
      if (!width || (pass > 0 && width === section.width)) continue
      section.width = width
      changed = true
      const target = Math.min(SIZES[prefs.size] || SIZES.m, Math.max(110, width * 0.62))
      const { boxes, height } = justify(section.items.map(aspect), width, target, GAP)
      section.tiles.forEach((tile, k) => {
        const b = boxes[k]
        tile.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`
      })
      section.grid.style.height = `${height}px`
    }
    if (!changed) break
  }
}
let layoutQueued = false
function scheduleLayout() {
  if (layoutQueued) return
  layoutQueued = true
  requestAnimationFrame(() => { layoutQueued = false; layout() })
}
new ResizeObserver(() => {
  if (state.sections.some(section => section.grid.clientWidth !== section.width)) scheduleLayout()
}).observe($('#content'))

// ---------- thumbnails (made by the browser, cached by the server) ----------

const thumbJobs = []
let thumbRunning = 0
function queueThumb(item, media, w, h) {
  if (item.thumb || item._thumbing) return
  item._thumbing = true
  thumbJobs.push({ item, media, w, h })
  pumpThumbs()
}
function pumpThumbs() {
  while (thumbRunning < 2 && thumbJobs.length) {
    const job = thumbJobs.shift()
    thumbRunning++
    makeThumb(job).catch(() => {}).finally(() => { thumbRunning--; pumpThumbs() })
  }
}
const idle = () => new Promise(resolve => (window.requestIdleCallback || setTimeout)(resolve, { timeout: 500 }))
async function makeThumb({ item, media, w, h }) {
  await idle()
  const scale = Math.min(1, THUMB_MAX_H / h, THUMB_MAX_W / w)
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  let bitmap = null
  try { bitmap = await createImageBitmap(media, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' }) } catch { /* draw directly */ }
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap || media, 0, 0, tw, th)
  bitmap?.close()
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.86))
  if (!blob || blob.type !== 'image/webp') return
  const res = await fetch(`/api/thumb?path=${encodeURIComponent(item.path)}&w=${w}&h=${h}`, { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: blob })
  if (res.ok) item.thumb = (await res.json()).thumb
}

// ---------- tile actions ----------

$('#content').addEventListener('click', event => {
  const nav = event.target.closest('[data-nav]')
  if (nav) return go(nav.dataset.nav)
  const tile = event.target.closest('.tile')
  if (!tile) return
  const index = Number(tile.dataset.i)
  const item = state.view[index]
  const actionEl = event.target.closest('[data-act]')
  const action = actionEl?.dataset.act
  if (action === 'select' || (!action && (event.ctrlKey || event.metaKey || event.shiftKey || state.selected.size))) {
    return toggleSelect(index, event.shiftKey)
  }
  if (action === 'fav') return setFavorite([item], !item.favorite)
  if (action === 'download') return download(item)
  if (action === 'copy') return copyItem(item)
  if (action === 'more') { event.stopPropagation(); return itemMenu(item, actionEl) }
  openLightbox(index)
})

function toggleSelect(index, range) {
  const item = state.view[index]
  if (range && state.lastSelected >= 0) {
    const [a, b] = [Math.min(index, state.lastSelected), Math.max(index, state.lastSelected)]
    for (let i = a; i <= b; i++) state.selected.add(state.view[i].path)
  } else if (state.selected.has(item.path)) state.selected.delete(item.path)
  else state.selected.add(item.path)
  state.lastSelected = index
  updateSelection()
}
function updateSelection() {
  for (const [p, tile] of state.tiles) tile.classList.toggle('selected', state.selected.has(p))
  const n = state.selected.size
  document.body.classList.toggle('selecting', n > 0)
  $('#selbar').hidden = n === 0
  $('#sel-count').textContent = t('selected', { n })
}
function clearSelection() {
  state.selected.clear()
  state.lastSelected = -1
  updateSelection()
}
$('#selbar').addEventListener('click', event => {
  const action = event.target.closest('[data-sel]')?.dataset.sel
  const items = [...state.selected].map(p => state.byPath.get(p)).filter(Boolean)
  if (action === 'fav') setFavorite(items, true)
  else if (action === 'unfav') setFavorite(items, false)
  else if (action === 'paths') copyText(items.map(absPath).join('\n'), t('copiedPaths', { n: items.length }))
  else if (action === 'all') { state.view.forEach(item => state.selected.add(item.path)); updateSelection() }
  else if (action === 'clear') clearSelection()
})

async function setFavorite(items, value) {
  if (!items.length) return
  const previous = items.map(item => item.favorite)
  const apply = () => {
    for (const item of items) {
      const tile = state.tiles.get(item.path)
      if (!tile) continue
      tile.classList.toggle('fav', item.favorite)
      const button = tile.querySelector('[data-act="fav"]')
      button.classList.toggle('on', item.favorite)
      button.title = t(item.favorite ? 'removeFavorite' : 'addFavorite')
    }
    if (state.nav === 'fav' || prefs.favOnly) render({ keepScroll: true })
    else renderNav()
    updateLightboxChrome()
  }
  items.forEach(item => { item.favorite = value })
  apply()
  try {
    await post('/api/favorite', { paths: items.map(item => item.path), value })
    if (items.length > 1) toast(t(value ? 'addedFavorites' : 'removedFavorites', { n: items.length }))
  } catch {
    items.forEach((item, i) => { item.favorite = previous[i] })
    apply()
    toast(t('favoriteFailed'))
  }
}

function download(item) {
  const a = document.createElement('a')
  a.href = `${mediaUrl(item)}&download=1`
  a.download = item.name
  document.body.append(a)
  a.click()
  a.remove()
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text })
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  toast(message)
}

async function copyItem(item) {
  if (item.type !== 'image' || item.ext === 'svg' || !window.ClipboardItem) {
    return copyText(absPath(item), t('copiedPath'))
  }
  // Clipboards accept PNG only, so other formats are converted first.
  const png = (async () => {
    const blob = await (await fetch(mediaUrl(item))).blob()
    if (blob.type === 'image/png') return blob
    const bitmap = await createImageBitmap(blob)
    const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    bitmap.close()
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  })()
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    toast(t('copiedImage'))
  } catch {
    copyText(absPath(item), t('copyImageFailed'))
  }
}

async function reveal(path) {
  try { await post('/api/reveal', path ? { path } : {}) } catch { toast(t('openFolderFailed')) }
}
$('#reveal-btn').addEventListener('click', () => {
  const nav = state.nav
  reveal(nav.startsWith('f:') && nav !== 'f:' ? nav.slice(2) : '')
})

// Small popover menu anchored to a button.
let pop = null
function closePop() {
  pop?.remove()
  pop = null
}
function openPop(anchor, entries) {
  closePop()
  pop = document.createElement('div')
  pop.className = 'pop'
  pop.innerHTML = entries.map(([ic, label], i) => `<button class="opt" type="button" data-k="${i}">${icon(ic)}${esc(label)}</button>`).join('')
  pop.addEventListener('click', event => {
    event.stopPropagation()
    const k = event.target.closest('[data-k]')?.dataset.k
    if (k === undefined) return
    closePop()
    entries[Number(k)][2]()
  })
  document.body.append(pop)
  const r = anchor.getBoundingClientRect()
  const pw = pop.offsetWidth, ph = pop.offsetHeight
  const left = Math.max(8, Math.min(r.right - pw, innerWidth - pw - 8))
  const top = r.bottom + 4 + ph > innerHeight - 8 ? Math.max(8, r.top - ph - 4) : r.bottom + 4
  pop.style.left = `${left}px`
  pop.style.top = `${top}px`
}
function itemMenu(item, anchor) {
  openPop(anchor, [
    ['zoom', t('openPreview'), () => openLightbox(state.view.indexOf(item))],
    ['folder', t('showInFolder'), () => reveal(item.path)],
    ['external', t('openInTab'), () => window.open(mediaUrl(item), '_blank', 'noopener')],
    ['link', t('copyPath'), () => copyText(absPath(item), t('copiedPath'))],
    ['text', t('copyName'), () => copyText(item.name, t('copiedName'))],
  ])
}
window.addEventListener('scroll', closePop, { passive: true })

// ---------- lightbox ----------

const lb = { el: $('#lightbox'), stage: $('#lb-stage'), zoomed: false, media: null, fit: 1 }

function openLightbox(index) {
  if (index < 0 || index >= state.view.length) return
  closeMenus()
  state.lb = index
  const item = state.view[index]
  lb.el.hidden = false
  document.body.classList.add('lb-open')
  lb.zoomed = false
  lb.stage.classList.remove('zoomed')
  lb.stage.textContent = ''
  const canvas = document.createElement('div')
  canvas.className = 'lb-canvas'
  let media
  if (item.type === 'video') {
    media = document.createElement('video')
    media.controls = true
    media.autoplay = true
    media.playsInline = true
    media.loop = true
    media.src = mediaUrl(item)
    media.addEventListener('loadedmetadata', () => { measured(item, media.videoWidth, media.videoHeight, true); fitLightbox() })
  } else {
    media = new Image()
    media.alt = item.name
    media.draggable = false
    media.decoding = 'async'
    // Show the cached thumbnail at once, then swap in the full image.
    media.src = item.thumb || mediaUrl(item)
    if (item.thumb) {
      const full = new Image()
      full.src = mediaUrl(item)
      full.decode().then(() => { if (lb.media === media) media.src = full.src }).catch(() => {})
    }
    media.addEventListener('load', () => {
      if (media.src.includes('/media/')) measured(item, media.naturalWidth, media.naturalHeight, true)
      fitLightbox()
    })
  }
  canvas.append(media)
  lb.stage.append(canvas)
  lb.media = media
  fitLightbox()
  updateLightboxChrome()
  for (const k of [index - 1, index + 1]) {
    const next = state.view[k]
    if (next?.type === 'image') new Image().src = mediaUrl(next)
  }
}

function closeLightbox() {
  if (lb.el.hidden) return
  lb.el.hidden = true
  lb.stage.textContent = ''
  lb.media = null
  state.lb = -1
  document.body.classList.remove('lb-open')
}

function step(delta) {
  if (state.lb < 0 || !state.view.length) return
  openLightbox((state.lb + delta + state.view.length) % state.view.length)
}

function naturalSize() {
  const item = state.view[state.lb]
  if (!item) return [1, 1]
  if (item.w && item.h) return [item.w, item.h]
  const m = lb.media
  return [m?.naturalWidth || m?.videoWidth || 1600 * aspect(item), m?.naturalHeight || m?.videoHeight || 1600]
}

function fitLightbox() {
  if (!lb.media || state.lb < 0) return
  const [w, h] = naturalSize()
  const sw = lb.stage.clientWidth - (innerWidth > 860 ? 128 : 16)
  const sh = lb.stage.clientHeight - 36
  lb.fit = Math.max(0.01, Math.min(sw / w, sh / h, 2))
  const scale = lb.zoomed ? zoomScale() : lb.fit
  lb.media.style.width = `${Math.round(w * scale)}px`
  lb.media.style.height = `${Math.round(h * scale)}px`
}
const zoomScale = () => (lb.fit < 1 ? 1 : Math.min(lb.fit * 2, 4))

function setZoom(on, clientX, clientY) {
  const item = state.view[state.lb]
  if (!lb.media || item?.type !== 'image') return
  const before = lb.media.getBoundingClientRect()
  const px = clientX !== undefined ? (clientX - before.left) / before.width : 0.5
  const py = clientY !== undefined ? (clientY - before.top) / before.height : 0.5
  lb.zoomed = on
  lb.stage.classList.toggle('zoomed', on)
  fitLightbox()
  if (on) {
    // Keep the clicked point under the cursor.
    const after = lb.media.getBoundingClientRect()
    const stage = lb.stage.getBoundingClientRect()
    const ax = clientX !== undefined ? clientX - stage.left : stage.width / 2
    const ay = clientY !== undefined ? clientY - stage.top : stage.height / 2
    lb.stage.scrollLeft = lb.media.offsetLeft + px * after.width - ax
    lb.stage.scrollTop = lb.media.offsetTop + py * after.height - ay
  }
  updateLightboxChrome()
}

function updateLightboxChrome() {
  const item = state.view[state.lb]
  if (!item || lb.el.hidden) return
  $('#lb-name').textContent = item.name
  const dims = item.w && item.h ? `${item.w} × ${item.h}` : ''
  $('#lb-meta').textContent = [folderLabel(item.folder), dims, formatSize(item.size), dateFmt.format(item.mtime)].filter(Boolean).join('  ·  ')
  $('#lb-counter').textContent = `${state.lb + 1} / ${state.view.length}`
  const fav = lb.el.querySelector('[data-lb="fav"]')
  fav.classList.toggle('on', !!item.favorite)
  fav.title = t(item.favorite ? 'unfavoriteKey' : 'favoriteKey')
  lb.el.querySelector('[data-lb="copy"]').title = t(item.type === 'image' ? 'copyImage' : 'copyPath')
  const zoom = lb.el.querySelector('[data-lb="zoom"]')
  zoom.hidden = item.type !== 'image'
  zoom.classList.toggle('on', lb.zoomed)
  const single = state.view.length < 2
  lb.el.querySelector('.lb-nav.prev').hidden = single
  lb.el.querySelector('.lb-nav.next').hidden = single
}

lb.el.addEventListener('click', event => {
  const action = event.target.closest('[data-lb]')?.dataset.lb
  const item = state.view[state.lb]
  if (!action || !item) return
  if (action === 'close') closeLightbox()
  else if (action === 'prev') step(-1)
  else if (action === 'next') step(1)
  else if (action === 'fav') setFavorite([item], !item.favorite)
  else if (action === 'download') download(item)
  else if (action === 'copy') copyItem(item)
  else if (action === 'reveal') reveal(item.path)
  else if (action === 'zoom') setZoom(!lb.zoomed)
})

// Click toggles zoom; drag pans when zoomed; swipe changes image on touch screens.
let drag = null
lb.stage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.tagName === 'VIDEO') return
  drag = { x: event.clientX, y: event.clientY, left: lb.stage.scrollLeft, top: lb.stage.scrollTop, moved: false }
  if (lb.zoomed) lb.stage.setPointerCapture(event.pointerId)
})
lb.stage.addEventListener('pointermove', event => {
  if (!drag) return
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
  if (lb.zoomed && drag.moved) {
    lb.stage.classList.add('dragging')
    lb.stage.scrollLeft = drag.left - dx
    lb.stage.scrollTop = drag.top - dy
  }
})
lb.stage.addEventListener('pointerup', event => {
  if (!drag) return
  const d = drag
  drag = null
  lb.stage.classList.remove('dragging')
  const dx = event.clientX - d.x
  if (!lb.zoomed && d.moved && Math.abs(dx) > 60 && event.pointerType !== 'mouse') return step(dx < 0 ? 1 : -1)
  if (d.moved) return
  // Pointer capture retargets events to the stage, so hit-test the image by position.
  const r = lb.media?.getBoundingClientRect()
  const onMedia = r && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
  if (onMedia) setZoom(!lb.zoomed, event.clientX, event.clientY)
  else if (!lb.zoomed) closeLightbox()
})
lb.stage.addEventListener('pointercancel', () => { drag = null; lb.stage.classList.remove('dragging') })
window.addEventListener('resize', () => { if (!lb.el.hidden) fitLightbox() })

// ---------- keyboard ----------

document.addEventListener('keydown', event => {
  const typing = event.target.closest?.('input, textarea')
  if (!lb.el.hidden) {
    if (event.key === 'Escape') lb.zoomed ? setZoom(false) : closeLightbox()
    else if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
    else if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) {
      const item = state.view[state.lb]
      if (item) setFavorite([item], !item.favorite)
    } else return
    event.preventDefault()
    return
  }
  if (event.key === 'Escape') {
    if (typing && event.target.value) return
    closeMenus()
    clearSelection()
    document.body.classList.remove('nav-open')
  } else if (event.key === '/' && !typing) {
    event.preventDefault()
    $('#search').focus()
  }
})

$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'))
$('#backdrop').addEventListener('click', () => document.body.classList.remove('nav-open'))

// ---------- start ----------

document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon) })
applyLanguage()
renderMenus()
state.nav = navFromHash()
reload().catch(() => {
  state.offline = true
  $('#content').innerHTML = emptyState(t('offlineTitle'), esc(t('offlineText')))
})

let refreshTimer
const events = new EventSource('/api/events')
events.addEventListener('change', () => {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => reload().catch(() => {}), 150)
})
events.addEventListener('open', () => { if (state.offline) reload().catch(() => {}) })
