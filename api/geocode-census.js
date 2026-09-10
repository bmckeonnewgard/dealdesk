// Vercel serverless function: proxies a one-line address to the U.S. Census Bureau's free
// Geocoder API (no key required), server-side.
//
// Why this exists: deal-desk.html's own geocodeAddress() tries Nominatim (OpenStreetMap) first,
// since it's the broadest free coverage — but Nominatim is community-mapped and regularly has no
// address point at all for rural highway/route addresses, unincorporated areas, or newer parcels.
// The Census Geocoder is built from the Census Bureau's own TIGER/Line address ranges instead of
// volunteer map edits, and reliably resolves exactly the kind of address Nominatim misses (a real
// example: "70265 Hwy 111, Rancho Mirage, CA" — no Nominatim hit, but the Census Geocoder places it
// precisely on State Route 111's address range). deal-desk.html calls this only as a fallback when
// Nominatim comes back empty, so this is a second attempt at a REAL pin, not the last resort —
// only when both this and Nominatim miss does the app fall back to an approximate market-center pin.
//
// Routed through this server-side proxy (rather than fetched directly from the browser) because the
// Census Geocoder API does not reliably send CORS headers for cross-origin browser requests.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { address } = body || {};
  if (!address || typeof address !== "string" || !address.trim()) {
    res.status(400).json({ error: "Missing 'address' string in request body." });
    return;
  }

  try {
    const url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
      + "?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(address.trim());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let geoRes;
    try {
      geoRes = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!geoRes.ok) {
      res.status(502).json({ error: "Census geocoder request failed", detail: "HTTP " + geoRes.status });
      return;
    }

    const data = await geoRes.json();
    const match = data && data.result && Array.isArray(data.result.addressMatches) && data.result.addressMatches[0];
    if (!match || !match.coordinates) {
      res.status(200).json({ hit: null });
      return;
    }

    const comps = match.addressComponents || {};
    res.status(200).json({
      hit: {
        lat: match.coordinates.y,
        lon: match.coordinates.x,
        matchedAddress: match.matchedAddress || null,
        // addressComponents.state is already the 2-letter USPS abbreviation for this benchmark.
        stateCode: comps.state || null,
      },
    });
  } catch (e) {
    const isAbort = e && e.name === "AbortError";
    res.status(502).json({
      error: "Census geocoder request failed",
      detail: isAbort ? "The request timed out." : String((e && e.message) || e),
    });
  }
};
