// Pixel-diffs the HEADER and FOOTER of a candidate page against the live
// design1st.com homepage across several viewports. The homepage body and the
// candidate body are different content by design, so only the two chrome
// regions are compared.
//
//   node scripts/compare-chrome.mjs [candidateUrl] [referenceUrl]
//
// Defaults:
//   candidate  http://localhost:4321/careers/
//   reference  https://design1st.com/
//
// Writes PNGs (reference / candidate / diff, per region per viewport) and a
// machine-readable report.json into artifacts/chrome-diff/. Exit code is 0 if
// every region is within THRESHOLD, 1 otherwise — so it doubles as a check.

import { chromium } from "playwright"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, "..", "artifacts", "chrome-diff")

const CANDIDATE = process.argv[2] || "http://localhost:4321/careers/"
const REFERENCE = process.argv[3] || "https://design1st.com/"

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "wide-1920", width: 1920, height: 1080 },
]

// Each selector matches EITHER chrome: the Elementor markup on design1st.com (and
// on the candidate when CHROME_MODE=snapshot), or the hand-written components.
// A page only ever renders one of the two, so page.$ resolves unambiguously and
// the same harness A/Bs native-vs-live and snapshot-vs-live without a flag.
const REGIONS = [
  { name: "header", selector: 'header[data-elementor-type="header"], header.d1-header' },
  { name: "footer", selector: 'footer[data-elementor-type="footer"], footer.d1-footer' },

  // Interactive states. The resting header and footer were the only things
  // checked for a long time, which is exactly why the mega menus shipped
  // unstyled and the hover colours were missing — nothing ever opened them.
  // These capture by viewport clip, not by element: the panel is absolutely
  // positioned, so it does not expand the header's own box.
  {
    name: "menu-services",
    selector: 'header[data-elementor-type="header"], header.d1-header',
    only: [1440],
    clipTo: ".ep-megamenu-panel.bdt-open, .d1-panel:not([hidden])",
    prepare: (page) => openMenu(page, 0),
  },
  {
    name: "menu-portfolio",
    selector: 'header[data-elementor-type="header"], header.d1-header',
    only: [1440],
    clipTo: ".ep-megamenu-panel.bdt-open, .d1-panel:not([hidden])",
    prepare: (page) => openMenu(page, 1),
  },

  // Hover states. Two real bugs shipped because nothing here ever hovered
  // anything: invented link-hover colours, and a mega-menu group whose entire
  // block highlights white as one target. Both were invisible to a resting
  // screenshot.
  {
    name: "menu-group-hover",
    selector: 'header[data-elementor-type="header"], header.d1-header',
    only: [1440],
    clipTo: ".ep-megamenu-panel.bdt-open, .d1-panel:not([hidden])",
    prepare: async (page) => {
      if (!(await openMenu(page, 0))) return false
      return hoverCentre(page, ".ep-megamenu-panel.bdt-open .bdt-element-link, .d1-panel:not([hidden]) .d1-group")
    },
  },
  {
    name: "footer-link-hover",
    selector: 'footer[data-elementor-type="footer"], footer.d1-footer',
    only: [1440],
    prepare: (page) =>
      hoverCentre(page, 'footer[data-elementor-type="footer"] .menu-link, footer.d1-footer .d1-footer__links a'),
  },

  // The simple list dropdowns (About / Free Tools) were styled entirely by
  // guess and never captured — they use a different panel treatment from the
  // mega menus (3px radius, no border, one shadow) and their links append an
  // orange arrow on hover.
  {
    name: "menu-about",
    selector: 'header[data-elementor-type="header"], header.d1-header',
    only: [1440],
    clipTo: ".ep-default-submenu-panel, .d1-panel--list:not([hidden])",
    prepare: (page) => openMenu(page, 2),
  },
  {
    name: "menu-about-hover",
    selector: 'header[data-elementor-type="header"], header.d1-header',
    only: [1440],
    clipTo: ".ep-default-submenu-panel, .d1-panel--list:not([hidden])",
    prepare: async (page) => {
      if (!(await openMenu(page, 2))) return false
      return hoverCentre(page, ".ep-default-submenu-panel a.menu-link, .d1-panel--list:not([hidden]) .d1-panel__list a")
    },
  },
]

/** Move the pointer to the centre of the first match and let transitions finish. */
async function hoverCentre(page, selector) {
  const point = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, selector)
  if (!point) return false
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(800) // longest chrome transition is 0.4s
  return true
}

/** Hover the nth top-level nav item on whichever chrome the page is running. */
async function openMenu(page, index) {
  const trigger = await page.$(
    `:is(.bdt-navbar-nav, .d1-nav) > li:nth-child(${index + 1}) :is(a, button)`,
  )
  if (!trigger) return false
  await trigger.hover()
  await page.waitForTimeout(900)
  return true
}

// A region passes if fewer than this fraction of its pixels differ.
//
// 0.5% was the bar for the VENDORED chrome, which was a byte copy of the live
// markup and so could reasonably hit ~0. The hand-written chrome is a
// reimplementation: it reproduces the design, not Elementor's exact box tree, so
// a small residual (sub-pixel text metrics, icon path vs icon-font glyph) is
// expected and acceptable. 3% is the agreed "visually indistinguishable" bar.
// Raise the bar, not this constant, if a region regresses.
const THRESHOLD = 0.03 // 3%

// Kill motion, autoplay and lazy placeholders so two independent loads settle
// to the same frame. Also hide the Astro dev toolbar — a dev-server-only
// overlay (bottom-centre pill) that isn't part of the chrome and never ships to
// production, but overlaps the footer capture and pollutes the diff.
const FREEZE_CSS = `*,*::before,*::after{transition:none!important;animation:none!important;
animation-duration:0s!important;caret-color:transparent!important;}
html{scroll-behavior:auto!important}
astro-dev-toolbar,#dev-toolbar-root{display:none!important}`

async function settle(page) {
  // Trigger lazy images by walking the page, then return to the top.
  await page.evaluate(async () => {
    await new Promise((r) => {
      let y = 0
      const step = () => {
        window.scrollTo(0, y)
        y += window.innerHeight
        if (y < document.body.scrollHeight) setTimeout(step, 40)
        else {
          window.scrollTo(0, 0)
          setTimeout(r, 200)
        }
      }
      step()
    })
  })
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready)
  } catch {}
  await page.waitForTimeout(400)
}

async function shoot(page, url, region, vp) {
  await page.setViewportSize({ width: vp.width, height: vp.height })
  // "load" not "networkidle": the live design1st.com has third-party trackers
  // that never let the network idle, which timed out the wide viewport. settle()
  // below scrolls to force lazy content, covering what networkidle would have.
  await page.goto(url, { waitUntil: "load", timeout: 60000 })
  await page.addStyleTag({ content: FREEZE_CSS })
  await settle(page)
  const el = await page.$(region.selector)
  if (!el) return { missing: true }

  // Interactive regions: put the chrome into the state under test, then capture
  // JUST the opened panel.
  //
  // Capturing a viewport clip instead would drag in the page behind and beside
  // the panel, which is completely different content on the two sites (the live
  // homepage vs an article) and swamped the real signal. The header itself is
  // already covered by its own region, so the panel alone is what's under test.
  if (region.prepare) {
    const ok = await region.prepare(page)
    if (!ok) return { missing: true }
    const panel = await page.$(region.clipTo ?? region.selector)
    if (!panel) return { missing: true }
    const box = await panel.boundingBox()
    if (!box || box.width < 50 || box.height < 50) return { missing: true }
    return { buf: await panel.screenshot(), box }
  }

  // Hide anything pinned to the viewport before capturing. design1st.com renders
  // a second, position:fixed CLONE of the header (Elementor's sticky feature)
  // that appears once scrolled. Screenshotting a region taller than the viewport
  // composites whatever is pinned over it, so that clone lands in the middle of
  // the reference footer PNG — a capture artifact, not a chrome difference. The
  // region being captured (and its ancestors) are exempt so a legitimately
  // sticky target is never hidden.
  await el.evaluate((target) => {
    for (const node of document.querySelectorAll("body *")) {
      if (node === target || node.contains(target) || target.contains(node)) continue
      const pos = getComputedStyle(node).position
      if (pos === "fixed" || pos === "sticky") node.style.setProperty("display", "none", "important")
    }
  })

  // Snap the region to an integer y-origin before capturing. The two pages have
  // different-length bodies, so a region low on the page (the footer) lands at a
  // different FRACTIONAL pixel on each — shifting every glyph's rasterisation by
  // a sub-pixel and painting a uniform AA halo in the diff that no chrome change
  // can remove. Adding <1px of margin-top to align both captures to the same
  // pixel grid isolates the chrome itself, so a 0% result means identical chrome
  // rather than "identical chrome, coincidentally page-aligned". Imperceptible,
  // capture-only. The header sits at y=0 on both already, so this is a no-op there.
  await el.evaluate((node) => {
    const frac = (node.getBoundingClientRect().top + window.scrollY) % 1
    if (frac > 0.001) node.style.marginTop = `${1 - frac}px`
  })
  await page.waitForTimeout(50)

  // Grow the viewport to fit a region taller than it before capturing.
  // Playwright screenshots an over-tall element by scrolling and stitching, and
  // on this page that mis-registers: the mobile footer (1313px in an 844px
  // viewport) came back with its first ~120px missing, so the diff was scoring a
  // corrupted reference against a correct candidate and no CSS change could move
  // it. Only the height changes — every breakpoint here is a width media query,
  // so this does not alter layout.
  // Force every image inside the region to actually finish loading before we
  // measure or capture. The footer's award badges are lazy-loaded, and how many
  // of them had arrived varied run to run — the same reference section measured
  // 217.6px and 251.8px on two passes with no code change. That noise was being
  // attributed to CSS. Waiting for decode makes the reference deterministic.
  await el.evaluate(async (node) => {
    const imgs = [...node.querySelectorAll("img")]
    imgs.forEach((i) => {
      i.loading = "eager"
      if (i.dataset.src && !i.src) i.src = i.dataset.src
    })
    await Promise.all(
      imgs.map((i) =>
        i.complete && i.naturalWidth
          ? Promise.resolve()
          : Promise.race([
              i.decode().catch(() => {}),
              new Promise((r) => setTimeout(r, 3000)),
            ]),
      ),
    )
  })
  await page.waitForTimeout(200)

  let box = await el.boundingBox()
  const vpH = page.viewportSize().height
  if (box.height > vpH) {
    await page.setViewportSize({ width: vp.width, height: Math.ceil(box.height) + 100 })
    await page.waitForTimeout(300)
    box = await el.boundingBox()
  }

  const buf = await el.screenshot()
  if (page.viewportSize().height !== vpH) await page.setViewportSize({ width: vp.width, height: vpH })
  return { buf, box }
}

function toPNG(buf) {
  return PNG.sync.read(buf)
}

function diffPair(refPng, candPng) {
  const width = Math.min(refPng.width, candPng.width)
  const height = Math.min(refPng.height, candPng.height)
  const sizeMismatch = refPng.width !== candPng.width || refPng.height !== candPng.height

  // Crop both to the shared box so pixelmatch gets equal dimensions.
  const crop = (src) => {
    const out = new PNG({ width, height })
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const si = (src.width * y + x) << 2
        const di = (width * y + x) << 2
        out.data[di] = src.data[si]
        out.data[di + 1] = src.data[si + 1]
        out.data[di + 2] = src.data[si + 2]
        out.data[di + 3] = src.data[si + 3]
      }
    }
    return out
  }
  const a = crop(refPng)
  const b = crop(candPng)
  const diff = new PNG({ width, height })
  // Per-pixel threshold 0.15 (not the default 0.1): two independent live
  // renders differ by sub-pixel font antialiasing at glyph edges — invisible to
  // a human but enough to trip a stricter value. 0.15 absorbs that AA halo while
  // still catching any real colour/position/size change.
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.15,
    includeAA: false,
  })
  return {
    diff,
    mismatched,
    total: width * height,
    fraction: mismatched / (width * height),
    sizeMismatch,
    refDim: { w: refPng.width, h: refPng.height },
    candDim: { w: candPng.width, h: candPng.height },
    comparedDim: { w: width, h: height },
  }
}

async function main() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" })
  const page = await ctx.newPage()

  const report = { candidate: CANDIDATE, reference: REFERENCE, threshold: THRESHOLD, results: [] }

  for (const vp of VIEWPORTS) {
    for (const region of REGIONS) {
      // Some regions only make sense at certain widths (the mega menus don't
      // exist below the desktop breakpoint).
      if (region.only && !region.only.includes(vp.width)) continue
      const tag = `${region.name}_${vp.name}`
      const entry = { region: region.name, viewport: vp.name, width: vp.width }
      try {
        const ref = await shoot(page, REFERENCE, region, vp)
        const cand = await shoot(page, CANDIDATE, region, vp)

        if (ref.missing || cand.missing) {
          entry.status = "MISSING"
          entry.note = `${ref.missing ? "reference" : ""}${ref.missing && cand.missing ? "+" : ""}${cand.missing ? "candidate" : ""} has no ${region.name}`
          report.results.push(entry)
          continue
        }

        writeFileSync(join(OUT, `${tag}_reference.png`), ref.buf)
        writeFileSync(join(OUT, `${tag}_candidate.png`), cand.buf)

        const d = diffPair(toPNG(ref.buf), toPNG(cand.buf))
        writeFileSync(join(OUT, `${tag}_diff.png`), PNG.sync.write(d.diff))

        entry.status = d.fraction <= THRESHOLD && !d.sizeMismatch ? "PASS" : "FAIL"
        entry.mismatchedPixels = d.mismatched
        entry.fraction = Number(d.fraction.toFixed(5))
        entry.percent = Number((d.fraction * 100).toFixed(3))
        entry.referenceDim = d.refDim
        entry.candidateDim = d.candDim
        entry.sizeMismatch = d.sizeMismatch
        entry.files = {
          reference: `${tag}_reference.png`,
          candidate: `${tag}_candidate.png`,
          diff: `${tag}_diff.png`,
        }
      } catch (err) {
        entry.status = "ERROR"
        entry.note = String(err && err.message ? err.message : err)
      }
      report.results.push(entry)
    }
  }

  await browser.close()

  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n")

  // Console summary.
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`\ncandidate: ${CANDIDATE}`)
  console.log(`reference: ${REFERENCE}`)
  console.log(`threshold: ${(THRESHOLD * 100).toFixed(2)}%  ·  artifacts: ${OUT}\n`)
  console.log(pad("REGION", 19) + pad("VIEWPORT", 14) + pad("STATUS", 8) + pad("DIFF", 10) + "DIMENSIONS")
  let anyFail = false
  for (const r of report.results) {
    if (r.status !== "PASS") anyFail = true
    const dim = r.referenceDim
      ? `ref ${r.referenceDim.w}x${r.referenceDim.h}  cand ${r.candidateDim.w}x${r.candidateDim.h}`
      : ""
    const diff = r.percent !== undefined ? `${r.percent}%` : ""
    console.log(pad(r.region, 19) + pad(r.viewport, 14) + pad(r.status, 8) + pad(diff, 10) + dim)
    if (r.note) console.log(`         └─ ${r.note}`)
  }
  console.log("")
  process.exit(anyFail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
