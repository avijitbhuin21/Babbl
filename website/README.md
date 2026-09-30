# Babbl website

Marketing site for Babbl. Separate from the desktop app: its own `package.json`, its own deploy.

## Local

```powershell
cd website
bun install
bun run dev
```

## Build

```powershell
bun run build   # -> dist/
bun run start   # serves dist/ on $PORT (default 3000)
```

## Railway

`railway.json` sets the root of this folder as a Nixpacks service: install, `vite build`, then `node server.mjs`. Set the service root directory to `website/` in the Railway dashboard. No environment variables are required.

## Content

Copy, features, FAQ, platforms and links live in `src/lib/site.ts`. The changelog page reads the public GitHub releases API at runtime, so nothing needs to be updated here when a release ships.
