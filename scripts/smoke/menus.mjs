import { chromium } from "playwright"

const URL = process.env.URL ?? "http://localhost:4321/"
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on("pageerror", (e) => errors.push(e.message))

await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 })
await page.waitForTimeout(1500)

// --- DESKTOP: hover each parent, count how many reveal a dropdown/mega panel ---
const parents = page.locator("header .menu-item-has-children, header .bdt-megamenu-indicator")
const parentCount = await parents.count()
let opened = 0
let firstOpenIndex = -1
for (let i = 0; i < parentCount; i++) {
  const item = parents.nth(i)
  const panel = item.locator(".sub-menu, .bdt-drop, .bdt-dropdown").first()
  if ((await panel.count()) === 0) continue
  await item.hover({ timeout: 1500 }).catch(() => {})
  await page.waitForTimeout(350)
  if (await panel.isVisible().catch(() => false)) {
    opened++
    if (firstOpenIndex < 0) firstOpenIndex = i
  }
}
// Screenshot with the first working mega-menu held open.
if (firstOpenIndex >= 0) {
  await parents.nth(firstOpenIndex).hover().catch(() => {})
  await page.waitForTimeout(500)
}
await page.screenshot({ path: "shot-desktop-menu-open.png" })

// --- MOBILE: find the *visible* hamburger, click, screenshot the opened menu ---
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(700)
const toggles = page.locator(
  "header .bdt-navbar-toggle, header .elementor-menu-toggle, header [class*='hamburger'] a, header .menu-toggle",
)
let mobileToggleVisible = false
let mobileOpened = false
const tc = await toggles.count()
for (let i = 0; i < tc; i++) {
  const t = toggles.nth(i)
  if (!(await t.isVisible().catch(() => false))) continue
  mobileToggleVisible = true
  await t.click({ timeout: 2500 }).catch(() => {})
  await page.waitForTimeout(900)
  const panel = page.locator(".bdt-offcanvas.bdt-open, .bdt-offcanvas-bar, header .bdt-navbar-nav a, .elementskit-navbar-nav").first()
  mobileOpened = await panel.isVisible().catch(() => false)
  break
}
await page.screenshot({ path: "shot-mobile-menu.png" })

console.log(JSON.stringify({
  desktopParents: parentCount,
  desktopMenusOpened: opened,
  mobileToggleVisible,
  mobileOpened,
  pageErrors: [...new Set(errors)],
}, null, 2))
await browser.close()
