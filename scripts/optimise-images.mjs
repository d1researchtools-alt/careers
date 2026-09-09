// Turns the careers page's photos into web-sized WebP.
//
//   node scripts/optimise-images.mjs        (npm run images:careers)
//
// WordPress serves six of the seven photos on /careers/ as a base64-encoded
// PNG wrapped in an SVG — the same "worst of both worlds" the footer badges
// had (see optimise-badges.mjs): base64 inflates the bytes ~33%, the content
// is raster anyway, and the embedded PNGs are far larger than their rendered
// size. The hero alone is a 3 MB SVG wrapping a 1920x700 PNG that paints a
// 583px frame. All seven together are ~7.9 MB; the output here is ~400 KB.
//
// Each source becomes two WebPs: a 2x for retina/desktop and a 1x for phones,
// chosen by srcset in src/pages/index.astro. Re-run after swapping a photo in
// WordPress; commit the output. Sources are fetched into artifacts/careers-src
// (gitignored) so the script runs from a clean checkout.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, "..", "artifacts", "careers-src")
const OUT = join(__dirname, "..", "public", "static", "images", "careers")
const UPLOADS = "https://design1st.com/wp-content/uploads"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

// Output name → source path under wp-content/uploads, the widths to emit, and
// an optional aspect ratio to crop to. Widths are 2x and 1x of the rendered
// size at 1440 (hero 583px, gallery 523px); a rung wider than the source is
// capped at the source width rather than upscaled.
//
// The hero source is a 1920x700 panorama that the live page shows through a
// 583x396 frame with object-fit: cover — two thirds of the bytes are never
// seen. Cropping to 3:2 here ships only what is painted; the browser still
// covers the frame, it just has less to discard.
const IMAGES = {
  "hero-team": { src: "2023/01/image-416.svg", widths: [1050, 600], aspect: 3 / 2 },
  "gallery-01": { src: "2023/01/image-417.svg", widths: [1046, 523] },
  "gallery-02": { src: "2023/01/image-418.svg", widths: [1046, 523] },
  "gallery-03": { src: "2023/01/image-419.svg", widths: [1046, 523] },
  "gallery-04": { src: "2023/01/image-420.svg", widths: [1046, 523] },
  "gallery-05": { src: "2023/01/image-421.svg", widths: [1046, 523] },
  "gallery-06": { src: "2023/02/design1st-team-with-waterot.jpg", widths: [1046, 523] },
}

mkdirSync(SRC, { recursive: true })
mkdirSync(OUT, { recursive: true })

let before = 0
let after = 0

for (const [name, { src, widths, aspect }] of Object.entries(IMAGES)) {
  const file = join(SRC, src.split("/").pop())
  if (!existsSync(file)) {
    const res = await fetch(`${UPLOADS}/${src}`, { headers: { "User-Agent": UA } })
    if (!res.ok) {
      console.warn(`could not fetch ${src}: ${res.status}`)
      continue
    }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    console.log(`fetched ${src}`)
  }
  before += statSync(file).size

  // An SVG wrapper holds exactly one embedded raster; a plain JPEG is used as is.
  let raw = readFileSync(file)
  if (file.endsWith(".svg")) {
    const match = raw.toString("utf8").match(/data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)/)
    if (!match) {
      console.warn(`skip ${src}: no embedded raster`)
      continue
    }
    raw = Buffer.from(match[2], "base64")
  }

  const { width: sourceWidth } = await sharp(raw).metadata()
  for (const w of widths) {
    const width = Math.min(w, sourceWidth)
    const out = join(OUT, `${name}-${w}.webp`)
    const size = aspect ? { width, height: Math.round(width / aspect), fit: "cover", position: "centre" } : { width }
    await sharp(raw).resize(size).webp({ quality: 82 }).toFile(out)
    const bytes = statSync(out).size
    after += bytes
    console.log(`${src.padEnd(48)} -> ${`${name}-${w}.webp`.padEnd(22)} ${String(bytes).padStart(7)} b`)
  }
}

console.log(
  `\ntotal ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB ` +
    `(${(100 - (after / before) * 100).toFixed(1)}% smaller)`,
)
