import type { APIRoute } from "astro"

export const prerender = false

// Server-side proxy for the two Gravity Forms behind the header CTAs.
//
// Why a proxy rather than posting the form straight at design1st.com:
// the browser CAN post cross-origin, but it cannot READ the response, so the
// page would have no idea whether the submission succeeded or tripped
// validation. The live site avoids that only because it is same-origin with
// WordPress. Forwarding from the server keeps that feedback — we read Gravity
// Forms' HTML response and translate it into JSON for the client.
//
// Tokens (state_NN, gform_currency) are signed/encrypted by WordPress and cannot
// be minted here, so they are replayed from the vendored snapshot. They are
// stable across requests — verified by fetching the homepage twice — but they DO
// rotate when the form is edited in WordPress, which is why `npm run chrome:sync`
// refreshes them and why a submission smoke test is part of that workflow.

import snapshot from "../../chrome/chrome.json"

/** The two forms we proxy, keyed by the name the client sends. */
const FORMS = {
  talk: { id: "28", targetPage: "0", sourcePage: "2" },
  email: { id: "30", targetPage: "0", sourcePage: "1" },
} as const

type FormKey = keyof typeof FORMS

/** Pull the signed hidden-field values for a form out of the vendored snapshot. */
function snapshotTokens(formId: string): Record<string, string> {
  const html = snapshot.footer
  const out: Record<string, string> = {}
  for (const name of [`state_${formId}`, "gform_currency"]) {
    // Attribute order/quoting varies between WP renders, so match on name= then
    // take the value= that follows within the same tag.
    const re = new RegExp(`<input[^>]*name=['"]${name}['"][^>]*>`, "i")
    const tag = html.match(re)?.[0]
    const value = tag?.match(/value=['"]([^'"]*)['"]/i)?.[1]
    if (value !== undefined) out[name] = value
  }
  return out
}

/** Gravity Forms echoes validation errors in the returned markup. */
function readGravityResponse(html: string, formId: string) {
  const failed = /gform_validation_error|gfield_description validation_message|validation_error/i.test(html)
  if (!failed) {
    const confirmation = html.match(
      new RegExp(`<div[^>]*id=['"]gform_confirmation_message_${formId}['"][^>]*>([\\s\\S]*?)</div>`, "i"),
    )?.[1]
    return {
      ok: true,
      message: confirmation?.replace(/<[^>]+>/g, "").trim() || "Thanks — we'll be in touch shortly.",
    }
  }
  const fieldErrors = [...html.matchAll(/class=['"][^'"]*validation_message[^'"]*['"][^>]*>([\s\S]*?)</gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
  return { ok: false, message: "Please check the highlighted fields.", fieldErrors }
}

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, string>
  try {
    payload = (await request.json()) as Record<string, string>
  } catch {
    return json({ ok: false, message: "Malformed request." }, 400)
  }

  const key = payload.form as FormKey
  const form = FORMS[key]
  if (!form) return json({ ok: false, message: "Unknown form." }, 400)

  // Honeypot: Gravity Forms randomises this field's name per form (input_41 on
  // 28, input_42 on 30) and silently discards anything that fills it. We keep
  // ours empty and bail early if a bot filled the decoy we render.
  if (payload.honeypot) return json({ ok: true, message: "Thanks — we'll be in touch shortly." })

  const body = new FormData()
  const set = (k: string, v: string) => body.set(k, v ?? "")

  set("input_12.3", payload.firstName ?? "")
  set("input_12.6", payload.lastName ?? "")
  set("input_15", payload.email ?? "")
  set("input_23", payload.company ?? "")
  set("input_18", payload.location ?? "")
  set("input_20", payload.phone ?? "")
  set("input_21", payload.message ?? "")

  // Form 28's optional "additional info" checkboxes, sent only when ticked.
  if (key === "talk") {
    for (const [i, value] of [
      "Would you like us to reach out to you to discuss things further?",
      "Would you like info on design of physical products?",
      "Do you require assistance to get manufacturing setup?",
      "Would you like a list of funding sources?",
    ].entries()) {
      if (payload[`additional${i + 1}`]) set(`input_27.${i + 1}`, value)
    }
  }

  set("is_submit_" + form.id, "1")
  set("gform_submit", form.id)
  set("gform_unique_id", "")
  set("gform_field_values", "")
  set("gform_target_page_number_" + form.id, form.targetPage)
  set("gform_source_page_number_" + form.id, form.sourcePage)
  for (const [k, v] of Object.entries(snapshotTokens(form.id))) set(k, v)

  try {
    const res = await fetch("https://design1st.com/", {
      method: "POST",
      body,
      headers: {
        // WordPress/Cloudflare are picky about obviously-scripted clients.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Referer: "https://design1st.com/",
      },
    })
    const html = await res.text()
    if (!res.ok) return json({ ok: false, message: `Submission rejected (${res.status}).` }, 502)
    return json(readGravityResponse(html, form.id))
  } catch (err) {
    return json({ ok: false, message: "Could not reach the form service. Please try again." }, 502)
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}
