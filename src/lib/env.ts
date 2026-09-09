/**
 * Which deployment this is, answered once.
 *
 * Vercel sets VERCEL_ENV to "production" | "preview" | "development" at build
 * AND at runtime, so this works under `output: "server"` where the page renders
 * per request. Locally it is unset, which reads as not-production — the same
 * answer we want for `astro dev`.
 *
 * Two things hang off this, and they pull in opposite directions on purpose:
 *
 *   IS_PRODUCTION  → gates the robots meta. Anything that is not the real
 *                    design1st.com deployment stays noindex, or the articles
 *                    exist at two URLs and link equity forks (HANDOFF.md §6).
 *   SHOW_DRAFTS    → the inverse. Drafts must render on preview, which is the
 *                    whole point of a preview deployment, and must 404 in
 *                    production (TICKETS.md T3).
 */
export const IS_PRODUCTION = process.env.VERCEL_ENV === "production"

/** Draft posts are listed and routable everywhere except production. */
export const SHOW_DRAFTS = !IS_PRODUCTION
