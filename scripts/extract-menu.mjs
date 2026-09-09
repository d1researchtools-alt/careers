// Pulls the full mega-menu structure out of the vendored Elementor snapshot and
// writes it as plain JSON for src/components/chrome/nav-data.ts.
//
//   node scripts/extract-menu.mjs
//
// The menus are 4-column panels: three columns of icon-headed link groups, plus
// a promo column (blurb + CTA + outlined buttons). Elementor buries that in ~200
// KB of wrapper markup per panel, so this walks the panel in document order and
// keeps only the semantics.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { parse } from "node-html-parser"

const __dirname = dirname(fileURLToPath(import.meta.url))
const WP = "https://design1st.com"

const snapshot = JSON.parse(readFileSync(join(__dirname, "..", "src", "chrome", "chrome.json"), "utf8"))
const root = parse(snapshot.header)

const clean = (s) =>
  (s || "")
    .replace(/\.cls-[^}]*}/g, "") // inline <style> text leaking out of inline SVGs
    .replace(/​/g, "")
    .replace(/\s+/g, " ")
    .trim()

const rel = (href) => (href || "").replace(WP, "") || "#"

/**
 * Like clean(), but keeps explicit <br> as newlines. The promo buttons rely on
 * hard breaks ("Companies<br>With Design Teams") — collapsing them changes how
 * every button wraps and throws the whole column's vertical rhythm out.
 */
const cleanKeepingBreaks = (html) =>
  (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => clean(line))
    .filter(Boolean)
    .join("\n")

const slug = (s) =>
  clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

// Group icons are inline SVG, 12-18 KB each. Inlining ~13 of them would add
// ~195 KB to every page for menus that start hidden, so they're written out as
// files and lazy-loaded on first hover instead.
const ICON_DIR = join(__dirname, "..", "public", "chrome", "menu-icons")
mkdirSync(ICON_DIR, { recursive: true })

function saveIcon(widget, name) {
  const svg = widget.querySelector("svg")
  if (!svg) return null
  const markup = svg.toString()
  const file = `${name}.svg`
  writeFileSync(join(ICON_DIR, file), markup)
  return file
}

/**
 * Panels are a flat widget sequence in document order:
 *
 *   heading "designing"            -> opens a link column
 *     button "Product Strategy"    -> a group title (links to its own page)
 *     icon-list                    -> that group's sub-links
 *     button / icon-list …         -> more groups
 *   heading "engineering"          -> next column
 *   heading "How we help"          -> switches to the promo column
 *     text-editor                  -> blurb
 *     button                       -> primary CTA, then outlined buttons
 */
function readPanel(panel) {
  const columns = []
  const promo = { text: "", cta: null, buttons: [] }
  let current = null
  let inPromo = false

  for (const w of panel.querySelectorAll("[data-widget_type]")) {
    const type = (w.getAttribute("data-widget_type") || "").split(".")[0]
    const anchor = w.querySelector("a")
    const label = clean(w.querySelector(".elementor-button-text")?.text ?? w.text)

    if (type === "heading") {
      if (!label) continue
      if (/how we help/i.test(label)) {
        inPromo = true
        current = null
      } else {
        inPromo = false
        current = { heading: label, groups: [], links: [], cards: [] }
        columns.push(current)
      }
      continue
    }

    if (type === "text-editor") {
      if (inPromo && label && !promo.text) promo.text = label
      continue
    }

    if (type === "button") {
      if (!label) continue
      const btnHtml = w.querySelector(".elementor-button-text")?.innerHTML
      const entry = {
        label: btnHtml ? cleanKeepingBreaks(btnHtml) : label,
        href: rel(anchor?.getAttribute("href")),
      }
      if (inPromo) {
        if (!promo.cta) promo.cta = entry
        else promo.buttons.push(entry)
      } else if (current) {
        current.groups.push({ ...entry, icon: saveIcon(w, slug(label)), links: [] })
      }
      continue
    }

    if (type === "icon-list") {
      const links = w
        .querySelectorAll(".elementor-icon-list-item")
        .map((it) => {
          const label = clean(it.text)
          return {
            label,
            href: rel(it.querySelector("a")?.getAttribute("href")),
            // Portfolio-style columns give every ITEM an icon; Services-style
            // ones put the icon on the group title instead.
            icon: label ? saveIcon(it, slug(label)) : null,
          }
        })
        .filter((l) => l.label)
      if (!links.length || !current) continue

      const group = current.groups[current.groups.length - 1]
      if (group) group.links.push(...links)
      else current.links.push(...links) // no preceding group title => flat column
      continue
    }

    // Featured case-study cards (Portfolio's last column).
    if (type === "image-box") {
      if (!current) continue
      const img = w.querySelector("img")
      current.cards.push({
        title: clean(w.querySelector(".elementor-image-box-title")?.text),
        description: clean(w.querySelector(".elementor-image-box-description")?.text),
        href: rel(w.querySelector("a")?.getAttribute("href")),
        // Card art stays on design1st.com — same asset the live menu loads, and
        // every nav destination already points there.
        image: img ? new URL(img.getAttribute("src"), WP).toString() : null,
      })
    }
  }

  return { columns, promo }
}

const menus = []
const seen = new Set()
for (const li of root.querySelectorAll("li")) {
  const panel = li.querySelector(".ep-megamenu-panel")
  if (!panel) continue
  const label = clean(li.querySelector("a.ep-menu-nav-link, a")?.text)?.slice(0, 24)
  if (!label || seen.has(label)) continue
  seen.add(label)
  const { columns, promo } = readPanel(panel)

  if (columns.length || promo.cta) {
    menus.push({ label, kind: "mega", columns, promo })
    continue
  }

  // About / Free Tools are plain link lists with no Elementor widgets at all.
  const links = panel
    .querySelectorAll("a")
    .map((a) => ({ label: clean(a.text), href: rel(a.getAttribute("href")) }))
    .filter((l) => l.label)
  if (links.length) menus.push({ label, kind: "list", links })
}

const out = join(__dirname, "..", "src", "components", "chrome", "menu-data.json")
writeFileSync(out, JSON.stringify(menus, null, 2) + "\n")

console.log(`wrote ${out}`)
for (const m of menus) {
  if (m.kind === "list") {
    console.log(`  ${m.label.padEnd(16)} list · ${m.links.length} links`)
    continue
  }
  const groups = m.columns.reduce((a, c) => a + c.groups.length, 0)
  const icons = m.columns.reduce((a, c) => a + c.groups.filter((g) => g.icon).length, 0)
  const links = m.columns.reduce((a, c) => a + c.groups.reduce((b, g) => b + g.links.length, 0), 0)
  console.log(
    `  ${m.label.padEnd(16)} mega · ${m.columns.length} cols · ${groups} groups ` +
      `(${icons} icons) · ${links} links · ${m.promo.buttons.length} promo buttons` +
      `${m.promo.cta ? " + cta" : ""}`,
  )
}
