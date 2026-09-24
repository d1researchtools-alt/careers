// Paste-into-the-Cloudflare-dashboard version of the Worker.
// Same logic as worker.js, but the Vercel URL is hardcoded so there's no
// environment variable to configure — just paste this and add the route
// design1st.com/careers* (see DEPLOY.md).
const PREFIX = "/careers"
const UPSTREAM_HEADER = "X-D1-Upstream"

export default {
  async fetch(request) {
    const VERCEL_ORIGIN = "https://careers-ten-nu.vercel.app" // ← the careers Vercel production URL, no trailing slash

    const url = new URL(request.url)

    // The route pattern /careers* also matches paths like /careers-2024, which
    // are WordPress's, not ours. Only claim /careers and /careers/*.
    const isOurs = url.pathname === PREFIX || url.pathname.startsWith(PREFIX + "/")
    if (!isOurs) return fetch(request)

    // The app's own server fetching the WordPress careers page for Gravity
    // Forms tokens, or posting an application. Hand it to WordPress; without
    // this every submission fails. See worker.js for why.
    if (request.headers.get(UPSTREAM_HEADER) === "wordpress") return fetch(request)

    // Strip the prefix: the origin serves / and /_astro/*, not the
    // /careers-prefixed paths the HTML asks for. See worker.js for why.
    const originPath = url.pathname.slice(PREFIX.length) || "/"
    const target = new URL(originPath + url.search, VERCEL_ORIGIN)

    const proxied = new Request(target, request)
    proxied.headers.set("X-Forwarded-Host", url.host)
    proxied.headers.set("X-Forwarded-Proto", "https")

    const response = await fetch(proxied)

    // Re-prefix origin redirects so the browser stays under /careers.
    const location = response.headers.get("Location")
    if (location) {
      const dest = new URL(location, target)
      if (dest.host === new URL(VERCEL_ORIGIN).host) {
        const rewritten = new Response(response.body, response)
        rewritten.headers.set("Location", PREFIX + dest.pathname + dest.search)
        return rewritten
      }
    }

    return response
  },
}
