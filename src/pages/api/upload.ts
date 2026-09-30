import type { APIRoute } from "astro"
import { UPSTREAM_HEADERS, UPLOAD_RULES, getTokens, refreshTokens } from "@/lib/gravity"

export const prerender = false

// Proxy fallback for the file upload. NOT the production path.
//
// In production the page is on design1st.com and the browser posts each file
// straight to Gravity Forms' upload endpoint on the same origin (see
// src/pages/api/apply.ts for why). That is impossible from `astro dev` or a
// bare *.vercel.app staging URL — cross-origin, and the reply is unreadable —
// so the form falls back to sending the same multipart body here, and this
// forwards it. It inherits Vercel's 4.5 MB request cap, which is exactly the
// limit the direct path exists to avoid; fine for testing, not for portfolios.
//
// The browser sends the identical field set either way (form_id, field_id,
// gform_unique_id, name, file). The only thing added here is the nonce, so a
// dev build never has to know one.

export const POST: APIRoute = async ({ request }) => {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ status: "error", error: { message: "Malformed upload." } }, 400)
  }
  const file = form.get("file")
  if (!(file instanceof File)) return json({ status: "error", error: { message: "No file." } }, 400)
  if (file.size > UPLOAD_RULES.maxBytes) {
    return json({ status: "error", error: { message: "File exceeds size limit." } }, 413)
  }

  let tokens
  try {
    tokens = await getTokens()
  } catch (err) {
    console.error("[upload] token fetch failed:", err)
    return json({ status: "error", error: { message: "Could not reach the upload service." } }, 502)
  }

  const nonceKey = `_gform_file_upload_nonce_${form.get("form_id")}_${form.get("field_id")}`
  const send = (t: typeof tokens) => {
    form.set(nonceKey, t.uploadNonce)
    return fetch(t.uploadUrl, { method: "POST", body: form, headers: UPSTREAM_HEADERS })
  }

  try {
    let res = await send(tokens)
    // A refused nonce ("Your session has expired") means the cached tokens are
    // stale. Refresh once and try again.
    if (res.status === 403) res = await send(await refreshTokens())
    const text = await res.text()
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    })
  } catch (err) {
    console.error("[upload] could not reach WordPress:", err)
    return json({ status: "error", error: { message: "Could not reach the upload service." } }, 502)
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}
