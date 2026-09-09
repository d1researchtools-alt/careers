import { chromium } from "playwright"

const URL = process.env.URL ?? "http://localhost:4321/careers/"
const b = await chromium.launch()
const errors = []
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
p.on("pageerror", (e) => errors.push(e.message))
await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 })
await p.waitForTimeout(1500)

async function tryButton(label, rx) {
  const btn = p.locator("header a", { hasText: rx }).first()
  const found = (await btn.count()) > 0
  if (!found) return { label, found, opened: false }
  // Snapshot how many popup-ish overlays are visible before/after the click.
  const overlay = p.locator(".calendly-popup, .calendly-popup-wrap-july, .calendly-overlay, .calendly-popup-container, [class*='popup']:visible")
  await btn.click({ timeout: 3000 }).catch(() => {})
  await p.waitForTimeout(1200)
  // Is any element with a popup class now visible on screen?
  const opened = await p.evaluate(() => {
    const els = [...document.querySelectorAll("[class*='popup'], [class*='calendly'], .gform_wrapper")]
    return els.some((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 100 && r.height > 100 && s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"
    })
  })
  await p.screenshot({ path: `shot-cta-${label}.png` })
  // Close if we can, to reset for the next button.
  await p.keyboard.press("Escape").catch(() => {})
  await p.locator(".calendly-popup-close, [class*='close']").first().click({ timeout: 1000 }).catch(() => {})
  await p.waitForTimeout(500)
  return { label, found, opened }
}

const email = await tryButton("email", /email a question/i)
const talk = await tryButton("talk", /talk to us/i)

console.log(JSON.stringify({ email, talk, pageErrors: [...new Set(errors)] }, null, 2))
await b.close()
