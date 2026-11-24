# Artifacts workspace redesign

Implement [the approved mockup, version 3](https://artifacts.m64.sh/r/UCRjtpCnQ2nLcEKh9dmyxg?v=3) with the existing Astryx components and Claude theme. Use real routes, artifact content, account data, and permissions. The two demo boards, sample accounts, screen selector, and simulated credentials do not belong in the product.

## Independent review units

1. **Workspace navigation:** replace the side rail with a slim responsive header. Keep Library, Settings, New artifact, account, theme and sign-out actions. Keep signed-out and restricted navigation appropriate to the session. Preserve the full-height reader and the narrow form layout.
2. **Library:** keep the newest-first collection and create/connect empty state. Add title/type search, shared and expiring-soon filters, an explicit no-match recovery action and a selected-artifact quick look on desktop. Use a seven-day expiry window. Link directly to the reader on phones. Load at most one preview, through the existing sandboxed render route.
3. **Reader:** expose the artifact title as an actions button with a chevron. Preserve copy, download, open in a new tab, rename, edit, Markdown/HTML/PDF export, retention and confirmed deletion. Keep the version selector. Show Preview, Source and artifact details. Use a separate Share dropdown for link access and export. Start new links with restricted access selected; a viewer must explicitly choose public access. Show existing link settings truthfully; keep input errors and stop-sharing confirmation in context. Preserve the selected version, section links, sandbox and shared-reader restrictions.
4. **Settings and access:** keep section links, reading choices and all four connection methods. Add a live reading sample. Preserve app/token creation, revocation and one-time token display. Keep both outcomes of a restricted share link and the authorization warning, destination, identity, permissions, approve and deny.

## Evidence

Test empty, matching and no-match collections, private/shared/permanent/expiring records, mixed mobile and desktop widths, long titles, missing or invalid restricted audiences and failed saves. Exercise the reader by keyboard and check focus after Escape. Verify authentication and retention use the existing server contracts. Use the real built client in a local browser with sample data, not the design artifact. Run the focused UI/permission suites, type check, lint, build and Astryx doctor. Get an independent review before handoff. No production rollout or data migration.