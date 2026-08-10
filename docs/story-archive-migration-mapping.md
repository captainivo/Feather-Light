# Story Archive legacy compatibility mappings

These mappings are proposals for Phase 0.5 review. They do not authorize vault writes.

## Proposal levels

- `mechanical`: formatting or identity backfill that does not decide canon.
- `review`: a conservative mapping exists, but a person must approve it.
- `manual`: no defensible value is available from current metadata.

## Mechanical proposals

- Missing `id`: deterministic proposal from root identity, relative path, effective title, and type.
- Missing `title`: existing H1 or filename fallback.
- Missing `aliases`, `regions`, or `eras` with no legacy counterpart: empty arrays.
- Existing new-vocabulary canon statuses: preserved.

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
- `created` remains unset when the archive has no Git repository or no first-add evidence.
- Legacy `live` and `open` workflow statuses do not map to canon status.
- Files outside recognized directory conventions need manual type/category classification.
- Non-text or structurally invalid legacy values are not guessed.

## First batch baseline

The first deterministic 20-file batch was generated outside the vault. All 20 currently require at
least one manual decision, primarily because `created` lacks trustworthy evidence. Across the batch,
the planner produced 83 mechanical, 69 review-required, and 26 manual proposals. No files changed.

The current workstation vault is not a Git repository, so all 20 first-batch creation dates remain
manual. The resolver is ready for the future containerized canonical repository and is covered by a
rename-history regression test.
