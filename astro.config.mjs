// @ts-check
import { defineConfig } from "astro/config"
import vercel from "@astrojs/vercel"

// This app is served at design1st.com/careers via a Cloudflare Worker that
// proxies /careers* to this Vercel deployment — the same model as the
// /insights app, which is where this repo was copied from. Everything below
// supports that:
//
//  - base: "/careers"   → Astro emits its own asset URLs under /careers, so the
//    Worker's single /careers* route covers the page AND its assets.
//  - output: "server"   → the page renders on request. Nothing on it is
//    per-request today, but /api/* has to be server-rendered anyway, and a
//    server build keeps the ISR/preview behaviour identical to /insights.
//  - isr.expiration     → Vercel caches the rendered page for 5 min.
//
// ASTRO_BASE exists so a staging deployment can be viewed DIRECTLY on its
// *.vercel.app URL. The Vercel adapter strips `base` from the paths it emits
// (assets land at /_astro/*), while the HTML still asks for /careers/_astro/*
// — so on a bare vercel.app origin the CSS request 404s into the SSR handler,
// returns HTML, and the page renders unstyled. Building with ASTRO_BASE=/ puts
// HTML and assets at the same place.
//
// Set ASTRO_BASE=/ on the staging project ONLY. Production must keep /careers,
// or the asset URLs stop lining up with the Worker's /careers* route.
export default defineConfig({
  base: process.env.ASTRO_BASE ?? "/careers",
  output: "server",
  adapter: vercel({
    // Gravity Forms sends its notification emails INSIDE the submit request,
    // so a successful application can take several seconds to come back from
    // WordPress. 10 s (the Hobby default) is cutting it fine; 30 s is not.
    maxDuration: 30,
    isr: {
      expiration: 60 * 5,
      // The form endpoints must never sit in a cache pool. A POST is never
      // served from the cache, but GET /api/apply hands out a WordPress nonce
      // with a 12-hour life and a browser must always get the current one.
      exclude: ["/api/apply", "/api/upload", "/api/contact"],
    },
  }),
})
