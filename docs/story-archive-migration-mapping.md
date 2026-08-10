# Story Archive legacy compatibility mappings

These mappings are proposals for Phase 0.5 review. They do not authorize vault writes.

Review decisions live in a separate versioned overlay. Each decision identifies the plan version,
archive root, relative path, source hash, and field, and records an action, reviewer, and timestamp.
This prevents an approval from silently carrying across a changed source file. Dry-run simulation
merges approved proposals only in memory and validates the prospective metadata; it performs no
Markdown serialization and no vault writes.

## Proposal levels

- `mechanical`: formatting or identity backfill that does not decide canon.
- `review`: a conservative mapping exists, but a person must approve it.
- `manual`: no defensible value is available from current metadata.

## Mechanical proposals

- Missing `id`: deterministic proposal from root identity, relative path, effective title, and type.
- Missing `title`: existing H1 or filename fallback.
- Missing `aliases`, `regions`, or `eras` with no legacy counterpart: empty arrays.
- Existing new-vocabulary canon statuses: preserved.
- Missing creation evidence: `created: unknown` with `created_source: legacy-import`; no date is
  invented.

## Review-required proposals

- Scalar `aliases` becomes a one-item array.
- Legacy `era` and `region` strings are split on `/` and slug-normalized.
- Recognized directories propose `type` and `primary_category` values.
- Missing `categories` begins with the proposed primary category.
- Legacy `canon` mappings:
  - `developing` -> `draft`;
  - `unconfirmed` -> `speculative`;
  - `conflicted` -> `contradicted`.
- Legacy workflow status `seed` proposes `speculative`, but remains review-required because workflow
  maturity is not canon status.

## Manual decisions

- `created` uses the earliest Git first-add author date when a repository history exists, follows
  renames, records the supporting commit hash, and remains review-required. Filesystem modification
  and creation times are never trusted historical facts.
- Git-backed dates remain review-required even when evidence exists.
- Legacy `live` and `open` workflow statuses do not map to canon status.
- Files outside recognized directory conventions need manual type/category classification.
- Non-text or structurally invalid legacy values are not guessed.

## First batch baseline

The first deterministic 20-file batch was generated outside the vault. With explicit unknown legacy
creation dates, 17 files are review-ready and 3 still require manual classification. Across the
batch, the planner produced 123 mechanical, 69 review-required, and 6 manual proposals. No files
changed.

The current workstation vault is not a Git repository, so all 20 first-batch creation dates use
explicit `unknown` legacy provenance. The Git resolver remains ready for the future containerized
canonical repository and is covered by a rename-history regression test.
