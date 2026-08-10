# Feather-Light

Feather-Light is a TypeScript service that builds a compact, provenance-preserving index of
the Westpole archive. Markdown remains authoritative and is always treated as read-only.

The current Phase 1 slice discovers Markdown safely, records a content-hashed manifest,
parses frontmatter and heading-bounded sections, extracts wikilinks, builds an FTS5 index,
and exposes bounded status and search operations.

## Setup

```bash
npm install
cp config.example.yaml config.yaml
npm run db:migrate
npm run ingest
npm test
```

## Container development

Copy `.env.container.example` to a private, ignored `.env`, set absolute token and archive paths,
then run `docker compose config` followed by `docker compose build`. The canonical archive is
mounted read-only and is excluded from the image build context. See
`docs/container-architecture.md` for the service and storage boundaries.

For this workstation, `config.yaml` points to the canonical local archive at
`/Users/captainivo/Documents/Mithra Library/The Westpole`. The file is ignored by Git so
machine-specific paths are not published.

## Commands

```bash
npm run cli -- status
npm run cli -- ingest --dry-run
npm run cli -- ingest
npm run cli -- archive audit
npm run cli -- archive audit --output /safe/path/story-archive-audit.json
npm run cli -- archive plan --limit 20 --output /safe/path/migration-batch.json
npm run cli -- archive review-template --plan /private/path/plan.json --output /private/path/review.json
npm run cli -- archive review-page --review /private/path/review.json --output /private/path/review.html
npm run cli -- archive simulate --plan /private/path/plan.json --review /private/path/review.json --output /private/path/result.json
npm run cli -- archive changeset --plan /private/path/plan.json --review /private/path/review.json --output /private/path/changeset.json
npm run cli -- archive render-preview --changeset /private/path/changeset.json --output /private/path/preview.json
npm run cli -- search "Aanu"
npm run cli -- search --limit 5 --dedupe title "Aanu-Kathara"
npm run cli -- show sec_ab11f1ed3840bfafc4b84c59
npm run cli -- get "Aanu-Kathara"
npm run cli -- facts "Aanu"
npm run cli -- duplicates --kind title
npm run cli -- duplicates --kind content
npm run cli -- entities build
npm run cli -- entities list --type Person
npm run cli -- entities duplicates
npm run cli -- knowledge build
npm run cli -- chronology build
npm run cli -- timeline
npm run cli -- timeline --anchor "Fourth Civilization"
npm run cli -- timeline --query "Manegira"
npm run cli -- timeline --query "Manegira" --all-sources
npm run cli -- periods
npm run dev
```

Run `npm run cli -- help` for the complete command summary. Add `--json` to `status`,
`search`, `show`, or `duplicates` when scripting.

Search deduplication is caller-controlled:

- `file` returns one best section from each source file and is the default;
- `title` collapses files with the same normalized title;
- `content` collapses byte-identical source files;
- `none` returns matching sections without collapsing them.

Duplicate source records are never deleted or merged automatically. The CLI reports them so
later entity resolution can preserve their separate provenance and select or review a preferred
record explicitly.

`archive audit` is the Phase 0.5 migration scanner. It reads every eligible Markdown file directly,
reports missing and invalid Story Archive metadata, proposes IDs for review, and calculates a
deterministic manifest hash. It never edits the vault or writes to the index database. Manifest
output is refused if its path is inside any configured archive root.

`archive plan` creates a bounded, deterministic review batch. Every proposed field is labelled
`mechanical`, `review`, or `manual`; legacy workflow and canon statuses are never silently treated
as equivalent. When Git history exists, the planner follows renames to the first-add commit and
records its author date and commit hash as reviewable creation evidence. The planner is also
read-only and applies the same outside-the-vault output rule.

Legacy notes with no trustworthy creation evidence use the explicit pair `created: unknown` and
`created_source: legacy-import`. This preserves uncertainty instead of substituting filesystem
timestamps or migration dates.

Migration reviews are separate overlays keyed by relative path, source hash, and field. Review or
manual proposals require an explicit `approve`, `replace`, or `reject` decision with reviewer and
timestamp provenance. The simulator applies mechanical proposals in memory, checks review and file
hashes for staleness, validates the prospective metadata contract, and reports ready, unresolved,
stale, or invalid outcomes. It never serializes or writes a canonical note.
Plan, review, and simulation files may remain in a private directory outside the repository; the
CLI refuses to place simulation output inside any configured archive root.
`review-template` accepts the envelope produced by `archive plan` and creates one pending entry for
each review or manual proposal. Complete an entry by changing its action and adding `reviewer` and
an offset-aware `decidedAt`; replacement decisions also require a `value`.
Each review records a SHA-256 hash of the fully validated plan. Simulation refuses the review if any
path, proposal, reason, source hash, or batch count changed after the template was generated.
`review-page` creates a self-contained offline worksheet with no external scripts, fonts, analytics,
or network access. It includes proposal metadata but never note bodies, and downloads the edited
review as JSON for subsequent simulation.
`changeset` is the final read-only gate before rendering patches. It succeeds only when every file
simulates as ready, records mechanical versus reviewed authority and review provenance for each
field, and hashes the complete result. It contains no note bodies and does not write Markdown.
`render-preview` validates the hashed change set, renders YAML only in memory, verifies the complete
Story Archive metadata contract, and emits target hashes plus frontmatter previews. Markdown bodies
are preserved byte-for-byte and excluded from the preview artifact. Source files remain unchanged.

The transactional apply engine exists as a library and is covered only with synthetic archives. It
requires an explicit write authorization containing the exact preview hash, rechecks every source,
body, and target hash, stages same-directory temporary files, and rolls installed files back if the
batch fails. It is intentionally not exposed by the CLI: configured archive roots remain
read-only, and enabling canonical writes is a separate post-review deployment decision.

A non-dry-run ingest automatically rebuilds the deterministic entity projection. `entities build`
is also available when testing classification rules without rescanning the archive.

`knowledge build` extracts concise definitions using this order: explicit `definition`
frontmatter, `Core Idea`, `Summary`, `Overview`, then a review-required first-paragraph
fallback. Wikilinks become only `source_links_to` relationships; their presence does not imply
stronger claims such as `caused`, `located_in`, or `created_by`. Ambiguous and unresolved links
remain queued rather than being guessed.

Bullets under an entity's `Known Facts` heading become separate assertions with source section,
line range, source hash, canon status, knowledge status, and confidence. A small allowlist of
unambiguous structured frontmatter fields can create `located_in`, `preceded_by`, `followed_by`,
or `associated_with` relationships. No relationship is strengthened from prose proximity.

Chronology is extracted from reviewed timeline tables. Event Sequence is displayed with a `~`
prefix because it is an editorial sort key, not a date. Old Clock years and observer-time values
remain unknown unless explicitly supplied. Timeline queries collapse the same event referenced by
multiple timeline sources by default; `--all-sources` exposes every occurrence and provenance.

The API binds to `127.0.0.1:8765` by default:

- `GET /health` reports process health only.
- `GET /v1/status` reports index freshness and record counts.
- `POST /v1/search` searches titles, headings, and section text with bounded results.

Except for `/health`, API routes require `Authorization: Bearer <token>` when
`server.authTokenFile` is configured. The VM installer creates the token with mode `0600`; Hermes
adapters read it from `~/.config/feather-light/api-token`. Do not place the token in command-line
arguments or logs. The current database schema is version 16 and verifies SHA-256 checksums for all
applied migrations.

Story Archive intake is available through two authenticated routes:

- `POST /v1/archive/validate` validates without storing the request;
- `POST /v1/archive/submissions` stores one pending transaction per submission ID and safely
  distinguishes identical retries from conflicting ID reuse.

Neither route writes canonical Markdown or creates a Git commit yet.

The prototype development ledger stores current note snapshots and append-only note events linked
to archive transactions. `GET /v1/archive/reports/development?from=<ISO>&to=<ISO>` returns objective
event, note, active-day, word-change, link-change, action, category, and subject metrics for a
half-open time range. The ledger contains development activity and provenance, not canonical lore.

Archive transactions follow a guarded `pending -> processing -> succeeded|failed|partial` lifecycle;
intake validation may also move `pending -> failed`. Authenticated list, detail, and transition
routes expose bounded procedural state without returning stored source bodies. Terminal records
retain completion time, summary, Git commit when present, and failure provenance.

## Safety guarantees

- Archive roots must be explicitly configured as read-only.
- Symlinks, special files, hidden application state, and unsupported files are skipped.
- Source files are opened only for reading.
- Missing or incomplete roots never trigger mass deletion.
- Indexed content is stored only under the local `state/` directory.
- Search results include stable source IDs, relative paths, headings, line ranges, and hashes.

## Entity boundary

The current index does not claim that every title is a resolved person, place, or thing. The
next deterministic entity pass will use explicit frontmatter, directory conventions, titles,
aliases, and wikilinks. Ambiguous prose extraction and duplicate resolution may use a local LLM
later, but model output will remain a provenance-bearing proposal rather than automatic canon.
