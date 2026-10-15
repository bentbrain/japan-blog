# jp.bent.build

Japan travel journal. Astro and emDash on Cloudflare Workers, with D1 records and R2 media.

Public journal, categorised gallery, geolocated media map and beer counter. The owner uses a TipTap rich text editor with shadcn/Base UI controls and emDash passkey login. Owner tools preserve original media, edit capture metadata and export Instagram stories as PNG or animated MP4.

The application uses Tailwind utilities and shadcn components on Base UI. Theme tokens and the official shadcn state utilities live in `src/styles/globals.css`.

Post media uses the shadcn carousel with Embla below 601px, with mouse dragging, touch swiping, keyboard arrows and navigation buttons. An attached shop design is its final slide. Wider layouts show the media grid followed by the design with a 16px gap. Video controls retain their native interaction.

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
- `/owner/posts/new` and `/owner/posts/:id`: rich text, media selection, optional shop design, drafts and publishing. Existing posts can be unpublished to an editable draft or moved to CMS trash after confirmation. Media and revision history stay in the CMS. Paste a public shop.bent.build product or featured link and choose black or white. The journal and post page show its flat t-shirt image and link to that product with the chosen colour.
- `/owner/media`: uploads, capture times, coordinates and multiple categories. Missing metadata keeps an upload unpublished.
- `/owner/export`: daily media selection, historical beer counts, safe-area preview and PNG/MP4 downloads.
- `/_emdash/admin`: native CMS maintenance, revisions and passkey management.

Native CMS media links under `/media_items/:slug` redirect to `/media/:slug`. Native previews require both a valid preview link and the signed-in owner session. Preview and native edit-mode pages use feedback redaction, disable indexing and prevent caching. Media publication validates the same fields as the public loader, including photo/video kind. The public map fits Japan and all published media locations so pins outside Japan remain reachable.

Capture times group into days in `Asia/Tokyo`. Photos without an offset are interpreted as Japan time. Originals remain in private R2 storage. Draft previews require owner access; published files check the live media record and disable caching so unpublication takes effect immediately. The image-transform endpoint is disabled because previews are already resized. The owner browser converts HEIC previews and short videos before upload and renders story exports with WebCodecs. MP4 rendering needs a current Safari or Chrome with AVC encoding support. Story exports are silent.

## Feedback toolbar

The shared layout loads the independent [feedback-toolbar](https://github.com/bentbrain/feedback-toolbar) once from https://toolbar.bent.build. Production CI supplies `PUBLIC_FEEDBACK_SERVER=https://toolbar.bent.build` and `PUBLIC_FEEDBACK_PROJECT_ID=prj_bc74b93bb6f44574`. Both values are public; incomplete or invalid configuration fails instead of loading an unintended script.

Toolbar sign-in uses its own GitHub account and Japan project membership. Blog owner login remains independent. Content and controls carry stable `data-feedback-id` attributes; the owner page body uses `data-feedback-redact` so controls remain selectable while unpublished drafts and metadata are excluded from captured text and accessible labels, including dialogs rendered outside the main content. The accompanying `data-feedback-private` marker on the main content keeps older embeds from capturing that content. Comments still require explicit submission.

The public `.feedback-toolbar.json` links local agent tools to this Japan project. Agent credentials stay in private user configuration outside the repository. An existing harness can use the connector's MCP tools to read threads and claim explicitly queued work; its schedule and execution permissions remain in that harness.

## Deployment and repository controls

PRs run strict ESLint, formatting, TypeScript, unit and full-flow tests, Knip and a production build. Main requires all nine quality and security checks, an up-to-date branch and resolved review conversations, with administrator enforcement. A separate T3 GPT-6.1 agent must review the exact PR head against the current main base before merge or auto-merge. Any head or base change requires another review. GitHub reviewer approvals are not required for this single-contributor repository. The complete authorization and review procedure lives in [AGENTS.md](AGENTS.md).

The `Independent review` commit status links the reviewed head SHA to independent review evidence. The owner may add that exact context to required branch-protection checks after the policy PR passes review. Preserve the existing nine contexts, strict checks, administrator enforcement and resolved-conversation requirement. Until that control change, agents must still enforce the documented review gate. Publish review status through the commit-status API; do not create an Actions job with the same name or treat a CI result as review evidence.

The review status is a PR merge gate. Squash merging creates a different main SHA; Quality runs again on main, and Deploy requires the latest run of each of the nine CI jobs to succeed for its checked-out SHA through `scripts/require-checks.mjs`. Leave that deployment list unchanged. Requiring the PR-head review status on the new squash SHA would block normal deployment, and copying success would falsely attest to a review of that SHA. Agents must use normal CI deployment and cannot push to main, bypass protection or deploy manually.

Secrets and local data are excluded from Git. Deployment configuration lives in `wrangler.jsonc`; application secrets belong in Cloudflare's encrypted secret storage.

The production account is the sole author. Public account creation and invitations are disabled. First-time passkey setup requires a short-lived private setup cookie. Generate a setup capability and keep it private; clear `SETUP_TOKEN` after registering the owner account.

Email-link sign-in uses EmDash's native Cloudflare email provider and the `EMAIL` sending binding. It sends from `login@auth.jp.bent.build`; Cloudflare Email Sending must be enabled for `auth.jp.bent.build` with its generated DKIM, SPF and return-path records. This sending subdomain is separate from the existing `bent.build` inbound mail forwarding. Passkeys remain available, and email links sign in only to an existing account. Open the emailed link in the browser session you want to authenticate.

## Design review and sample assets

`node mockups/server.mjs` serves the approved mockups at `http://127.0.0.1:4317`. Their publishing and export actions are simulations. Saved feedback and private tunnel credentials live in the ignored `review-data/` directory.

The separate `/post-design.html` review page uses sample travel content and an existing public shop design. Its controls change only the preview. The shop project remains independent; the blog uses its public flat-image endpoint.

For an existing database, add the optional field before deploying this feature: `pnpm exec emdash schema add-field posts shop_design --type json --label "shop design" --url <instance-url>`. New databases receive it from the seed. Schema changes and deployment require a separate approved rollout.

The interface follows shop.bent.build and stay.bent.build. The shirt mark belongs to the same owner. Sample photographs and provenance are listed in `mockups/assets/sources.json`; the sample video pans a sample photograph. The application map uses Natural Earth's public-domain 1:10m country geometry, with its pinned source recorded in `src/lib/japan.json`. Geist Mono uses the SIL Open Font License. Dependency licences remain with their packages.
