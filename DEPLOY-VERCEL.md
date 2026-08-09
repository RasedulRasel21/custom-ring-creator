# Deploy to Vercel (serverless — no always-on server)

The backend runs as Vercel serverless functions. Sessions + pricing live in Supabase,
so nothing needs a persistent disk. `shopify app dev` is only for local development —
once this is deployed, the store works 24/7 without it.

## One-time setup

### 1. Supabase tables
**New project:** run `supabase/setup_all.sql` — it is schema + v2–v5 combined, in order.
Don't also run the individual files.

**Existing project** that predates a version, run only what's missing, in order:
- `supabase/schema.sql`
- `supabase/schema_v2.sql`
- `supabase/schema_v3.sql`
- `supabase/schema_v4.sql`   ← **required for Vercel** (creates `shopify_sessions`)
- `supabase/schema_v5.sql`   (creates `minted_products`)

### 2. Push to GitHub
```bash
git init && git add -A && git commit -m "Custom Ring Creator diamond selector"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```
(`.env`, `.env.example`, `node_modules`, `build` are gitignored — no secrets pushed.)

### 3. Import into Vercel
- Vercel → **Add New → Project → import the GitHub repo**.
- Framework Preset: **React Router** (auto-detected). Leave build/output as default —
  the `react-router.config.js` Vercel preset handles it. No `vercel.json` needed.
- Add **Environment Variables** (Production) — see `.env.example` for what each one is.
  Values come from `shopify app env show` (Shopify) and Project Settings → API (Supabase):
  ```
  SHOPIFY_API_KEY=<client_id — must match shopify.app.toml>
  SHOPIFY_API_SECRET=<your app client secret>
  SCOPES=<copy verbatim from `scopes` in shopify.app.toml>
  SHOPIFY_APP_URL=https://<your-project>.vercel.app
  SUPABASE_URL=https://<your-ref>.supabase.co
  SUPABASE_SECRET_KEY=<Supabase service_role key>
  ```
  `SCOPES` drifting from `shopify.app.toml` is the usual cause of an OAuth loop on install.
- **Deploy.**

### 4. Point the Shopify app at Vercel
Set your Vercel URL in `shopify.app.toml` in all three places — `application_url`,
`app_proxy.url` (keep the `/proxy` suffix), and the three `auth.redirect_urls`.
Then push it to Shopify:
```bash
shopify app deploy
```
This publishes the app config (app URL + `/apps/diamond` proxy → Vercel) **and** the theme
extension (the selector block).

### 5. Re-authorize on the store
Open the app once from the store admin and approve permissions (scopes changed).
If it doesn't prompt, uninstall + reopen the app to force a fresh grant.

## Verify it's fully live
- **Stop `shopify app dev`.**
- Open a ring product on the storefront and hard-refresh.
- The selector should load prices and add to cart — all served by Vercel now, no local
  process running. (Check the browser console `[crc-ds]` logs if anything is off.)

## Notes
- **Cold starts:** the first request after idle adds ~0.3–1s. Fine for one store.
- **Env changes:** update in Vercel → redeploy (or `vercel --prod`). Auto-deploys on every
  `git push` to `main`.
- **Custom domain:** if you later move off `*.vercel.app`, update `SHOPIFY_APP_URL`, the two
  URLs in `shopify.app.toml`, and re-run `shopify app deploy`.
