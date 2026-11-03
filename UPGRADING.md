# Upgrading

## 2026-11-03: Crawlable footer badges

Deploy the footer badge types, parser, validator, link renderer and admin UI together. Badge metadata (title, aria-label, data-\*), link text and rel qualifiers now survive saving and rendering. Existing image entries remain supported; no database migration is needed. Opus55video and Rumpelstiltskin now load badges during SSR; Rumpelstiltskin mounts them in its active footer. Re-paste original provider snippets where earlier submissions stripped verification attributes, then verify public HTML before resuming pending submissions.

### Concurrent saves and retry handling

Deploy the server handler, badge storage service, API and admin page together. Refresh any already-open admin tab after deploying. POST now accepts `action: add` with `badges`, `action: remove` with the full `badge`, or `action: replace` with both `badges` and `expectedBadges`. Old blind list replacement requests are rejected instead of erasing another writer's additions. Re-pasting the same href updates its official verification attributes without creating a duplicate. Conditional D1 writes retry merge conflicts and return 409 for stale removals/replacements. There is no schema or role change.

Run `pnpm test:footer-badges` and `pnpm test:footer-badges:d1` (isolated local D1 only) before deploying.
