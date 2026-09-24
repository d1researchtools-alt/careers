import type { APIRoute } from "astro"
import {
  FORM_ID,
  FILE_FIELD_ID,
  WP_PAGE,
  UPSTREAM_HEADERS,
  UPLOAD_RULES,
  MESSAGES,
  getTokens,
  readSubmitResponse,
} from "@/lib/gravity"

export const prerender = false

// The application form's endpoint. Two verbs:
//
//   GET  → what the browser needs to upload files STRAIGHT to Gravity Forms:
//          the async upload URL, the current nonce, and the field rules.
//   POST → the application itself, forwarded server-side into form #2.
//
// Why the split. Vercel functions cap a request body at 4.5 MB, and the form
// promises applicants 15 MB per file — an industrial designer's portfolio PDF
// is routinely over 4.5 MB. So the files cannot pass through here. They do not
// need to: the page is served at design1st.com/careers, and the Gravity Forms
// upload endpoint is design1st.com/?gf_page=…, which is the SAME ORIGIN and
// outside the Worker's /careers* route. The browser can post to it directly,
// read the JSON reply, and hand the resulting temp filenames to this endpoint
// with the text fields. That is exactly the dance Gravity Forms' own plupload
// widget does; we just do it without the widget. (/api/upload is the proxy
// fallback for dev and staging, where the page is not on design1st.com.)
//
// The text fields still go through here, not straight to WordPress, for the
// same reason /api/contact exists: a POST to /careers/ from the browser would
// hit this app, and a postback to WordPress is a full page we would rather
// parse once, on the server, into a JSON answer the form can show.

export const GET: APIRoute = async () => {
  try {
    const t = await getTokens()
    return json({
      ok: true,
      uploadUrl: t.uploadUrl,
      nonce: t.uploadNonce,
      formId: FORM_ID,
      fieldId: FILE_FIELD_ID,
      ...UPLOAD_RULES,
    })
  } catch (err) {
    console.error("[apply] token fetch failed:", err)
    return json({ ok: false, message: MESSAGES.unreachable }, 502)
  }
}

/** Gravity Forms' choice values for field 10 — must match the form exactly. */
const GF_DISCIPLINES = ["Industrial Designer", "Mechanical Engineer", "Electronics Engineer", "Embedded Systems", "Other"]

/**
 * The page's Discipline select → the field 10 checkbox it ticks. Form #2 has
 * no Manufacturing choice, so it lands on Other; the exact choice (and the
 * "Your Discipline" text) is written into field 11 as well, so hiring always
 * sees what the applicant picked.
 */
const DISCIPLINE_MAP: Record<string, string> = {
  "Mechanical engineering": "Mechanical Engineer",
  "Industrial design": "Industrial Designer",
  "Electronics engineering": "Electronics Engineer",
  "Embedded software": "Embedded Systems",
  Manufacturing: "Other",
  Other: "Other",
}

interface UploadedFile {
  temp_filename: string
  uploaded_filename: string
  /** Gravity Forms' integrity hash for the temp file, when it sends one. */
  hash?: string
}

interface Payload {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  why?: string
  discipline?: string
  /** Only when discipline is "Other". */
  disciplineOther?: string
  workUrl?: string
  files?: UploadedFile[]
  /** The alnum id the browser used for its uploads; the submit must match. */
  uniqueId?: string
  honeypot?: string
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const URL_LIKE = /^https?:\/\/\S+\.\S+/i
const UNIQUE_ID = /^[a-z0-9]{8,40}$/i
// A temp filename is "<uniqueId>_input_<field>_<random>.<ext>". Anything with
// a path separator in it is not one, whatever else it is.
const TEMP_NAME = /^[A-Za-z0-9_.-]{1,255}$/
const HASH = /^[a-f0-9]{64}$/i

export const POST: APIRoute = async ({ request }) => {
  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return json({ ok: false, message: "Malformed request." }, 400)
  }

  const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "")
  const firstName = str(payload.firstName, 200)
  const lastName = str(payload.lastName, 200)
  const email = str(payload.email, 320)
  const phone = str(payload.phone, 50)
  const why = str(payload.why, 10000)
  const uniqueId = str(payload.uniqueId, 40)
  const discipline = str(payload.discipline, 100)
  const disciplineOther = str(payload.disciplineOther, 200)
  const workUrl = str(payload.workUrl, 2000)
  const files = Array.isArray(payload.files) ? payload.files : []

  // Honeypot: form #2's decoy is input_20 ("X/Twitter"). Gravity Forms discards
  // anything that fills it; we answer as if it worked, which tells a bot
  // nothing it can act on.
  if (str(payload.honeypot)) return json({ ok: true, message: MESSAGES.success })

  // Every field on the page is required. Form #2 itself only requires field
  // 11, so these checks are the page's rules, enforced here too. Keys match
  // the form's data-gf attributes.
  const required = "This field is required."
  const fieldErrors: Record<string, string> = {}
  if (!firstName) fieldErrors["9.3"] = required
  if (!lastName) fieldErrors["9.6"] = required
  if (!email) fieldErrors["1"] = required
  else if (!EMAIL.test(email)) fieldErrors["1"] = "Please enter a valid email address."
  if (!phone) fieldErrors["8"] = required
  if (!(discipline in DISCIPLINE_MAP)) fieldErrors["10"] = required
  else if (discipline === "Other" && !disciplineOther) fieldErrors.disciplineOther = required
  if (!files.length) fieldErrors["3"] = "Please attach your résumé or portfolio."
  if (!workUrl) fieldErrors.workUrl = required
  else if (!URL_LIKE.test(workUrl)) fieldErrors.workUrl = "Please enter a full link, starting with https://"
  if (!why) fieldErrors["11"] = required
  if (Object.keys(fieldErrors).length) return json({ ok: false, message: MESSAGES.invalid, fieldErrors }, 400)

  if (files.length > UPLOAD_RULES.maxFiles) {
    return json({ ok: false, message: `You can attach up to ${UPLOAD_RULES.maxFiles} files.` }, 400)
  }
  for (const f of files) {
    if (
      !f ||
      typeof f.temp_filename !== "string" ||
      typeof f.uploaded_filename !== "string" ||
      !TEMP_NAME.test(f.temp_filename) ||
      f.uploaded_filename.length > 255 ||
      (f.hash !== undefined && (typeof f.hash !== "string" || !HASH.test(f.hash)))
    ) {
      return json({ ok: false, message: "One of the attached files could not be read. Please re-attach it." }, 400)
    }
  }
  if (files.length && !UNIQUE_ID.test(uniqueId)) {
    return json({ ok: false, message: "One of the attached files could not be read. Please re-attach it." }, 400)
  }

  let tokens
  try {
    tokens = await getTokens()
  } catch (err) {
    console.error("[apply] token fetch failed:", err)
    return json({ ok: false, message: MESSAGES.unreachable }, 502)
  }

  const body = new FormData()
  const set = (k: string, v: string) => body.set(k, v)

  // Field ids from the live form: 9 name, 1 email, 8 phone, 11 why, 10
  // discipline checkboxes, 3 files, 20 honeypot. 12–19 are hidden tracking
  // fields that the WordPress page leaves empty; omitting them is the same.
  // Form #2 has no fields for the exact discipline or the work link, so they
  // head field 11 where the entry and the notification email both show them.
  const gfDiscipline = DISCIPLINE_MAP[discipline]
  const details = [
    `Discipline: ${discipline === "Other" ? `Other: ${disciplineOther}` : discipline}`,
    `Link to work: ${workUrl}`,
  ].join("\n")
  set("input_9.3", firstName)
  set("input_9.6", lastName)
  set("input_1", email)
  set("input_8", phone)
  set("input_11", `${details}\n\n${why}`)
  set("input_20", "")
  set(`input_10.${GF_DISCIPLINES.indexOf(gfDiscipline) + 1}`, gfDiscipline)

  // The files were already uploaded to Gravity Forms' temp directory by the
  // browser (see GET). This is the ledger the widget would have kept in its
  // gform_uploaded_files hidden input; on submit WordPress moves each temp
  // file into the entry.
  set(
    "gform_uploaded_files",
    files.length
      ? JSON.stringify({
          [`input_${FILE_FIELD_ID}`]: files.map((f) => ({
            temp_filename: f.temp_filename,
            uploaded_filename: f.uploaded_filename,
            ...(f.hash ? { hash: f.hash } : {}),
          })),
        })
      : "",
  )

  set("is_submit_" + FORM_ID, "1")
  set("gform_submit", FORM_ID)
  set("gform_unique_id", files.length ? uniqueId : "")
  set("gform_field_values", "")
  set("gform_submission_method", "postback")
  set("gform_theme", "legacy")
  set("gform_style_settings", "")
  set("gform_target_page_number_" + FORM_ID, "0")
  set("gform_source_page_number_" + FORM_ID, "1")
  set("state_" + FORM_ID, tokens.state)
  set("gform_currency", tokens.currency)

  try {
    const res = await fetch(WP_PAGE, {
      method: "POST",
      body,
      headers: UPSTREAM_HEADERS,
      // A confirmation configured as a redirect comes back as a 3xx. That is a
      // success signal in its own right; following it would only fetch some
      // other page and lose it.
      redirect: "manual",
    })
    if (res.status >= 300 && res.status < 400) return json({ ok: true, message: MESSAGES.success })
    const html = await res.text()
    if (!res.ok) {
      console.error(`[apply] WordPress answered ${res.status}`)
      return json({ ok: false, message: `Submission rejected (${res.status}).` }, 502)
    }
    const result = readSubmitResponse(html)
    if (!result.ok && !result.fieldErrors) {
      // The empty form came back. The likeliest cause is a state token that
      // rotated under us; drop the cache so the next attempt fetches fresh.
      console.error("[apply] no confirmation in WordPress response; invalidating tokens")
      await getTokens(true).catch(() => {})
    }
    return json(result, result.ok ? 200 : 422)
  } catch (err) {
    console.error("[apply] could not reach WordPress:", err)
    return json({ ok: false, message: MESSAGES.unreachable }, 502)
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}
