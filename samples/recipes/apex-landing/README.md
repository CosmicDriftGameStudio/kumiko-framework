## Screenshot renderer

`bun run screenshot` renders the sample page and shoots a full-page PNG via
Playwright (`page.setContent` — no server, because the renderer is pure). The
spec also paints a product-board mock (`hero-app.png`), uses it in the hero
`.shot-frame`, then writes `lightbox.png` with the overlay open. Docs embed
`screenshots/landing.png` and `screenshots/apex/lightbox.png`.

## Run

```bash
bun test            # both seams: block fallback + price/cap formatting
bun run screenshot  # → screenshots/landing.png + lightbox.png
```
