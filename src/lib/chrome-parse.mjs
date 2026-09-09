// Pure parser: given the raw HTML of the design1st.com homepage, extract the
// header/footer chrome plus everything needed to render it faithfully from a
// different origin (stylesheets, inline CSS, the ordered script chain).
//
// This lives in plain JS (not chrome.ts) so BOTH the Astro build and the
// standalone `scripts/snapshot-chrome.mjs` can call it without a TS runner and
// without duplicating the extraction rules. chrome.ts re-exports the types and
// serves the vendored snapshot; this file is the single source of parse logic.

import { parse } from "node-html-parser"

const WP = "https://design1st.com"

// Attributes that can hold a URL we need to absolutize once the markup is
// lifted out of design1st.com and served from a different origin.
const URL_ATTRS = ["href", "src", "data-src", "poster"]

// Only these <script> types actually run; the rest (ld+json, speculationrules,
// application/json) are inert data we can safely drop.
function isExecutable(type) {
  if (!type) return true
  const t = type.toLowerCase()
  return t === "text/javascript" || t === "module" || t === "application/javascript"
}

// Cloudflare bot-management / rocket-loader bootstraps only make sense on the
// real origin — always drop them.
function isCloudflareJunk(code) {
  return /__CF\$cv\$params|cdn-cgi\/(challenge-platform|rocket-loader)/.test(code)
}

function absolutize(value) {
  try {
    // Leave data:, mailto:, tel:, #anchors and already-absolute URLs alone;
    // new URL() resolves root-relative (/wp-content/…) and protocol-relative
    // (//host/…) forms against the WordPress origin.
    if (/^(data:|mailto:|tel:|#|javascript:)/i.test(value)) return value
    return new URL(value, WP).toString()
  } catch {
    return value
  }
}

// Rewrite every URL-bearing attribute (and srcset, and url() inside inline
// style attributes) within a subtree so assets resolve against design1st.com.
function rewriteUrls(el) {
  const all = [el, ...el.querySelectorAll("*")]
  for (const node of all) {
    for (const attr of URL_ATTRS) {
      const v = node.getAttribute(attr)
      if (v) node.setAttribute(attr, absolutize(v))
    }
    const srcset = node.getAttribute("srcset")
    if (srcset) {
      node.setAttribute(
        "srcset",
        srcset
          .split(",")
          .map((part) => {
            const [url, ...rest] = part.trim().split(/\s+/)
            return [absolutize(url), ...rest].join(" ")
          })
          .join(", "),
      )
    }
    const style = node.getAttribute("style")
    if (style && style.includes("url(")) {
      node.setAttribute(
        "style",
        style.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, q, url) => `url(${q}${absolutize(url)}${q})`),
      )
    }
  }
}

/**
 * @param {string} html Raw HTML of the design1st.com homepage.
 * @returns {{header: string, footer: string, styleHrefs: string[], inlineStyles: string[], scripts: object[]}}
 */
export function parseChrome(html) {
  const root = parse(html)

  // Elementor theme-builder templates. These are the real chrome; the page
  // also contains nested sticky/mobile <header>s inside this one.
  const headerEl = root.querySelector('header[data-elementor-type="header"]')
  const footerEl = root.querySelector('footer[data-elementor-type="footer"]')
  if (headerEl) rewriteUrls(headerEl)
  if (footerEl) rewriteUrls(footerEl)

  const head = root.querySelector("head")

  // External stylesheets, absolutized and de-duped in source order.
  const seen = new Set()
  const styleHrefs = []
  for (const link of root.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute("href")
    if (!href) continue
    const abs = absolutize(href)
    if (seen.has(abs)) continue
    seen.add(abs)
    styleHrefs.push(abs)
  }

  // Inline <style> blocks from <head> — Elementor emits a lot of its layout
  // CSS here, so dropping them would break the header/footer geometry. Rewrite
  // any url()s they contain too.
  const inlineStyles = []
  for (const style of head?.querySelectorAll("style") ?? []) {
    const css = style.innerHTML
    if (css.trim()) {
      inlineStyles.push(css.replace(/url\(\s*(['"]?)(\/[^'")]+)\1\s*\)/g, (_m, q, url) => `url(${q}${absolutize(url)}${q})`))
    }
  }

  // Scripts embedded *inside* the header/footer markup (in document order).
  // These include the CTA popup wiring — the jQuery click handlers that open the
  // "Email a Question" (Gravity Form) and "Talk To Us" (Calendly) popups, plus
  // that form's init and Cloudflare's email-decode. We handle them separately
  // from the enqueued scripts below.
  const nestedList = [
    ...(headerEl?.querySelectorAll("script") ?? []),
    ...(footerEl?.querySelectorAll("script") ?? []),
  ]
  const nested = new Set(nestedList)

  // Every enqueued <script>, in document order, so WordPress's dependency chain
  // (jQuery → Elementor frontend → Element Pack / bdt-uikit → smartmenus) and
  // its interleaved inline config scripts (…-js-before / …-js-extra) are
  // reproduced exactly.
  const scripts = []
  for (const el of root.querySelectorAll("script")) {
    if (nested.has(el)) continue
    const src0 = el.getAttribute("src")
    // wp-emoji-loader is emoji-detection cruft that throws a (harmless) null
    // read on the real site too; nothing here needs it.
    if (src0 && /wp-emoji-loader/.test(src0)) continue
    const type = el.getAttribute("type")
    if (!isExecutable(type ?? undefined)) continue
    const src = el.getAttribute("src")
    const code = src ? undefined : el.innerHTML
    if (!src && (!code || !code.trim() || isCloudflareJunk(code))) continue
    scripts.push({
      src: src ? absolutize(src) : undefined,
      code,
      type: type ?? undefined,
      defer: el.hasAttribute("defer"),
      async: el.hasAttribute("async"),
      id: el.getAttribute("id") ?? undefined,
    })
  }

  // Now the header/footer-embedded scripts. Left in the markup they run at parse
  // time — *before* jQuery loads at end-of-body — which unbinds the popups and
  // throws "jQuery/gform is not defined". So: strip them from the markup, then
  // re-append them here, AFTER every library above. Running last means jQuery,
  // the Gravity Forms lib, and Calendly all exist, so the CTA popup handlers
  // bind and open correctly (and the form init no longer errors).
  for (const el of nestedList) {
    const type = el.getAttribute("type")
    const src = el.getAttribute("src")
    const code = src ? undefined : el.innerHTML
    el.remove() // take it out of the injected header/footer markup
    if (!isExecutable(type ?? undefined)) continue
    if (!src && (!code || !code.trim() || isCloudflareJunk(code))) continue
    scripts.push({
      src: src ? absolutize(src) : undefined,
      code,
      type: type ?? undefined,
      defer: false,
      async: el.hasAttribute("async"),
      id: el.getAttribute("id") ?? undefined,
    })
  }

  return {
    header: headerEl?.toString() ?? "",
    footer: footerEl?.toString() ?? "",
    styleHrefs,
    inlineStyles,
    scripts,
  }
}

export { WP }
