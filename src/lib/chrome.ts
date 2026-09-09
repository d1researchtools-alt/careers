// Serves the VENDORED design1st.com chrome from a point-in-time snapshot.
//
// Previously getChrome() fetched design1st.com on every render (ISR-cached 5
// min) so the live WordPress header/footer tracked automatically. This branch
// bakes that in instead: src/chrome/chrome.json is a snapshot produced by
// `node scripts/snapshot-chrome.mjs`. No runtime fetch — the page renders the
// same whether or not WordPress is reachable, and every deploy is byte-stable.
//
// Trade-off: header/footer/menu edits in WordPress no longer appear on their
// own. To pick them up, re-run the snapshot script and redeploy.
//
// The extraction rules live in chrome-parse.mjs (shared with the snapshot
// script). The stylesheet/script URLs in the snapshot still point at
// design1st.com — the same assets the live site loads — so the chrome is
// pixel-identical to production; only the markup is frozen.

import snapshot from "../chrome/chrome.json"

export interface ScriptItem {
  src?: string
  code?: string
  type?: string
  defer: boolean
  async: boolean
  id?: string
}

export interface Chrome {
  header: string
  footer: string
  styleHrefs: string[]
  inlineStyles: string[]
  scripts: ScriptItem[]
}

// Kept async so callers (Layout.astro) need no change if we ever reintroduce a
// live-fetch fallback.
export async function getChrome(): Promise<Chrome> {
  return snapshot as Chrome
}
