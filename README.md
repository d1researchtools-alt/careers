# careers

The `/careers` page of design1st.com: an Astro app serving one page and the
application form on it. The rest of design1st.com is WordPress; this is not,
and the two are stitched together at the edge — the same arrangement as the
`insights` repo, which this one was copied from.

```
design1st.com/careers*   →  Cloudflare Worker  →  Vercel (this app, SSR)
design1st.com/*          →  WordPress
```

The Worker (`worker/worker.js`) claims `/careers` and `/careers/*`, strips the
prefix, and forwards to the Vercel deployment. `astro.config.mjs` sets
`base: "/careers"` so every URL the HTML emits lands back inside that route.
Deployment steps are in **DEPLOY.md**.

## Run

```bash
npm install
npm run dev
```

Then open **http://localhost:4321/careers/** — not `/`. The base prefix applies
in dev too, and a bare `/` 404s.

```bash
npm run build       # SSR build via the Vercel adapter
npm run preview
npm run smoke       # headless: page renders, chrome present, a test file uploads
```

## What is where

```
src/pages/index.astro                  the page
src/components/careers/ApplyForm.astro the form and its client script
src/pages/api/apply.ts                 GET: upload config · POST: submit to WordPress
src/pages/api/upload.ts                file-upload proxy for dev/staging only
src/lib/gravity.ts                     Gravity Forms tokens + response parsing
src/styles/careers.css                 every colour, size and space on the page
src/styles/tokens.css                  shared tokens (copied from insights)
src/components/chrome/                 header, footer, contact modals (copied)
public/static/images/careers/          the photos, as WebP
scripts/optimise-images.mjs            regenerates those from WordPress
worker/                                the Cloudflare Worker + wrangler config
```

## The form

The "Job Request Form" is still **Gravity Forms form #2 on WordPress**.
Applications land in the same entries list, trigger the same notifications and
store resumes in the same place as before; hiring sees no change. This app
only replaces the front end.

How a submission travels:

1. The applicant adds a file. The browser asks `GET /api/apply` for the
   current upload target and nonce, then posts the file **directly** to
   Gravity Forms' upload endpoint (`design1st.com/?gf_page=…`). That is the
   same origin as `design1st.com/careers`, so no CORS, and it sidesteps
   Vercel's 4.5 MB request cap — the form promises 15 MB per file. WordPress
   answers with a temp filename.
2. On submit, the text fields and the temp filenames go as JSON to
   `POST /api/apply`, which posts them into form #2 server-side and turns the
   HTML that comes back (confirmation, or per-field errors) into JSON.

Both steps need tokens that only exist in the HTML WordPress renders for
`/careers/`: a signed `state_2`, and a file-upload nonce that rotates every
12 hours. `src/lib/gravity.ts` fetches that page with the header
`X-D1-Upstream: wordpress`, which the Worker uses to hand the request to the
origin instead of looping it back here. Tokens are cached for 10 minutes per
function instance.

**Off design1st.com** (dev, a `*.vercel.app` staging URL) the upload endpoint
is cross-origin, so the script falls back to `POST /api/upload`, a proxy with
the 4.5 MB cap. Fine for testing with a resume; not the production path.

### Things worth knowing

- **Accepted file types are PDF, JPG and PNG.** The WordPress field is
  configured as `jpg, word, png, pdf, word` — and `word` is not an extension,
  so `.doc`/`.docx` have always been rejected server-side, whatever the old
  drop zone said. Add `doc, docx` to the field in WordPress, then to
  `UPLOAD_RULES.extensions` in `src/lib/gravity.ts`.
- **Editing form #2 in WordPress** rotates `state_2`. The cache refreshes
  within 10 minutes; a submission in that window gets the "couldn't confirm"
  message and the cache is dropped immediately, so the retry succeeds.
- **When WordPress goes away**, `src/lib/gravity.ts` and the two API routes are
  the only files that know about it. Re-point `POST /api/apply` at whatever
  replaces Gravity Forms (an ATS, a mailer with attachments); the page and the
  client script need no change beyond where files are posted.
- The honeypot mirrors form #2's own (`input_20`, "X/Twitter"). Anything that
  fills it gets a success message and is discarded.

## The chrome

Header, footer and the two contact modals are copied verbatim from the
`insights` repo (`src/components/chrome/`, `src/styles/{tokens,chrome}.css`,
`public/chrome/`, `src/chrome/chrome.json`). Menu edits happen there and are
copied here; the contact modals post through `/api/contact` exactly as on
/insights. See that repo's README and `scripts/README.md` for the full story,
the pixel-diff tooling and the house rules.

## Known constraints

- **One page, one canonical.** `https://design1st.com/careers/` — trailing
  slash, as WordPress always declared it. The `*.vercel.app` origin and every
  non-production deployment are `noindex`.
- **`og:image` still points at WordPress.** Deliberate: it is the file every
  existing share has cached, it lives outside the Worker route so WordPress
  keeps serving it, and link previews are still unreliable with WebP.
- **Staging is not a byte-exact preview.** Building with `ASTRO_BASE=/` lets a
  branch be viewed on its bare `*.vercel.app` URL, but paths differ from
  production and file uploads go through the proxy. See `astro.config.mjs`.
