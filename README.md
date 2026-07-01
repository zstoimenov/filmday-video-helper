# filmday-video-helper

**E2A Filming Prompter** — a single-purpose teleprompter and take-tracker for filming *Емигрирай в Австралия* (E2A). Paste a scene-card script, get filming cards with a single take-tracking button, and export session analytics afterward to feed back into script efficiency review.

Live app: https://zstoimenov.github.io/filmday-video-helper/

## What it does

- Paste a script written in the project's scene-card format; it's parsed into a sequence of filming cards (tolerant of `CARD:`, `CARD 1:`, `## Card 1`, or numbered-list headers — falls back to a single raw card if parsing fails, so you're never blocked).
- Each card shows its 🔒 LOCKED lines (must say exactly), 🔓 FREE delivery notes, IDEA line, and ANCHOR words (highlighted in orange wherever they appear in the card text).
- One button tracks takes: first tap starts the card's timer and logs Take 1; every subsequent tap logs Take 2, Take 3, etc. with a timestamp relative to the card's start.
- A separate control advances to the next card (stopping that card's timer); on the last card it becomes **End Session**.
- Swipe left/right also advances/rewinds cards.
- After a session ends, a summary dashboard shows total takes, total filming time, a per-card breakdown, flagged cards (most retakes, longest average time per take), and a LOCKED vs FREE retake comparison.
- Sessions export to JSON and CSV for pasting into a script-review conversation.

## Tech

- Static site, vanilla JavaScript (ES modules), no build step, no framework.
- Client-side storage via raw IndexedDB — multi-session history, no backend, no login.
- Installable PWA (`manifest.json` + `sw.js`) with offline support for locations without wifi.
- Hosted on GitHub Pages, deployed from `main` / root.

## Project structure

```
index.html          Single-page app shell (home, new session, filming, summary views)
css/style.css        Dark theme (near-black background, orange accent)
js/db.js              IndexedDB wrapper
js/parser.js          Scene-card script parser
js/analytics.js       Session/card stats (takes, timing, LOCKED vs FREE)
js/export.js          JSON/CSV export
js/app.js              View controller and filming-flow logic
manifest.json, sw.js   PWA manifest and service worker (offline app-shell caching)
icons/                 App icons
```

## Local development

No build step is required. Serve the repo root with any static file server and open it in a browser, e.g.:

```
npx http-server -p 8080
```

Then visit `http://localhost:8080/index.html`.

## Deployment

GitHub Pages is configured to deploy from `main` at the repository root (`Settings → Pages → Deploy from a branch → main / (root)`). Pushing to `main` triggers a new Pages build automatically.
