// Vercel serverless function: proxies AI text/JSON generation to the Anthropic API,
// keeping the API key on the server (it is never sent to the browser). This replaces
// the window.claude.use('sample') capability the app used while it ran as a Claude
// artifact — deal-desk.html's sampleApi()/sampleApi.json() call this endpoint.
//
// Setup (Vercel dashboard > your project > Settings > Environment Variables):
//   ANTHROPIC_API_KEY  (required) — a key from https://console.anthropic.com/settings/keys
//   ANTHROPIC_MODEL    (optional) — overrides the default model below
//
// After adding/changing env vars, redeploy for them to take effect.

const { jsonrepair } = require("jsonrepair");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { prompt, json, modelTier } = body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt' string in request body." });
    return;
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  // "default" covers every JSON-extraction prompt (OM/listing extraction, deal screening, model
  // gist, and contract-document extraction) — some of those, contract extraction especially, ask
  // for a dozen-plus fields plus a multi-sentence notes field and an array, and 1200 tokens was
  // occasionally too tight for that: the model's JSON got cut off mid-object on a rich document
  // and failed to parse ("Model did not return valid JSON"), particularly for longer OCR'd scans
  // or a detailed typed update covering multiple parcels/parties. Bumping the cap doesn't cost
  // anything unless a response actually needs it — Anthropic bills for tokens actually generated,
  // not the max_tokens ceiling.
  const maxTokens = modelTier === "quick" ? 600 : 4096;

  const finalPrompt = json
    ? prompt + "\n\nRespond with ONLY a valid JSON object. No markdown code fences, no preamble, no explanation."
    : prompt;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: finalPrompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      res.status(502).json({ error: "Anthropic API error", detail: errText.slice(0, 500) });
      return;
    }

    const data = await anthropicRes.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (json) {
      let cleaned = text.replace(/```json|```/g, "").trim();
      // Belt-and-suspenders: if the model added any stray commentary before/after the object
      // despite being told not to, trim to the outermost braces before parsing rather than
      // failing outright on otherwise-valid JSON.
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      let result;
      try {
        result = JSON.parse(cleaned);
      } catch (e) {
        // Even after the brace-trimming above, the model's own JSON can still come back slightly
        // malformed — most commonly an unescaped quote inside a string value (e.g. it echoes a
        // quoted phrase straight out of the source document/note, like a date written as "dated
        // as of August 26, 2026", without escaping the inner quotes), and occasionally a response
        // cut short before it finished. jsonrepair fixes exactly these classes of issue (escaping,
        // truncation, stray commas, and more); only give up if it can't make sense of it either.
        try {
          result = JSON.parse(jsonrepair(cleaned));
        } catch (e2) {
          res.status(502).json({ error: "Model did not return valid JSON", raw: cleaned.slice(0, 500) });
          return;
        }
      }
      res.status(200).json({ result });
      return;
    }

    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: "Request to Anthropic API failed", detail: String((e && e.message) || e) });
  }
};
