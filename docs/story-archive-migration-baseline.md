# Story Archive migration baseline

Phase 0.5 read-only audit run against `westpole-canonical`:

- eligible Markdown files: 394;
- files opened successfully: 394;
- fully compliant files: 0;
- files requiring migration metadata: 394;
- read/parse errors: 0;
- manifest hash: `31dbeebda5b72271c65702415dc4af3f3f92baa15413cf3f7f06f25f6756225f`.

The detailed manifest was deliberately generated outside the repository and canonical vault. It
contains one entry per note and should be treated as a review artifact, not canon.

## Missing required fields

| Field | Files missing it |
|---|---:|
| `id` | 394 |
| `title` | 393 |
| `primary_category` | 394 |
| `categories` | 394 |
| `regions` | 394 |
| `eras` | 394 |
| `created` | 394 |
| `aliases` | 359 |
| `status` | 236 |
| `type` | 236 |

Existing metadata is not discarded. The most common legacy fields include `status`, `type`,
`canon`, `tags`, `era`, `people`, `aliases`, `origin`, `world`, and `civilization`. The staged
migration must define explicit compatibility mappings for these fields before writing any batch.

## Invalid existing values

- `status`: 54 files;
- `aliases`: 3 files;
- `type`: 1 file.

This baseline authorizes no writes. The next Phase 0.5 slice is a compatibility-mapping proposal
and bounded batch planner, followed by human review.
