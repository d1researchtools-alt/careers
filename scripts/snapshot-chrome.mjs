// Vendors the live design1st.com chrome into src/chrome/chrome.json so the app
// renders a fully self-contained header/footer with no runtime fetch.
//
//   node scripts/snapshot-chrome.mjs
//
// Re-run this whenever the WordPress header/footer or its enqueued assets
// change — the snapshot is a point-in-time copy, not a live mirror. Commit the
// regenerated src/chrome/chrome.json.

import { writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { parseChrome, WP } from "../src/lib/chrome-parse.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, "..", "src", "chrome")
const OUT_FILE = join(OUT_DIR, "chrome.json")

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

const res = await fetch(WP, { headers: { "User-Agent": UA } })
if (!res.ok) {
  console.error(`Failed to fetch ${WP}: ${res.status}`)
  process.exit(1)
}
const html = await res.text()
const chrome = parseChrome(html)

if (!chrome.header) {
  console.error("Refusing to write snapshot: no header found on the homepage.")
  process.exit(1)
}
if (!chrome.footer) {
  console.error("Refusing to write snapshot: no footer found on the homepage.")
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(chrome, null, 2) + "\n")

console.log(`Wrote ${OUT_FILE}`)
console.log(
  `  header ${chrome.header.length}b · footer ${chrome.footer.length}b · ` +
    `${chrome.styleHrefs.length} stylesheets · ${chrome.inlineStyles.length} inline styles · ` +
    `${chrome.scripts.length} scripts`,
)
