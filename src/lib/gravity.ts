// The Gravity Forms side of the application form.
//
// The careers form is still WordPress's Gravity Forms form #2. Applications
// have to keep landing there — that is where the notifications, the entries
// list and the resume files live, and nobody in hiring should notice that the
// page moved. So this module knows how to (a) read the tokens a submission
// needs out of the live WordPress page, (b) tell success from failure in the
// HTML Gravity Forms sends back, and nothing else. The endpoints under
// src/pages/api/ do the talking.
//
// Why fetch tokens live instead of replaying a snapshot like /api/contact does:
// the contact forms need only `state_NN` and `gform_currency`, which are stable
// until someone edits the form. The careers form also has a FILE field, and
// its upload endpoint is guarded by a WordPress nonce that rotates every 12
// hours (valid for 24). A vendored copy would be dead within a day.
//
// Fetching design1st.com/careers/ from the server would normally loop straight
// back into this app — that path IS our Cloudflare Worker route. The Worker
// hands any request carrying X-D1-Upstream: wordpress to the origin instead;
// see worker/worker.js.

export const FORM_ID = "2"
export const FILE_FIELD_ID = "3"

/** The WordPress page that renders form #2 — token source and submit target. */
export const WP_PAGE = "https://design1st.com/careers/"

/** What the Worker looks for to route a request past this app to WordPress. */
export const UPSTREAM_HEADERS = {
  "X-D1-Upstream": "wordpress",
  // WordPress/Cloudflare are picky about obviously-scripted clients.
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Referer: WP_PAGE,
} as const

/**
 * Field rules as configured on the WordPress side (gform_fileupload_multifile
 * data-settings on the live page). The extension list is what Gravity Forms
 * ACTUALLY accepts, not what the live page's drop zone claims: the field is
 * configured as "jpg, word, png, pdf, word", and "word" is not an extension —
 * a .docx never passes the server check. Add doc/docx in the WordPress field
 * settings first, then here.
 */
export const UPLOAD_RULES = {
  maxFiles: 2,
  maxBytes: 15 * 1024 * 1024,
  extensions: ["pdf", "jpg", "png"],
} as const

export interface GravityTokens {
  /** Signed form state, `state_2`. Rotates when the form is edited. */
  state: string
  /** Encrypted currency marker, `gform_currency`. */
  currency: string
  /** The async upload endpoint, `/?gf_page=<hash>`. Stable per site. */
  uploadUrl: string
  /** `_gform_file_upload_nonce_2_3`. 12-hour rotation, 24-hour validity. */
  uploadNonce: string
  fetchedAt: number
}

// Instance-local cache. One WordPress fetch per function instance per 10 min
// is plenty: the nonce is good for 24 hours, and the state token for as long
// as nobody edits the form. Shorter than the nonce life on purpose — a token
// set fetched from a stale page cache is refreshed well before it expires.
const TTL_MS = 10 * 60 * 1000
let cached: GravityTokens | null = null
let inflight: Promise<GravityTokens> | null = null

export async function getTokens(force = false): Promise<GravityTokens> {
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached
  if (!inflight) {
    inflight = fetchTokens().finally(() => {
      inflight = null
    })
  }
  cached = await inflight
  return cached
}

async function fetchTokens(): Promise<GravityTokens> {
  const res = await fetch(WP_PAGE, { headers: UPSTREAM_HEADERS })
  if (!res.ok) throw new Error(`WordPress answered ${res.status} for ${WP_PAGE}`)
  const html = await res.text()
  const tokens = parseTokens(html)
  return { ...tokens, fetchedAt: Date.now() }
}

/** Exported for the smoke test; everything else goes through getTokens(). */
export function parseTokens(html: string): Omit<GravityTokens, "fetchedAt"> {
  // Only look inside form #2. gform_currency is also rendered by the two
  // contact forms in the footer, and the values are per-render, not per-form,
  // but scoping is cheap and the header/footer forms are not ours to read.
  const form = html.match(new RegExp(`<form[^>]*id=['"]gform_${FORM_ID}['"][\\s\\S]*?</form>`, "i"))?.[0]
  if (!form) throw new Error(`form #${FORM_ID} not found on ${WP_PAGE} — did the page move?`)

  const hidden = (name: string) => {
    // Attribute order/quoting varies between WP renders, so match on name= then
    // take the value= that follows within the same tag.
    const tag = form.match(new RegExp(`<input[^>]*name=['"]${name}['"][^>]*>`, "i"))?.[0]
    const value = tag?.match(/value=['"]([^'"]*)['"]/i)?.[1]
    if (value === undefined) throw new Error(`hidden field ${name} not found in form #${FORM_ID}`)
    return value
  }

  // The uploader config is a JSON blob in a data-settings attribute, HTML-
  // entity encoded. It carries the obfuscated upload URL and the nonce.
  const settingsAttr = form.match(
    new RegExp(`id=['"]gform_multifile_upload_${FORM_ID}_${FILE_FIELD_ID}['"][^>]*data-settings=['"]([^'"]*)['"]`, "i"),
  )?.[1]
  if (!settingsAttr) throw new Error(`uploader settings for field ${FILE_FIELD_ID} not found in form #${FORM_ID}`)
  const settings = JSON.parse(decodeEntities(settingsAttr)) as {
    url?: string
    multipart_params?: Record<string, string | number>
  }
  const uploadUrl = settings.url
  const uploadNonce = settings.multipart_params?.[`_gform_file_upload_nonce_${FORM_ID}_${FILE_FIELD_ID}`]
  if (!uploadUrl || typeof uploadNonce !== "string") throw new Error("uploader settings missing url or nonce")

  return {
    state: hidden(`state_${FORM_ID}`),
    currency: hidden("gform_currency"),
    uploadUrl,
    uploadNonce,
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

export interface SubmitResult {
  ok: boolean
  message: string
  /** Gravity Forms field id → its validation message, when it rejected the entry. */
  fieldErrors?: Record<string, string>
}

export const MESSAGES = {
  success: "Thanks — your application is in. We review every one and will be in touch.",
  invalid: "Please check the highlighted fields.",
  unconfirmed:
    "We couldn't confirm your application went through. Please try again, or email it to info@design1st.com.",
  unreachable: "Could not reach the application service. Please try again, or email info@design1st.com.",
} as const

/**
 * Gravity Forms answers a postback with the whole page: the confirmation
 * message where the form was, or the form again with per-field errors.
 */
export function readSubmitResponse(html: string): SubmitResult {
  // "gform_validation_error" also appears in the page's inline CSS and JS on
  // every render, so the class has to be read off the wrapper tag itself, or
  // off an actual per-field message — not found anywhere in the document.
  const fieldErrors: Record<string, string> = {}
  for (const m of html.matchAll(
    new RegExp(`id=['"]validation_message_${FORM_ID}_(\\d+)['"][^>]*>([\\s\\S]*?)</`, "gi"),
  )) {
    const text = m[2].replace(/<[^>]+>/g, "").trim()
    if (text) fieldErrors[m[1]] = text
  }
  const wrapper = html.match(new RegExp(`<div[^>]*id=['"]gform_wrapper_${FORM_ID}['"][^>]*>`, "i"))?.[0] ?? ""
  if (/gform_validation_error/i.test(wrapper) || Object.keys(fieldErrors).length) {
    return { ok: false, message: MESSAGES.invalid, fieldErrors }
  }

  const confirmation = html.match(
    new RegExp(`<div[^>]*id=['"]gform_confirmation_message_${FORM_ID}['"][^>]*>([\\s\\S]*?)</div>`, "i"),
  )?.[1]
  if (confirmation !== undefined) {
    return { ok: true, message: confirmation.replace(/<[^>]+>/g, "").trim() || MESSAGES.success }
  }

  // Neither a confirmation nor an error: WordPress re-rendered the empty form.
  // That is what a stale/edited state token or a bot check looks like. Say
  // so honestly rather than claiming success.
  return { ok: false, message: MESSAGES.unconfirmed }
}
