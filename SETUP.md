# Deal Desk — going live on Vercel + Supabase

This folder is the whole app, ready to deploy off the Claude platform so it can have a real public link + password, with real shared data behind it.

## What's in this folder

- `deal-desk.html` — the app itself. Now talks to Supabase (Postgres) instead of Claude's artifact capabilities, and both maps (the Dashboard's pipeline map and each deal's IC-memo location map) are now real, pannable/zoomable Leaflet + OpenStreetMap tile maps instead of a flat SVG diagram / Google iframe — see "What changed, honestly" below.
- `api/sample.js` — a small serverless function that proxies the app's AI features (OM extraction, deal screening, AI-drafted fields) to the Anthropic API. It holds your API key server-side so it's never exposed in the browser.
- `vercel.json` — tells Vercel to serve `deal-desk.html` at your site's root URL.
- `package.json` — minimal project metadata Vercel expects.
- `supabase.sql` — the one-time database setup script (see Step 2).

## Step 1 — Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (email + password works fine — no Google account required).
2. Click **New project**, give it a name (e.g. "deal-desk"), generate/save a database password (you won't need it day-to-day — the app never uses it directly), pick a region close to your team, and click **Create new project**. It takes a minute or two to provision.

## Step 2 — Set up the database

1. In the left sidebar, go to the **SQL Editor**, click **New query**.
2. Open `supabase.sql` (in this folder), copy its entire contents, paste into the editor, and click **Run**. This creates the one table the app uses, locks it down with security rules, adds a small helper function, and turns on realtime sync. You should see "Success. No rows returned."

## Step 3 — Turn on anonymous sign-ins

1. Go to **Authentication > Sign In / Providers** (sidebar).
2. Find **Anonymous Sign-Ins** and toggle it on, then save.
3. This lets the app quietly sign each visitor in behind the scenes — no accounts for your team to manage, and it's what makes Step 2's security rules apply to them. It does **not** replace the app's own password screen; see the comments at the top of `supabase.sql` for the honest tradeoffs. (Supabase's free tier allows up to 30 anonymous sign-ins per hour per IP address by default — plenty for a small internal team, but worth knowing if the app ever seems to be refusing to connect.)

## Step 4 — Get your API keys and fill them in

1. Go to **Project Settings > Data API** (sidebar, gear icon) — you'll see your **Project URL**. Then go to **Project Settings > API Keys** and copy the **anon public** key (not the "service_role" key — that one must never go in this file or anywhere client-side).
2. Open `deal-desk.html`, find the `supabaseConfig` object near the top of the `<script>` section (search for `YOUR_SUPABASE_URL`), and replace both placeholders with your real Project URL and anon key. (Or send them to me in chat and I'll fill them in for you — they're not secret, just identifiers; access is enforced by the security rules from Step 2, not by hiding this object.)

## Step 5 — Get an Anthropic API key (for the AI features)

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in or create an account, and add a small amount of billing credit (the AI screening/extraction features are pay-per-use — typically fractions of a cent per request, but it does require an active billing method, unlike using Claude directly in this chat).
2. Go to **Settings > API Keys**, create a new key, and copy it somewhere safe. You'll paste it into Vercel in Step 7 — never into the HTML file itself.

## Step 6 — Put this folder in a GitHub repo

The easiest way to deploy to Vercel is by connecting a GitHub repo (no command line needed):

1. Go to [github.com](https://github.com) and sign in or create a free account.
2. Click the **+** (top right) > **New repository**. Name it (e.g. `deal-desk`), keep it **Private**, and create it.
3. On the new repo's page, click **uploading an existing file**, then drag in every file from this folder (including the `api` folder — GitHub will preserve the subfolder) and commit.

## Step 7 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up — **"Continue with GitHub"** is simplest, since it'll let Vercel see your new repo directly.
2. Click **Add New... > Project**, find your `deal-desk` repo, and click **Import**. Leave all the build settings as their defaults (Vercel auto-detects a static site + serverless function) and click **Deploy**.
3. Once it finishes, go to the project's **Settings > Environment Variables**. Add:
   - `ANTHROPIC_API_KEY` = the key from Step 5
   - (optional) `ANTHROPIC_MODEL` if you ever want to pin a specific model version
4. Go to **Deployments**, open the latest one, and click **Redeploy** so it picks up the new environment variable.
5. Your app is now live at the `*.vercel.app` URL Vercel gives you (you can also add a custom domain later under **Settings > Domains**).

## Step 8 — Verify

Open the Vercel URL, enter the password (`newgarddealdesk`), and confirm:
- The connection dot at the top says **"Synced — shared with your team"** (not "Not connected").
- The 19 deals are there (the database gets seeded automatically the first time the app loads against an empty database).
- Try the AI deal screening (Screen tab) and confirm it returns a recommendation.
- On the Dashboard, confirm the pipeline map shows real streets/terrain (not a flat outline) and that clicking a bubble filters the pipeline.
- Open any deal's IC memo and confirm its location section shows a real map (may take a second to geocode the address) rather than a Google embed.
- Open the Tasks tab and confirm you see 5 columns, including **Process Improvements**.
- Open the same URL in a second browser (or incognito window) and confirm an edit in one shows up in the other after a moment.

## A free-tier quirk worth knowing

Supabase's free tier automatically pauses a project after **one week with no database activity** (it resumes on its own the next time someone opens the app — takes roughly 30 seconds, then works normally). Since this is an internal tool your team might not open every single day, don't be alarmed if it's a little slow to connect after a quiet stretch — that's just the project waking back up, not anything broken. If that ever becomes annoying, Supabase's paid tier ($25/mo) removes the auto-pause.

## Ongoing changes

Once this is live, any future change to `deal-desk.html` (or `api/sample.js`) just needs to be pushed to the GitHub repo — Vercel redeploys automatically within about a minute. Send me the file when you want something changed and I'll hand back an updated version to re-upload.

## What changed, honestly

- **Data**: now lives in Supabase (a hosted Postgres database), not Claude's artifact storage or Google/Firebase. Real-time sync across everyone with the link, same as before — pushed instantly rather than polling every few seconds.
- **AI features**: unchanged from your perspective, but now billed to your own Anthropic account per request instead of being included.
- **Password gate**: unchanged — still a client-side convenience, not real security. The Supabase security rules (Row Level Security) add a real backstop against random bots, but anyone who can read the deployed page's source could still technically sign in and hit the database directly. That's an acceptable tradeoff for an internal team tool behind a link you're not publishing widely; worth revisiting if that ever changes.
- **Maps**: both maps now use free OpenStreetMap tiles via Leaflet (no API key, no billing account) instead of a hand-drawn flat diagram and a Google Maps iframe — this only became possible once the app left Claude's sandbox, which couldn't reach a live tile or geocoding host. The Dashboard's pipeline map still uses the same built-in state/city coordinate lookups as before (nothing external to fail there). Each IC memo's location map now geocodes that deal's address on the fly via OpenStreetMap's free Nominatim service the first time you open that memo in a session — if geocoding fails (an incomplete or unusual address) it falls back to the same address-and-link you had before, so nothing is ever silently missing. Both maps stay hidden from printed/exported PDFs (same as before), showing the address and a "Open in Google Maps" link there instead — printing a live, tile-based map reliably is a rabbit hole better left alone for now.
- **Tasks board**: now has a 5th column, **Process Improvements**, alongside Doing / To Do / Backlog / Complete — for tracking process-improvement ideas separately from deal-specific work.
