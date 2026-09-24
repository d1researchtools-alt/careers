// Headless check of the careers page and its application form.
//
//   node scripts/smoke/apply.mjs                       # against astro dev
//   URL=https://design1st.com/careers/ node scripts/smoke/apply.mjs
//   SUBMIT=1 URL=... node scripts/smoke/apply.mjs      # ALSO submits an entry
//
// Without SUBMIT=1 this never creates a Gravity Forms entry. It loads the page,
// checks the chrome and the form rendered, attaches a small test PDF and waits
// for it to reach "Attached" — which exercises the token fetch (GET
// /api/apply), the upload endpoint and the nonce, but only writes a temp file
// that WordPress purges on its own. With SUBMIT=1 it fills the form with
// clearly-labelled TEST values and submits, so whoever reads the hiring
// inbox sees one entry titled "SMOKE TEST" — tell them first.

import { chromium } from "playwright"
import { writeFileSync } from "node:fs"

const URL = process.env.URL ?? "http://localhost:4321/careers/"
const SUBMIT = process.env.SUBMIT === "1"

const out = { url: URL, pageErrors: [], console: [] }
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
p.on("pageerror", (e) => out.pageErrors.push(e.message))
p.on("console", (m) => m.type() === "error" && out.console.push(m.text()))

await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 })

out.title = await p.title()
out.h1 = await p.locator("h1").first().textContent()
out.header = (await p.locator("header").count()) > 0
out.footer = (await p.locator("footer").count()) > 0
out.form = (await p.locator("[data-apply-form]").count()) > 0
out.galleryImages = await p.locator(".cr-gallery img").count()
out.brokenImages = await p.evaluate(() =>
  [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
)

// The upload config the browser would use. On design1st.com the page posts
// files straight to uploadUrl; elsewhere it goes through /api/upload.
const cfg = await p.evaluate(async () => {
  const base = document.querySelector("[data-apply-form]") ? location.pathname.replace(/\/$/, "") : ""
  const r = await fetch(`${base}/api/apply`, { cache: "no-store" })
  return { status: r.status, body: await r.json() }
})
out.config = { status: cfg.status, ok: cfg.body.ok, uploadUrl: cfg.body.uploadUrl, hasNonce: !!cfg.body.nonce, message: cfg.body.message }

// Attach a one-page PDF and wait for the row to settle.
const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
writeFileSync("smoke-test.pdf", pdf)
await p.locator("[data-file-input]").setInputFiles("smoke-test.pdf")
await p.waitForFunction(() => {
  const li = document.querySelector(".cr-file")
  return li && li.dataset.state !== "uploading"
}, null, { timeout: 30000 }).catch(() => {})
out.upload = await p.evaluate(() => {
  const li = document.querySelector(".cr-file")
  return li ? { state: li.dataset.state, status: li.querySelector("[data-file-status]")?.textContent } : null
})

if (SUBMIT) {
  await p.fill("#cr-first", "SMOKE")
  await p.fill("#cr-last", "TEST")
  await p.fill("#cr-email", "smoke-test@design1st.com")
  await p.fill("#cr-phone", "000-000-0000")
  await p.selectOption("#cr-discipline", "Other")
  await p.fill("#cr-discipline-other", "SMOKE TEST")
  await p.fill("#cr-work", "https://design1st.com/")
  await p.fill("#cr-why", "SMOKE TEST — automated check of the careers form after the move to Vercel. Please ignore.")
  await p.click(".cr-form button[type=submit]")
  await p.waitForFunction(
    () => !document.querySelector("[data-done]").hidden || document.querySelector("[data-status]").textContent,
    null,
    { timeout: 45000 },
  ).catch(() => {})
  out.submit = await p.evaluate(() => ({
    done: !document.querySelector("[data-done]").hidden,
    doneText: document.querySelector("[data-done-text]")?.textContent,
    status: document.querySelector("[data-status]")?.textContent,
  }))
}

await p.screenshot({ path: "shot-apply.png", fullPage: true })
console.log(JSON.stringify(out, null, 2))
await b.close()
