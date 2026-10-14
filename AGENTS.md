# Japan blog

- Keep this project isolated from shop and stay. They are visual references only.
- The owner approved implementation on 2026-10-14. Build with emDash/Astro on Cloudflare Workers, D1 for records, R2 for media, and native emDash owner authentication. Preserve the approved mockups as design references.
- Integrate the owner's feedback-toolbar project once its package and embedding contract are ready. Inspect it read-only while it is being built; keep integration code here.
- Public content needs no login. Only the sole owner account may publish, edit, upload, change beer entries, or request exports. Enforce this on the server.
- Store GPS and capture time on every published media record. Extract originals before conversions; require manual coordinates if GPS is missing. Use Asia/Tokyo for daily grouping.
- Match the existing bent identity: Geist Mono, cobalt #0647ff on white and #2870ff on black, thin borders, square controls, lowercase interface copy and uppercase actions.
- Keep interface copy minimal. Let the travel content speak. Use small, original pixel icons for playful details.
- Keep sample content clearly identified in the review tools.
- Keep review feedback in ignored local storage and preserve it during edits.
- Never present simulated publishing, login, uploads, or exports as real operations.
