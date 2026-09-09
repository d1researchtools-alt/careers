# Chrome tooling

The header/footer are **hand-written Astro components** that reproduce the
design1st.com chrome. They are not a copy of the WordPress markup.

```
src/components/chrome/SiteHeader.astro     header
src/components/chrome/SiteFooter.astro     footer
src/components/chrome/ContactModals.astro  the two CTA popups
src/components/chrome/nav-data.ts          ALL menu + footer link content
src/components/chrome/icons.ts             inlined Font Awesome path data
src/styles/chrome.css                      every style, hand-written
src/pages/api/contact.ts                   Gravity Forms submit proxy
```

**To change a menu item, a footer link, or a badge: edit `nav-data.ts`.** That is
the whole point of this design — no WordPress round-trip, no re-snapshot.

## Why not the snapshot any more

`src/chrome/chrome.json` is still present and still works
(`CHROME_MODE=snapshot`), but it is no longer the default. It carried:

| | snapshot | hand-written |
| --- | --- | --- |
| chrome markup | 656 KB | 62 KB |
| chrome DOM nodes | 4,736 | 318 |
| stylesheets | 46 files + 247 KB inline | 15 KB, 2 files |
| scripts | 57 (jQuery → Elementor → Element Pack → smartmenus) | 0 external |
| webfonts | 319 KB | 0 |

For an SEO content surface that chrome was the single largest thing standing
between `/insights` and good Core Web Vitals.

### Rolling back

`CHROME_MODE=snapshot` restores the vendored Elementor chrome verbatim, in one
env var, with no code change. `Layout.astro` only imports and parses the
snapshot when that mode is active.

## `npm run chrome:diff` — prove it still matches

```bash
npm run dev          # in one shell
npm run chrome:diff  # in another
```

Screenshots the header and footer on both the candidate and live design1st.com
at four viewports (390 / 768 / 1440 / 1920), pixel-diffs each pair, and writes
reference / candidate / diff PNGs plus `report.json` into `artifacts/chrome-diff/`
(git-ignored). Exits non-zero if any region exceeds the threshold.

The region selectors match **either** chrome, so the same command A/Bs the
hand-written version or the snapshot against live without a flag.

**Threshold is 3%, not 0.5%.** The old bar suited a byte-for-byte copy that could
reach ~0. This is a reimplementation: it reproduces the design, not Elementor's
box tree, so a small residual (sub-pixel text metrics, SVG icon vs icon-font
glyph) is expected. Raise the implementation to the bar, not the bar to the
implementation.

> **Known expected failure since 2026-07-22: every text region.** We now ship the
> real Switzer (`src/styles/chrome.css`), which design1st.com asks for but has
> never served — so live renders in a fallback and we don't. Text regions will
> exceed 3% until WordPress ships the font too (handoff spec, Leo Ticket 2).
> This is the intended state, on an explicit owner decision.
>
> Do **not** "fix" it by reverting the font or by raising the threshold. What
> still has to hold is **geometry**: box positions, heights and gaps must match.
> When triaging a red run, read the diff PNGs — glyph-shaped noise inside a
> correctly-placed box is the known issue; a shifted or resized box is a real
> regression. Delete this note once the root site loads Switzer.

Notes baked into the harness (see comments there for the why):
- The Astro **dev toolbar** is hidden during capture.
- **Fixed/sticky elements are hidden** before capture. design1st.com renders a
  second `position: fixed` clone of its header once scrolled; without this it
  composites into the middle of the reference footer screenshot and reads as a
  chrome difference when it is a capture artifact.
- Each region is snapped to an **integer y-origin**, because the two pages have
  different-length bodies and a sub-pixel offset paints an antialiasing halo
  across every glyph.
- `waitUntil: "load"`, not `networkidle` — the live site's trackers never idle.

## `npm run chrome:tokens` — measure the live site

```bash
npm run chrome:tokens          # defaults to 1440
node scripts/extract-tokens.mjs 768
```

Dumps computed styles and bounding boxes for the live chrome's key elements to
`artifacts/tokens-<width>.json`. Every number in `chrome.css` came from here —
when something looks off, measure before guessing.

## `npm run chrome:badges` — optimise the footer award badges

WordPress serves each badge as a **base64-encoded PNG wrapped in an SVG**, at up
to 1135×966 for a logo displayed at 40×40 — about 1.1 MB for the strip. This
extracts the embedded raster, resizes to 2× display size and writes WebP:
**1.1 MB → 25 KB**. Sources are re-fetched automatically if missing, so it runs
from a clean checkout; only the `.webp` output is committed.

Re-run after changing badge artwork, and update `badges` in `nav-data.ts` if the
rendered sizes change.

## `npm run chrome:sync` — refresh the vendored snapshot

Only relevant to `CHROME_MODE=snapshot`, plus one thing the hand-written chrome
still depends on: `src/pages/api/contact.ts` replays Gravity Forms' signed
`state_NN` and `gform_currency` tokens out of `chrome.json`. Those are stable
across requests but **do rotate when the form is edited in WordPress**, so if
form submissions start failing, re-run this first.

After re-syncing, submit each form once for real and confirm the lead arrives —
markup parity does not prove a submission works.
