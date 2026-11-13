---
name: local-gallery
description: Show a folder of images and videos in a local browser gallery with folders, lightbox, favorites and live refresh. Use when the user wants to browse, review or present media saved on disk (for example AI-generated images or videos), or when you save generated media into a folder the user views with local-gallery.
---

# local-gallery

`local-gallery` serves one folder at `http://127.0.0.1:<port>/`. Subfolders become
sections in the sidebar. New files appear in the open page within a second, so
you can save results and the user sees them without reloading.

## Start or find the gallery

```sh
npx local-gallery "<folder>" --no-open --json
```

This prints one JSON line: `{"url","root","port","reused"}`. If a gallery for
the same folder is already running, `reused` is `true` and the command exits
right away. Otherwise the server keeps running: start it in the background
(it is a long-running process) and keep the URL. Omit `--no-open` when the user
wants the browser opened for them. Do not start a second server for a folder
that is already served.

If the package is not installed from npm yet, use
`npx github:MakowskiHubert/local-gallery` in place of `npx local-gallery`.

## Save media so it shows up well

- Put files in a meaningful subfolder of the gallery root (one folder per
  project, character or topic). The user may have a naming convention; follow it.
- Supported: PNG, JPG, WebP, GIF, AVIF, BMP, SVG, MP4, WebM, MOV.
- Write each file completely before it appears under its final name (save to a
  temporary name in the same folder, then rename), so the gallery never shows a
  half-written file.
- Do not create, edit or delete anything inside `<root>/.local-gallery/`.

## Read what the user picked

The user marks favorites with the heart icon. They are stored as paths relative
to the root in `<root>/.local-gallery/state.json` under `favorites`. Read this file
(or `GET <url>api/library`, where each item has `favorite: true|false`) when the
user says "use the ones I liked" or asks which takes they chose.

## Stop

Stop the process you started (Ctrl+C in its terminal, or end the background
task). Never stop a gallery you did not start.
