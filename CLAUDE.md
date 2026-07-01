# CLAUDE.md

Guidance for working on this repo (E2A Filming Prompter, a static PWA).

## Service worker cache-busting

`sw.js` caches the app shell under `CACHE_NAME`. The fetch handler serves
cached files first and only updates the cache in the background, so a
change to any cached file (`index.html`, `css/style.css`, any `js/*.js`,
`manifest.json`, icons) will NOT reliably reach a mobile device that
already installed the PWA unless `CACHE_NAME` in `sw.js` is bumped
(e.g. `e2a-prompter-v2` -> `e2a-prompter-v3`).

**Bump `CACHE_NAME` in `sw.js` on every commit that touches any cached
file.** Skipping this means the user is testing stale code on their
phone. After bumping, the user still needs to fully close/reopen the
app (or reload twice) for the new service worker to take over.
