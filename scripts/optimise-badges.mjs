// Turns the footer's award badges into web-sized WebP.
//
//   node scripts/optimise-badges.mjs
//
// design1st.com serves each badge as a base64-encoded PNG wrapped in an SVG —
// the worst of both worlds: base64 inflates the payload ~33% and the content is
// raster anyway. The embedded PNGs are also enormous relative to how they're
// displayed (one is 1135x966 rendered at 40x40), totalling ~1.1 MB for a strip
// of logos that occupies 76px of footer.
//
// This extracts each embedded PNG, resizes it to 2x its rendered size (retina)
// and writes WebP. Re-run after refreshing the badge SVGs; commit the output.
// The .svg originals are kept as the source of truth for re-runs.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Sources live OUTSIDE public/ on purpose: anything under public/ is copied
// verbatim into the build output, so keeping the 1.1 MB of .svg originals there
// would ship them to production even though nothing references them.
const SRC = join(__dirname, "..", "artifacts", "badge-src")
const DIR = join(__dirname, "..", "public", "chrome", "badges")

// Rendered CSS sizes, measured off the live footer at 1440. Keep in sync with
// `badges` in src/components/chrome/nav-data.ts.
const RENDERED = {
  "image-317.svg": [83, 19],
  "image-319.svg": [76, 40],
  "image-320.svg": [48, 40],
  "image-321.svg": [62, 40],
  "image-322-1.svg": [85, 40],
  "image-318-1.svg": [88, 20],
  "image-323-1.svg": [52, 40],
  "top-product-design-companies-1-1-1-1.svg": [34, 52],
  "image-324.svg": [40, 40],
}

const SCALE = 2 // retina
const SOURCE = "https://design1st.com/wp-content/uploads/2022/12"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

// The .svg originals are ~1.1 MB and gitignored, so fetch any that are missing.
// That keeps this script runnable from a clean checkout.
mkdirSync(SRC, { recursive: true })
mkdirSync(DIR, { recursive: true })
for (const file of Object.keys(RENDERED)) {
  if (existsSync(join(SRC, file))) continue
  const res = await fetch(`${SOURCE}/${file}`, { headers: { "User-Agent": UA } })
  if (!res.ok) {
    console.warn(`could not fetch ${file}: ${res.status}`)
    continue
  }
  writeFileSync(join(SRC, file), Buffer.from(await res.arrayBuffer()))
  console.log(`fetched ${file}`)
}

let before = 0
let after = 0

for (const file of readdirSync(SRC).filter((f) => f.endsWith(".svg"))) {
  const size = RENDERED[file]
  if (!size) {
    console.warn(`skip ${file}: no rendered size recorded`)
    continue
  }
  const svg = readFileSync(join(SRC, file), "utf8")
  const match = svg.match(/data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)/)
  if (!match) {
    console.warn(`skip ${file}: no embedded raster`)
    continue
  }

  before += statSync(join(SRC, file)).size
  const raw = Buffer.from(match[2], "base64")
  const out = file.replace(/\.svg$/, ".webp")

  await sharp(raw)
    .resize(size[0] * SCALE, size[1] * SCALE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88 })
    .toFile(join(DIR, out))

  const bytes = statSync(join(DIR, out)).size
  after += bytes
  console.log(`${file.padEnd(42)} -> ${out.padEnd(43)} ${String(bytes).padStart(6)} b`)
}

console.log(
  `\ntotal ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB ` +
    `(${(100 - (after / before) * 100).toFixed(1)}% smaller)`,
)
