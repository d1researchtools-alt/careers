/**
 * Cloudflare Worker — serves the Astro careers page at design1st.com/careers.
 *
 * Deployed on the route `design1st.com/careers*` (see wrangler.toml). Because
 * that route is scoped to /careers*, EVERY other path on design1st.com never
 * touches this Worker and keeps hitting the WordPress origin (WP Engine) exactly
 * as it does today — same model as the /insights and /planningtools* Workers.
 *
 * All this Worker does is reverse-proxy /careers* to the Vercel deployment, so
 * the page appears at design1st.com/careers (no redirect, no visible
 * vercel.app URL).
 *
 * The /careers prefix is STRIPPED before forwarding. Astro is built with
 * base: "/careers", so the HTML it emits asks for /careers/_astro/*, but the
 * Vercel adapter strips base from what it actually deploys — the origin serves
 * / and /_astro/*. Public path space keeps the prefix; origin path space does
 * not. (This is the /insights lesson: forwarding the path intact answered CSS
 * requests with a 404 HTML page and the site rendered unstyled.)
 *
 * ONE ADDITION over the /insights Worker: the pass-through header. The
 * application form still submits into Gravity Forms on WordPress, and the
 * tokens that submission needs (a signed form state and a file-upload nonce
 * that rotates every 12 hours) only exist in the HTML WordPress renders for
 * /careers/. That page is now this Worker's route, so a plain server-side
 * fetch of design1st.com/careers/ would loop straight back into Vercel. A
 * request carrying `X-D1-Upstream: wordpress` is handed to the origin instead.
 * The header is a routing hint, not a secret: the WordPress careers page is
 * public, so anyone sending it just gets the old page.
 */
const PREFIX = "/careers"
const UPSTREAM_HEADER = "X-D1-Upstream"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // The route pattern /careers* also matches paths like /careers-2024, which
    // are WordPress's, not ours. Only claim /careers and /careers/*.
    const isOurs = url.pathname === PREFIX || url.pathname.startsWith(PREFIX + "/")
    if (!isOurs) return fetch(request)

    // The app's own server asking WordPress for the live careers page (token
    // refresh) or posting an application into Gravity Forms. A same-zone
    // subrequest goes to the origin without re-entering this Worker.
    if (request.headers.get(UPSTREAM_HEADER) === "wordpress") return fetch(request)

    // /careers → /   |   /careers/api/apply → /api/apply
    const originPath = url.pathname.slice(PREFIX.length) || "/"

    // env.VERCEL_ORIGIN e.g. "https://design1st-careers.vercel.app" (no trailing slash)
    const target = new URL(originPath + url.search, env.VERCEL_ORIGIN)

    const proxied = new Request(target, request)
    proxied.headers.set("X-Forwarded-Host", url.host)
    proxied.headers.set("X-Forwarded-Proto", "https")

    const response = await fetch(proxied)

    // The origin redirects in its own (unprefixed) path space — e.g. Astro's
    // trailing-slash normalisation. Put the prefix back so the browser stays
    // under design1st.com/careers instead of being sent to a bare path that
    // this Worker never sees.
    const location = response.headers.get("Location")
    if (location) {
      const dest = new URL(location, target)
      const originHost = new URL(env.VERCEL_ORIGIN).host
      if (dest.host === originHost) {
        const rewritten = new Response(response.body, response)
        rewritten.headers.set("Location", PREFIX + dest.pathname + dest.search)
        return rewritten
      }
    }

    return response
  },
}
