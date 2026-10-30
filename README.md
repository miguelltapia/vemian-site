# vemian.com

The Vemian website: homes for rent in Vancouver, with an online rental application. Plain HTML, CSS and JavaScript; Vercel serves it with clean URLs (`/apply` serves `apply.html`). There's no build step on Vercel.

This folder is made by `source/build.mjs` in the VEMIAN `Website` folder (last built 2026-10-29). To change the homes, edit `source/listings.mjs` there and run `node source/build.mjs`: this folder is refreshed and GitHub Desktop shows what changed. Don't edit the files here; the next build replaces them.

## First upload (GitHub Desktop)

1. GitHub Desktop → **File → Add local repository… → Choose…** → pick this folder (`Documents\VEMIAN\Website\vemian-site`) → **Add repository**.
2. It says the folder isn't a Git repository yet: click **create a repository**. Keep the name `vemian-site` (it must match the folder) and click **Create repository**.
3. Click **Publish repository**, keep **Keep this code private** ticked, and click **Publish repository**.
4. In Vercel: **Add New → Project → Import** `vemian-site`. Framework Preset: **Other**. Leave Build Command and Output Directory empty. Click **Deploy**.
5. Vercel → the project → **Settings → Domains**: add `www.vemian.com` and `vemian.com`, and set `vemian.com` to redirect to `www.vemian.com` with **308 Permanent**.

## After each change

Run the build, then in GitHub Desktop: write a short summary (for example "Rent update"), click **Commit to main**, then **Push origin**. Vercel publishes it in about a minute.

The GitHub website can only take 100 files per upload and this folder has 456, so use GitHub Desktop rather than the browser.
