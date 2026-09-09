/**
 * Base-prefixing, in one place.
 *
 * `base` is env-driven (see astro.config.mjs): "/careers" in production, "/"
 * on the staging vercel.app build. Every internal href and asset path has to be
 * built through here rather than hardcoded, or staging silently 404s.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

/** "/static/x.webp" → "/careers/static/x.webp" */
export function withBase(path: string): string {
  return `${BASE}${path}`
}

/**
 * Where the page actually lives, for absolute URLs (canonical, og:url).
 * Deliberately NOT derived from `base`: a staging build must still declare the
 * production canonical, not its own vercel.app address.
 *
 * Trailing slash on purpose — it is what WordPress has always declared as the
 * canonical for this page, and what every inbound link and the sitemap use.
 */
export const SITE_ORIGIN = "https://design1st.com"
export const CANONICAL = `${SITE_ORIGIN}/careers/`
