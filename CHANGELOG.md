# Changelog

## 0.1.0

First release.

- Serve any folder with `npx local-gallery <folder>`; the next free port is used
  when the default one is busy, and a gallery already serving the same folder is reused.
- Justified tile grid, folder tree with counts, sections per folder.
- Lightbox with keyboard navigation, click-to-zoom and drag to pan.
- Favorites, multi-select, download, copy image, show in folder.
- Filter by type or favorites, three tile sizes, four sort orders, file name search.
- Live refresh when files change on disk.
- Browser-made WebP thumbnails cached in `<folder>/.local-gallery/`.
- English and Polish interface.
- `--json` output and an agent skill for AI coding agents.
