# Working on local-gallery

A zero-dependency Node.js CLI that serves a folder of images and videos as a
browser gallery. Read `README.md` for the user-facing behaviour.

## Layout

- `bin/local-gallery.mjs`: command-line entry (argument parsing, output).
- `src/server.mjs`: `startGallery()` and the HTTP API; pure helpers are exported for tests.
- `public/`: the web interface (plain ES modules, no build step).
  `i18n.js` holds every interface string in English and Polish.
- `skills/local-gallery/SKILL.md`: instructions for AI agents that use the gallery.
- `test/`: `node:test` suites. Run `npm test`.

## Rules

- No runtime or development dependencies. Use Node.js built-ins (Node 20+) and
  browser APIs only.
- Never modify, move or delete the user's media. The only files written are in
  `<root>/.local-gallery/` (thumbnails and `state.json`).
- Keep the security checks: listen on `127.0.0.1` only, reject unknown `Host`
  headers, reject cross-origin `POST` requests, resolve every client path with
  `resolveInside()` and never serve dot-files or non-media files.
- Add new interface text to both languages in `public/i18n.js`.
- Add or update tests for server behaviour. Check UI changes in a browser at
  desktop and phone widths.
- Code, comments, commit messages and documentation are in English.
