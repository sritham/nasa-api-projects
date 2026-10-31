# nasa-api-projects
to explore NASA API and vibe code applications

Small static web apps built on [NASA's open APIs](https://api.nasa.gov/). No build step and no server: plain HTML, CSS and JavaScript.

## Projects

| Project | Folder | API |
|---|---|---|
| Asteroid tracker: asteroids passing near Earth this week, with a chart and a sortable table | [`asteroids/`](asteroids/) | [NeoWs](https://api.nasa.gov/) (Near Earth Object Web Service) |

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## API key

NASA's shared `DEMO_KEY` allows only a few requests an hour. Get your own free key at https://api.nasa.gov/.

- **Locally:** copy `asteroids/config.example.js` to `asteroids/config.local.js` and put your key in it. That file is git-ignored, so the key never reaches GitHub.
- **On the live site:** open "API key settings" at the bottom of the page and paste your key. It's saved only in that browser.

The asteroid tracker also caches each week's data in the browser for 6 hours, which keeps the number of requests low.

## Hosting (GitHub Pages)

In the repo on GitHub: Settings → Pages → Source: "Deploy from a branch" → `main` / `(root)`. The site will be at https://sritham.github.io/nasa-api-projects/.
