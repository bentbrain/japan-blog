# jp.bent.build

Japan travel journal. Astro and emDash on Cloudflare Workers, with D1 records and R2 media.

Public journal, categorised gallery, geolocated media map and beer counter. The owner uses a TipTap rich text editor with shadcn/Base UI controls and emDash passkey login. Owner tools preserve original media, edit capture metadata and export Instagram stories as PNG or animated MP4.

The application uses Tailwind utilities and shadcn components on Base UI. Theme tokens and the official shadcn state utilities live in `src/styles/globals.css`.

## Development

Use Node 24 and pnpm 12.11.2.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm exec emdash secrets generate
pnpm dev
```

Save the generated encryption key in the ignored `.env`. EmDash applies the schema on the first request. Development-only setup is available at `/_emdash/api/setup/dev-bypass`; it never works in a production build. `pnpm demo` adds removable sample content to the local database only. No sample entries are bundled in the production seed.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm knip
pnpm build
```

## Owner tools

- `/owner`: posts and daily beer entries.
- `/owner/posts/new` and `/owner/posts/:id`: rich text, media selection, drafts and publishing.
- `/owner/media`: uploads, capture times, coordinates and multiple categories. Missing metadata keeps an upload unpublished.
- `/owner/export`: daily media selection, historical beer counts, safe-area preview and PNG/MP4 downloads.
- `/_emdash/admin`: native CMS maintenance, revisions and passkey management.

Capture times group into days in `Asia/Tokyo`. Photos without an offset are interpreted as Japan time. Originals remain in private R2 storage. Draft previews require owner access; published files check the live media record and disable caching so unpublication takes effect immediately. The image-transform endpoint is disabled because previews are already resized. The owner browser converts HEIC previews and short videos before upload and renders story exports with WebCodecs. MP4 rendering needs a current Safari or Chrome with AVC encoding support. Story exports are silent.

## Feedback toolbar

The shared layout accepts `PUBLIC_FEEDBACK_SERVER` and `PUBLIC_FEEDBACK_PROJECT_ID`. It loads the independent [feedback-toolbar](https://github.com/bentbrain/feedback-toolbar) script once, with no embedded credentials. Content and controls carry stable `data-feedback-id` attributes. Set these variables when the feedback service is deployed and its Japan project is registered.

## Deployment and repository controls

PRs run strict ESLint, formatting, TypeScript, unit and full-flow tests, Knip and a production build. Main requires all quality and security checks, an up-to-date branch and resolved review conversations. Independent T3 review precedes auto-merge; GitHub reviewer approvals are not required for this single-contributor repository. Secrets and local data are excluded from Git. Deployment configuration lives in `wrangler.jsonc`; application secrets belong in Cloudflare's encrypted secret storage.

The production account is the sole author. Public account creation and invitations are disabled. First-time passkey setup requires a short-lived private setup cookie. Generate a setup capability and keep it private; clear `SETUP_TOKEN` after registering the owner account.

## Design review and sample assets

`node mockups/server.mjs` serves the approved mockups at `http://127.0.0.1:4317`. Their publishing and export actions are simulations. Saved feedback and private tunnel credentials live in the ignored `review-data/` directory.

The interface follows shop.bent.build and stay.bent.build. The shirt mark belongs to the same owner. Sample photographs and provenance are listed in `mockups/assets/sources.json`; the sample video pans a sample photograph. The application map uses Natural Earth's public-domain 1:10m country geometry, with its pinned source recorded in `src/lib/japan.json`. Geist Mono uses the SIL Open Font License. Dependency licences remain with their packages.
