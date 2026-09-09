// Dumps computed styles for the design1st.com chrome so the hand-written CSS
// starts from real numbers. Not a snapshot tool — a measuring tape.
//
//   node extract-tokens.mjs [viewportWidth]

import { chromium } from "playwright"
import { writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
const __dirname = dirname(fileURLToPath(import.meta.url))

const WIDTH = Number(process.argv[2] || 1440)
const URL = "https://design1st.com/"

const PROPS = [
  "display", "position", "width", "height", "maxWidth", "minHeight",
  "margin", "padding", "gap", "flexDirection", "alignItems", "justifyContent",
  "gridTemplateColumns",
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
  "textTransform", "color", "backgroundColor", "backgroundImage",
  "borderRadius", "border", "borderTop", "borderBottom", "boxShadow", "opacity",
  "zIndex", "textDecorationLine",
]

// The elements that actually define the look. Keyed by a friendly name so the
// output is readable next to the CSS I'm about to write.
const TARGETS = {
  header:            'header[data-elementor-type="header"]',
  headerInner:       'header[data-elementor-type="header"] .e-con-inner',
  logoImg:           'header[data-elementor-type="header"] .elementor-widget-theme-site-logo img',
  megaNav:           'header[data-elementor-type="header"] .bdt-navbar-nav',
  megaNavItem:       'header[data-elementor-type="header"] .bdt-navbar-nav > li',
  megaNavLink:       'header[data-elementor-type="header"] .bdt-navbar-nav > li > a',
  dropdownPanel:     'header[data-elementor-type="header"] .bdt-dropdown',
  dropdownHeading:   'header[data-elementor-type="header"] .bdt-dropdown h2, header[data-elementor-type="header"] .bdt-dropdown .elementor-heading-title',
  dropdownListItem:  'header[data-elementor-type="header"] .bdt-dropdown .elementor-icon-list-item',
  dropdownListLink:  'header[data-elementor-type="header"] .bdt-dropdown .elementor-icon-list-item a',
  ctaButton:         'header[data-elementor-type="header"] .elementor-button',
  phoneLink:         'header[data-elementor-type="header"] a[href^="tel:"]',
  searchForm:        'header[data-elementor-type="header"] .elementor-search-form',

  footer:            'footer[data-elementor-type="footer"]',
  footerInner:       'footer[data-elementor-type="footer"] .e-con-inner',
  footerHeading:     'footer[data-elementor-type="footer"] h2',
  footerLink:        'footer[data-elementor-type="footer"] .elementor-icon-list-item a',
  footerText:        'footer[data-elementor-type="footer"] p',
  footerLogo:        'footer[data-elementor-type="footer"] img[src*="design1st-logo"]',
  socialIcon:        'footer[data-elementor-type="footer"] .elementor-social-icon',
  badgeImg:          'footer[data-elementor-type="footer"] .elementor-widget-image img',
  formLabel:         'footer[data-elementor-type="footer"] .gfield_label',
  formInputText:     'footer[data-elementor-type="footer"] input[type="text"]',
  formInputEmail:    'footer[data-elementor-type="footer"] input[type="email"]',
  formSelect:        'footer[data-elementor-type="footer"] select',
  formTextarea:      'footer[data-elementor-type="footer"] textarea',
  formSubmit:        'footer[data-elementor-type="footer"] input[type="submit"]',
  formNextButton:    'footer[data-elementor-type="footer"] input[id^="gform_next_button"]',
  progressBar:       'footer[data-elementor-type="footer"] .gf_progressbar',
  progressFill:      'footer[data-elementor-type="footer"] .gf_progressbar_percentage',
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 } })
await page.goto(URL, { waitUntil: "load", timeout: 60000 })
await page.waitForTimeout(2500)

const result = await page.evaluate(
  ({ TARGETS, PROPS }) => {
    const out = {}
    for (const [name, sel] of Object.entries(TARGETS)) {
      const el = document.querySelector(sel)
      if (!el) { out[name] = { __missing: sel }; continue }
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const o = { __rect: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1) } }
      for (const p of PROPS) {
        const v = cs[p]
        // Drop the noise: browser defaults that tell me nothing.
        if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px" &&
            v !== "rgba(0, 0, 0, 0)" && v !== "static" && v !== "1") o[p] = v
      }
      out[name] = o
    }
    // Fonts actually in use across the chrome, with weights.
    const faces = new Set()
    for (const root of ['header[data-elementor-type="header"]', 'footer[data-elementor-type="footer"]']) {
      const scope = document.querySelector(root)
      if (!scope) continue
      for (const el of [scope, ...scope.querySelectorAll("*")]) {
        const cs = getComputedStyle(el)
        if (el.textContent?.trim()) faces.add(`${cs.fontFamily} | ${cs.fontWeight} | ${cs.fontSize}`)
      }
    }
    out.__fonts = [...faces].sort()
    return out
  },
  { TARGETS, PROPS },
)

mkdirSync(join(__dirname,"..","artifacts"),{recursive:true});writeFileSync(join(__dirname,"..","artifacts",`tokens-${WIDTH}.json`), JSON.stringify(result, null, 2))
console.log(`wrote tokens-${WIDTH}.json`)
for (const [k, v] of Object.entries(result)) {
  if (k === "__fonts") continue
  if (v.__missing) { console.log(`MISSING ${k}  ${v.__missing}`); continue }
  console.log(`\n[${k}] ${JSON.stringify(v.__rect)}`)
  for (const [p, val] of Object.entries(v)) if (p !== "__rect") console.log(`   ${p}: ${val}`)
}
console.log("\n=== fonts in chrome ===")
result.__fonts.slice(0, 25).forEach((f) => console.log("  " + f))

await browser.close()
