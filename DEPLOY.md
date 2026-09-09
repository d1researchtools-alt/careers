# Deploying to design1st.com/careers

Architecture: design1st.com is behind Cloudflare. A Worker on the route
`design1st.com/careers*` reverse-proxies those requests to this app on Vercel.
Every other path is untouched and keeps hitting WordPress (WP Engine). So the
page *appears* at `design1st.com/careers` with no redirect and no visible
vercel.app URL — same model as the `/insights` and `/planningtools*` Workers.

```
Browser → design1st.com/careers/*      → Cloudflare Worker → Vercel (this app)
Browser → design1st.com/anything-else  → (Worker not on route) → WordPress
Browser → design1st.com/?gf_page=…     → WordPress (Gravity Forms file upload, same origin)
Vercel  → design1st.com/careers/ + X-D1-Upstream: wordpress → Worker passes to WordPress
```

That last line is the one thing this Worker does that the /insights one does
not: the application form still submits into Gravity Forms on WordPress, and
the tokens it needs live in the HTML WordPress renders for `/careers/` — which
is now the Worker's own route. See the header comment in `worker/worker.js`.

---

## Step 1 — Deploy the Astro app to Vercel

```bash
npm i -g vercel          # if you don't have the CLI
vercel login
vercel                   # first run: link/create the project, accept defaults
vercel --prod            # production deploy
```

Vercel auto-detects Astro and the adapter. When it finishes it prints the
production URL, e.g. `https://design1st-careers.vercel.app`.

Sanity-check it directly. On the bare vercel.app origin the page renders
**unstyled** (see "Previewing a branch" below — that is expected, not a bug):

```
https://design1st-careers.vercel.app/careers
```

### Environment variables

None are required. The form talks to WordPress with public tokens it reads at
request time. `ASTRO_BASE=/` on a staging project only, if you want a styled
preview on its vercel.app URL.

---

## Step 2 — Point the Worker at your Vercel URL

Edit `worker/wrangler.toml`:

```toml
[vars]
VERCEL_ORIGIN = "https://design1st-careers.vercel.app"   # ← your real prod URL
```

---

## Step 3 — Deploy the Cloudflare Worker + route

From `worker/`:

```bash
npm i -g wrangler        # if needed
wrangler login           # the Cloudflare account that owns design1st.com
wrangler deploy
```

`wrangler deploy` reads `wrangler.toml` and registers the route
`design1st.com/careers*` automatically.

- If your primary hostname is `www`, add a second route block for
  `www.design1st.com/careers*`.
- Dashboard alternative: Workers & Pages → create Worker → paste `worker.js` →
  set the `VERCEL_ORIGIN` variable → add a Trigger route `design1st.com/careers*`.

**Do not fold this into the /insights Worker** without also carrying over the
`X-D1-Upstream` pass-through. Without it the form's token fetch loops back to
Vercel and every submission fails with "couldn't confirm".

---

## Step 4 — Verify

```bash
curl -sI https://design1st.com/careers/ | head -n1                       # → 200
curl -sI https://design1st.com/careers/_astro/ 2>/dev/null | head -n1     # (any asset) → 200, text/css
curl -s  https://design1st.com/careers/api/apply | head -c 200            # → {"ok":true,"uploadUrl":"https://design1st.com/?gf_page=…","nonce":"…"
curl -sI -H "X-D1-Upstream: wordpress" https://design1st.com/careers/ | grep -i "x-powered-by\|server"   # → WordPress/WP Engine, not Vercel
```

Then the headless check, which uploads a test file (no entry is created):

```bash
URL=https://design1st.com/careers/ npm run smoke
```

`upload.state` should be `done`. Finally, one real submission — this **does**
create an entry and sends the notification, so warn whoever reads them:

```bash
SUBMIT=1 URL=https://design1st.com/careers/ npm run smoke
```

`submit.done` should be `true`, and the entry — with the test PDF attached —
should appear under Forms → Entries → Job Request Form in WordPress.

Open `https://design1st.com/careers/` in a browser:

- URL bar stays on design1st.com (proxy, not redirect).
- Header + footer render and the menus work.
- `https://design1st.com/` and every other page are unchanged.

## Previewing a branch directly on *.vercel.app

A staging deployment can't be viewed at `<project>.vercel.app/careers` — it
renders unstyled. The Vercel adapter strips `base` from what it builds (assets
land at `/_astro/*`), but the HTML still asks for `/careers/_astro/*`. On a
bare vercel.app origin nothing matches, the request falls to the SSR catch-all,
and the browser gets HTML where it asked for CSS.

Build staging at the root instead — on the **staging project only**, set:

```
ASTRO_BASE=/
```

Leave `ASTRO_BASE` unset in production. Note that on staging the file upload
goes through the `/api/upload` proxy (4.5 MB cap), because Gravity Forms'
upload endpoint is only same-origin on design1st.com.

## Updating later

- Page content/logic: edit files, `vercel --prod` again.
- Photos: swap in WordPress, `npm run images:careers`, commit, deploy.
- Worker/route changes: `wrangler deploy` from `worker/`.

## Tearing it down

Remove the `design1st.com/careers*` route (dashboard or delete the Worker) and
`/careers` instantly reverts to WordPress — the page there was never removed.
Optionally delete the Vercel project.
