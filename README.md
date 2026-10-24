# Silent Horizon Info Tech

A premium, fully static marketing site with a real-time WebGL black hole, glassmorphism
UI, and a lead-capture form that writes straight into Google Sheets.

**No framework, no build step, no dependencies.** Three files and a `fetch()` call.
Total gzipped payload: **~28 KB** for HTML + CSS + JS combined (Three.js alone would be ~150 KB).

| File | What it is | Ship it? |
| --- | --- | --- |
| `index.html` | Structure, meta/SEO, JSON-LD, inline SVG logo & favicon | ✅ |
| `style.css` | Design system, glassmorphism, motion, mobile-first layout | ✅ |
| `script.js` | WebGL universe, UI interactions, form → Google Sheets | ✅ |
| `Code.gs` | Google Apps Script for the sheet (lives in Apps Script, **not** on the site) | paste into Google |
| `_headers` | Cloudflare Pages security + caching headers | ✅ |
| `og-image.jpg` | 1200×630 social-share card (already generated from the real site) | ✅ |
| `robots.txt` | Search-engine directives | ✅ |
| `README.md` | This guide | optional |

---

## Preview locally (30 seconds)

No server config needed, but *do* use a server rather than double-clicking
`index.html` — the fonts and `fetch()` behave properly over `http://`.

```bash
cd silent-horizon
python3 -m http.server 8080
# open http://localhost:8080
```

Or with Node: `npx serve .`

Until you paste your Apps Script URL (below), the form runs in **preview mode**:
it validates, shows the success state, and logs nothing. You can design and
demo the whole site before touching Google.

---

# PART 3 — Implementation guide

## Step 1 · Wire the form to Google Sheets

### 1.1 Create the spreadsheet

1. Go to <https://sheets.new> and sign in with the Google account that should own the leads.
2. Rename it something like **Silent Horizon — Leads** (the tab name doesn't matter; the script writes to the first tab).

You do **not** need to create any headers — the script writes them on first use.

### 1.2 Open the Apps Script editor

1. In that spreadsheet: **Extensions → Apps Script**.
2. Delete whatever is in the editor (`function myFunction() {}`).
3. Open `Code.gs` from this project, copy **all** of it, and paste it in.
4. **Ctrl/Cmd + S** to save. Name the project “Silent Horizon Lead Capture”.
5. *(Optional)* On line 23, set `var NOTIFY_EMAIL = 'you@yourdomain.com';` to get an email per lead as well.

### 1.3 Prove it works before deploying

1. In the Apps Script toolbar, pick the function **`testWrite`** from the dropdown → **Run**.
2. Google will ask for authorisation the first time:
   **Review permissions → choose your account → Advanced → “Go to Silent Horizon Lead Capture (unsafe)” → Allow.**
   *(“Unsafe” is just Google's wording for any personal script you authorise.)*
3. Look at your spreadsheet: one row should have appeared, with the header row above it.
4. Delete that test row.

### 1.4 Deploy as a Web App

1. **Deploy → New deployment**.
2. Click the gear ⚙ next to “Select type” → **Web app**.
3. Fill in:
   - **Description:** `v1`
   - **Execute as:** **Me** *(required — the script must write as you)*
   - **Who has access:** **Anyone** *(required — “Anyone with Google account” will block anonymous visitors)*
4. **Deploy**, then **copy the Web app URL**. It ends in `/exec`:
   ```
   https://script.google.com/macros/s/AKfycb....................../exec
   ```
   > If you ever see a URL ending in `/dev`, that's the testing URL — it only works while you're
   > signed in. Use the `/exec` one from the deployment dialog.

### 1.5 Paste the URL into the site

Open `script.js`. **Line 26** is:

```js
WEBHOOK_URL: 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE',
```

Replace it with your `/exec` URL, keeping the quotes:

```js
WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
```

Save, reload the site, submit the form, check the sheet. **Done — real leads now land in the sheet.**

### 1.6 What each row contains

| Column | Example | Notes |
| --- | --- | --- |
| Timestamp | `2026-10-24 12:03:00` | Server time, formatted for you |
| Company Name | `Nova Robotics` | required |
| Phone Number | `+91 44 4000 1234` | required, stored as plain text so leading `+` / `0` survive |
| Project Idea | `Headless site + WebGL explorer` | optional, capped at 1,000 chars |
| Reference | `4494c100-9418-47a0-…` | submission ID — used to block duplicates |
| Source | `silenthorizon.in` | hidden field, handy if you reuse the form elsewhere |
| Page | `https://silenthorizon.in/#contact` | where they submitted from |
| Time Zone | `Asia/Kolkata` | visitor's zone, from the browser |
| Submitted At (ISO) | `2026-10-24T12:03:00.074Z` | exact client timestamp |
| User Agent | `Mozilla/5.0 …` | useful for debugging |

**Why the Reference column exists.** Apps Script replies through a redirect to
`script.googleusercontent.com`, and that final response doesn't always include a CORS
header. A browser therefore can't always *read* the JSON reply — even though the row was
written perfectly. So `script.js` tries a normal request first; if the reply is unreadable
it retries once as an opaque request. Both attempts carry the same `ref`, and `Code.gs`
ignores the second one. Result: **you never lose a lead, and you never get two rows.**

> Re-deploying after edits? **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**
> Editing the script alone does *not* update the live `/exec` URL.

## Step 2 · Deploy to Cloudflare Pages

### Option A — direct upload (fastest, no Git needed)

1. Log in at <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages → Upload assets**.
2. Project name: `silent-horizon` → **Create project**.
3. Drag the **contents** of the `silent-horizon` folder into the upload box — i.e. `index.html`, `style.css`, `script.js`, `_headers`, `og-image.jpg`, `robots.txt`.
   Do **not** upload `Code.gs` or `README.md` (they aren't part of the site).
4. **Deploy site.** You get `https://silent-horizon.pages.dev` in about 20 seconds.
5. Every later update: **Create new deployment → Upload assets** with the same files.

### Option B — GitHub (recommended: auto-deploy on every push)

1. Create a repository, e.g. `silent-horizon`, and push the site files to the root:
   ```bash
   cd silent-horizon
   git init
   git add index.html style.css script.js _headers og-image.jpg robots.txt README.md
   git commit -m "Silent Horizon — initial site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/silent-horizon.git
   git push -u origin main
   ```
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Settings:
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** *leave empty*
   - **Build output directory:** `/` *(or leave empty)*
4. **Save and Deploy.** Every `git push` to `main` now redeploys automatically; pull requests get their own preview URLs.

### Step 3 · Add your domain (5 minutes)

1. Pages project → **Custom domains → Set up a custom domain** → `silenthorizon.in`.
2. If the domain is already on Cloudflare, DNS is added for you; otherwise point the nameservers at Cloudflare (or add the `CNAME` they show you).
3. Turn on **SSL/TLS → Edge Certificates → Always Use HTTPS**. The `_headers` file already sends HSTS.
4. Update the placeholder domain in three places so sharing/SEO is correct:
   - `index.html` → `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`
   - `robots.txt` → the `Sitemap:` line
   - the JSON-LD block at the bottom of `<head>` (`"url"`)

### Step 4 · Turn on Cloudflare niceties (optional, 2 minutes)

- **Speed → Optimization → Brotli:** on (automatic on Pages).
- **Caching → Tiered Cache:** on.
- **Web Analytics** (free, cookieless): Pages project → **Metrics** → enable. No cookie banner needed.
- **Scrape Shield → Email Address Obfuscation:** off — you want `hello@silenthorizon.in` readable.

---

## Customisation

Everything worth changing lives in one of three places.

**1. The webhook and fallback email** — `script.js`, `CONFIG` (top of file, line ~20):

```js
const CONFIG = {
  WEBHOOK_URL: '…',                 // your Apps Script /exec URL
  SUBMIT_TIMEOUT: 12000,            // ms before we stop waiting
  FALLBACK_EMAIL: 'hello@silenthorizon.in'  // shown if the network dies
};
```

**2. Colours, type, spacing** — `style.css`, the `:root` block (line ~10).
Change `--cyan`, `--violet`, `--magenta` and the whole site re-skins instantly,
including the 3D scene's colour ramp (which reads the same three hues from
`script.js`, `buildGalaxy()`).

**3. The 3D scene** — `script.js`:

| Constant | Where | Effect |
| --- | --- | --- |
| `COUNTS.galaxy` / `COUNTS.stars` | `createUniverse()` | particle density (lower = faster) |
| `cam.dist` | camera block | how far the camera sits from the hole |
| `proj[8]` / `proj[9]` | per-frame | where the hole sits on screen (desktop / portrait) |
| `radiusPx` | per-frame | on-screen size of the event horizon |
| `ARMS = 3` | `buildGalaxy()` | number of spiral arms |
| `u_lens` | draw call | how hard light bends near the singularity |

**Copy** is plain HTML in `index.html` — the sections are commented
(`HERO`, `ABOUT`, `EXPERTISE`, `PROCESS`, `CONTACT`).

### Deliberate constraint: no pricing anywhere

The site mentions no prices, packages, tiers or currency — and there is nothing to
edit *out*. If you add sections later, keep the same rule: the only call to action is
**Enter the Horizon**, and the only conversion is the form. (Search-engine snippet,
social card and form microcopy all follow it too.)

---

## How the background actually works

Three draw passes into one fixed, full-screen canvas — no library:

1. **Galaxy** — ~5,400 points generated once as `(radius, angle, height)`. The *vertex shader* rotates each point using `ω = 0.075 · (1 + 0.65/r²)` — inner orbits move faster, exactly like real galactic rotation — so the disc swirls forever without the CPU touching a single particle.
2. **Starfield** — ~1,700 points on a sphere at radius 14–42, each with a random phase so the twinkle is asynchronous.
3. **Black hole** — one triangle covering the screen, entirely procedural in the fragment shader: an opaque event horizon, a razor-thin photon ring, and an accretion disc made of 4-octave `fbm` noise twisted by an angle that depends on radius (that twist is what makes it *swirl* rather than slide).

Points near the singularity are pushed **outward** in the vertex shader
(`ndc += normalize(d) * u_lens/d²`), which is the cheap version of gravitational
lensing — the galaxy visibly smears into a halo as it passes behind the hole.

Performance and care:

- **Adaptive resolution.** If the first 90 frames average worse than ~41 fps, the render target silently drops to 75 % scale. Nobody sees a stutter.
- **DPR capped** at 2 (1.6 on phones); mobile gets fewer particles automatically.
- **Pauses** when the tab is hidden; rebuilds after a context loss.
- **Falls back** to a pure-CSS nebula (`.no-webgl`) if WebGL is unavailable — the page never looks broken.
- **Respects `prefers-reduced-motion`**: one static frame instead of an animation loop, no parallax, no reveals, orrery frozen.
- **Never traps the visitor**: the boot overlay lifts on `load`, on a 3.5 s timeout, and on a 6 s pure-CSS failsafe — so even a total JS failure can't leave a black screen.

Everything is plain HTML/CSS/JS, so **Cloudflare Pages serves it as static files**; there is no server, no function, no runtime.

## Accessibility & QA notes

- Skip link, semantic landmarks, one `<h1>`, ordered heading levels.
- Real `<label>`s tied to inputs; errors announced via `role="status"` + `aria-live`, and `aria-invalid` on the affected field.
- Phone validation accepts `+91 44 4000 1234`, `(044) 1234-5678`, `9876543210`; rejects letters and short numbers.
- Visible focus rings (`:focus-visible`) that survive the glassmorphism.
- Honeypot field (`website_url`) + server-side duplicate guard = bot spam mostly gone without a CAPTCHA.
- Tested at 390 px, 768 px, 1024 px, 1440 px, and at 2× DPR. Zero horizontal overflow.
- No cookies, no analytics by default, no third-party JS.

## Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| “Signal received (preview mode)” | `WEBHOOK_URL` still holds the placeholder. Do Step 1.5. |
| Form says success, but nothing in the sheet | **Execute as** wasn't **Me**, or **Who has access** wasn't **Anyone** — redeploy with both set (Step 1.4). |
| Sheet works but the browser console shows a CORS error | Expected and harmless: that's the opaque retry. The lead is already in the sheet. |
| Edited `Code.gs`, nothing changed | You must **Deploy → Manage deployments → New version**. Saving isn't deploying. |
| Two identical rows | Very old deployment of `Code.gs` (before `ref` de-duplication). Paste the current `Code.gs` and deploy a new version. |
| 3D is missing / black | WebGL is blocked (old GPU, hardened browser, or battery saver). The CSS nebula fallback appears — that's normal and intended. |
| Form shows an email fallback message | The network blocked the POST entirely (offline, aggressive firewall). The visitor's data is *not* silently lost — they get your email address. |
| Fonts look like Segoe/Arial | Google Fonts was blocked or offline. Everything still works; fonts are the only external asset. |
| Page feels slow on a very old phone | The 3D drops its resolution automatically, but you can hard-cap it: lower `COUNTS.galaxy`/`COUNTS.stars` in `script.js`. |

## Go-live checklist

- [ ] `Code.gs` pasted, `testWrite()` produced a row, test row deleted
- [ ] Web app deployed: Execute as **Me**, access **Anyone**, `/exec` URL copied
- [ ] URL pasted at `script.js` line 26
- [ ] Real submission from a phone (mobile data, not Wi-Fi) landed in the sheet
- [ ] Files uploaded to Cloudflare Pages; `_headers`, `og-image.jpg`, `robots.txt` included
- [ ] Custom domain + Always Use HTTPS on
- [ ] Canonical / `og:url` / `og:image` / JSON-LD updated to the real domain
- [ ] `hello@silenthorizon.in` (or your real address) updated in `index.html` and `script.js`
- [ ] Social card checked: <https://www.opengraph.xyz> or paste the link into WhatsApp/LinkedIn
- [ ] `NOTIFY_EMAIL` set if you want email alerts per lead
