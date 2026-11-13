#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { DEFAULT_PORT, NAME, VERSION, openInBrowser, startGallery } from '../src/server.mjs'

const HELP = `${NAME} ${VERSION}
Browse a folder of images and videos in your web browser.

Usage
  ${NAME} [folder] [options]

Arguments
  folder            Folder to show (default: current folder)

Options
  -p, --port <n>    Preferred port (default: ${DEFAULT_PORT}; the next free port is used if busy)
      --no-open     Do not open the browser
      --json        Print one JSON line {"url","root","port","reused"} for scripts and agents
  -v, --version     Print the version
  -h, --help        Show this help

Examples
  npx ${NAME} ~/Pictures/ai-renders
  npx ${NAME} "D:\\Gallery" --port 9000 --no-open --json

The gallery listens on 127.0.0.1 only. Thumbnails and favourites are kept in
<folder>/.local-gallery/; original files are never modified.`

let args
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p' },
      open: { type: 'boolean', default: true },
      'no-open': { type: 'boolean' },
      json: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  })
} catch (err) {
  console.error(`${err.message}\n\nRun "${NAME} --help" for usage.`)
  process.exit(2)
}
const { values, positionals } = args

if (values.help) {
  console.log(HELP)
  process.exit(0)
}
if (values.version) {
  console.log(VERSION)
  process.exit(0)
}
if (positionals.length > 1) {
  console.error(`Expected one folder, got ${positionals.length}. Quote paths that contain spaces.`)
  process.exit(2)
}

const port = values.port === undefined ? DEFAULT_PORT : Number(values.port)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid port: ${values.port}`)
  process.exit(2)
}

try {
  const gallery = await startGallery({
    root: positionals[0] || process.cwd(),
    port,
    log: message => console.error(message),
  })
  if (values.json) console.log(JSON.stringify({ url: gallery.url, root: gallery.root, port: gallery.port, reused: gallery.reused }))
  else if (gallery.reused) console.log(`${NAME} is already running for ${gallery.root}\n  ${gallery.url}`)
  else console.log(`${NAME} ${VERSION}\n  Folder: ${gallery.root}\n  Open:   ${gallery.url}\n  Press Ctrl+C to stop.`)
  if (values.open && !values['no-open']) openInBrowser(gallery.url)
  if (gallery.reused) process.exit(0)

  const stop = async () => {
    await gallery.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
