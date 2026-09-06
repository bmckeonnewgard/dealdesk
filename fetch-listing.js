// Vercel serverless function: fetches a listing URL (Crexi, LoopNet, a brokerage page, etc.)
// server-side and returns its plain text, so the Screen tab and New Deal modal's "paste a listing
// URL" option can pull OM/listing text without hitting that site's CORS restrictions in the
// browser. This is intentionally best-effort — many CRE listing sites block automated requests
// outright, sit behind a login, or render their content with JavaScript (meaning the raw HTML this
// function sees has no useful text) — deal-desk.html falls back to its existing upload/paste flow
// whenever this comes back empty or fails, so nothing is ever silently missing.
//
// Basic SSRF guard: only plain http(s) URLs are fetched, and obviously-local/private hostnames are
// rejected up front. This is a reasonable safeguard for an internal team tool, not a hardened
// defense (it doesn't resolve DNS to catch a hostname that only *resolves* to a private address) —
// worth revisiting if this app's audience or trust boundary ever changes.

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local, including cloud metadata endpoints
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd00:/i,
];

function stripToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { url } = body || {};
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing 'url' string in request body." });
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    res.status(400).json({ error: "That doesn't look like a valid URL." });
    return;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    res.status(400).json({ error: "Only http/https URLs are supported." });
    return;
  }
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(parsed.hostname))) {
    res.status(400).json({ error: "That URL isn't allowed." });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let pageRes;
    try {
      pageRes = await fetch(parsed.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          // A realistic browser UA — a good number of listing sites block requests with no UA or
          // an obvious bot/library default one outright.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!pageRes.ok) {
      res.status(502).json({
        error: "Couldn't fetch that page",
        detail: "The site responded with HTTP " + pageRes.status + " — it may be blocking automated requests or the link may be wrong.",
      });
      return;
    }

    const contentType = pageRes.headers.get("content-type") || "";
    if (!/html|text/i.test(contentType)) {
      res.status(502).json({
        error: "Unsupported content type",
        detail: "That URL didn't return an HTML/text page (got \"" + contentType + "\").",
      });
      return;
    }

    const html = await pageRes.text();
    const text = stripToText(html).slice(0, 20000);
    res.status(200).json({ text });
  } catch (e) {
    const isAbort = e && (e.name === "AbortError");
    res.status(502).json({
      error: "Couldn't fetch that page",
      detail: isAbort ? "The request timed out." : String((e && e.message) || e),
    });
  }
};
