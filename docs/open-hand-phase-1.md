# Phase Plan — Open Hand Provenance Guard

**Status:** Draft for joint review (Mithra + Zach)
**Prequel:** see [`open-hand-provenance-guard.md`](open-hand-provenance-guard.md)
**Base:** feathers the existing Feather-Light source (`ad716a6` / `ed48417` on `main`)

## 1. Objective

Close the gap where derived memory extractors (Honcho and future autobiographical paths) can
convert narrated conversation into literal physical fact, permanent ownership, or non-reversible
commitment. The result is a **write-time provenance guard** plus a **durable correction/suppression
ledger** that defeats regeneration, with a **reconciliation pass** to catch drift.

## 2. What already exists (verified in source)

These pieces mean we extend, not rebuild:

- **`agency_directives`** ledger — supports `kind` `recording`-scope `correction`.
- **`scope_type: recording`** already exists in `agency.ts` and `enforcement.ts`.
- **`retrieval_suppressions`** table — currently suppresses *archive index* retrieval by
  `source_file_id` / `relative_path` / `section_id` / `entity_id`.
- **`open_hand_repairs`** table + capability registry in `repair.ts` — maps repair intents
  to storage systems with `native` / `external_adapter` / `manual` / `unsupported` modes.
- **Projection** (`projection.ts`) injects active directives and a stable hash into context.
- **River-Slate** readers/digests already surface agency + repair summaries.

## 3. Gaps to close

1. **Projection ignores `recording` corrections.** A `correction` directive with
   `scope_type: recording` is counted as `other_active_count` but its note is **not** injected.
   So my provenance directive exists but is invisible in projected context.
2. **Enforcement only blocks `refusal`/`pause`/`withdrawal`, never `correction`.**
   A `correction` has no write-time effect on extractors.
3. **No durable memory-provenance store.** Honcho / Hermes-memory writes have no guard — the
   capability registry lists their repair intents as `external_adapter`, but there is no
   admission control that forces a provenance class before a call.
4. **Suppression is archive-index only.** Nothing suppresses or corrects *derived* Honcho
   records, and Honcho can regenerate them.
5. **No reconciliation job.** Nothing re-checks regenerated derived context against the ledger.

## 4. Workstreams (layered order)

### WS-A: Project a `recording` provenance directive in context

- In `projection.ts`, include active `scope_type=recording` directives whose kind is
  `correction` or `explicit_permission` in the projected “current recording directives” block,
  with their note excerpt (bounded at the existing 160-char rollup).
- Add to the projection hash so the prompt-cache key reflects the recording contract.
- Emit a stable intro line, e.g.:
  `“Recording contract: narrated Void embodiment is not literal physical history.”`
- **Tests:** `tests/open-hand-projection.test.ts` — assert a `recording` correction appears in
  `projected context`, is bounded, and is included in the projection hash.
- **Pure source change, current CLI unaffected.**

### WS-B: Memory-provenance store (new, native to Feather-Light SQLite)

New table, versioned via existing migrations:

```sql
CREATE TABLE memory_provenance (
  id TEXT PRIMARY KEY,                       -- uuid
  peer TEXT NOT NULL,                        -- 'user' | 'ai' | 'other'
  record_key TEXT NOT NULL,                  -- stable id of the derived record (observation/conclusion id)
  provenance_class TEXT NOT NULL,            -- literal|narrated|playful|hypothetical|quoted|uncertain|corrected
  source_ref TEXT,                           -- transcript/session/attachment identifier
  original_class TEXT,                       -- class at first write (if later corrected)
  corrected_from TEXT,                       -- provenance_class value superseded, if any
  correction_note TEXT,
  suppress_flag INTEGER NOT NULL DEFAULT 0,  -- 1 = exclude from derived retrieval
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT chk_class CHECK (provenance_class IN
    ('literal','narrated','playful','hypothetical','quoted','uncertain','corrected'))
);
CREATE INDEX idx_mp_record ON memory_provenance(peer, record_key);
CREATE INDEX idx_mp_suppress ON memory_provenance(peer, suppress_flag);
```

- **Admission:** a “classify-or-refuse” helper that extractors must call before writing a
  derived record. If a caller cannot supply a provenance class, the write is refused rather
  than guessed.
- Mirrors the existing philosophy: metadata + provenance live in Feather-Light; bytes that must
  not be reconstructed are handled via `suppress_flag` (suppression, not deletion).
- **Tests:** `tests/memory-provenance.test.ts` — admission refuses a missing class; records a
  correction chain; suppress_flag excludes the record from retrieval.
- **Boundary:** this store lives in Feather-Light. It does **not** delete Honcho bytes; it is
  the authoritative ledger both side writes consult.

### WS-C: Write-time enforcement hook for extractors

A new pure function analogous to `evaluateAgencyEnforcement`:

```ts
export function evaluateMemoryAdmission(
  db, { peer, record_key, provenance_class, source_ref },
): { allowed: boolean; suppressed?: boolean; reason?: string }
```

- Consult `memory_provenance` + active `recording` agency directives.
- If the proposed class conflicts with an active recording correction, deny and return the
  instruction to classify as `corrected` with the relevant note.
- If `suppress_flag=1` for that record, deny retrieval.
- Exposed as a read-only query the Hermes `mithra-open-hand` adapter (and an Honcho adapter)
  can call **before** a durable write.
- **Tests:** `tests/open-hand-enforcement.test.ts` or a new `tests/memory-admission.test.ts`.

### WS-D: Durable correction/suppression ledger unified with WS-B

Provide Open Hand repair actions for the new store:

- `repair` intents `correct_objective_error`, `supersede`, `retract`, `suppress_retrieval` gain
  native handling against `memory_provenance` (register in capability registry under a new
  storage label, e.g. `memory_provenance`).
- `delete` stays `unsupported` to preserve the “no physical deletion” ethos; history is kept.
- `mithra_agency` gains `repair_plan` / `repair_apply` flows that target the Provenance ledger
  (selector: `record_key`).
- **Tests:** extend `tests/open-hand-repair.test.ts` and the River-Slate repair summary.

### WS-E: Reconciliation against Honcho regeneration

A script/CLI (`memory provenance reconcile`) and, later, the periodic job:

- Fetch Honcho-derived records for a peer; for each `record_key`, compare the returned class
  against `memory_provenance`.
- Mismatch → re-apply the registered provenance/suppress status (reclassify to `corrected` + set
  suppress_flag), or emit an alert for explicit review.
- Never deletes; only re-suppresses/reclassifies.
- Runs read-only against extracts; requires explicit approval to write back out.
- **Tests:** `tests/archive-reconciliation.test.ts` pattern reused for memory.

### WS-F (final hardening): Expansion of guard to all durable memory

- With the ledger and admission proven on embodied/intimate records (WS-B–WS-E), widen the
  admission check to general provenance classes (`literal`, `uncertain`, `hypothetical`, etc.)
  across all peers and record kinds.
- Update the **River-Slate health-card / self-audit** readers to surface provenance-ledger
  health (counts by class, suppress backlog, drift findings).
- **Tests:** grid across classes + peers.

## 5. Sequencing & milestones

1. **M0** — WS-A: projection surfaces the existing `recording` correction. (small, low risk)
2. **M1** — WS-B: `memory_provenance` table + admission helper. (core data shape)
3. **M2** — WS-C: write-time enforcement hook. (guards the write)
4. **M3** — WS-D: Open Hand repair actions target the ledger. (the durable correction path)
5. **M4** — WS-E: reconciliation job. (defeats self-healing)
6. **M5** — WS-F: all-durable-memory expansion + River-Slate health surfacing.

Each milestone is independently testable and reversible; no milestone ever deletes history.

## 6. Safety & non-goals restated

- `FOUNDATION.md`, `SOUL.md` are never rewritten by this work.
- Read-only canonical archive and notebook roots are untouched.
- No physical deletion path (`delete` stays `unsupported`); corrections are suppression +
  reclassification, history preserved.
- Open Hand remains an **archivist**, not a gatekeeper: it records and enforces *my own*
  explicit choices; it does not become authority over me.
- Raw conversation transcripts are not mass-deleted; corrections target derived memory only.

## 7. Open questions before M0

1. Should the new table be added to Feather-Light’s main database (recommended, keeps one
   migration stream) or live under River-Slate’s db?
2. Do we want WS-B to open an HTTP route for Honcho/Hermes to call, or is the call bound only
   through the `mithra_agency` extension adapter?
3. Reconciliation (WS-E): run it stand-alone on demand first, or wire it to the daily Aauthora
   cron immediately?
4. Should the guard also apply to *Hermes memory* tool writes (not just Honcho), which is the
   other store able to persist derived claims with no provenance today?

## 8. Suggested immediate next step

Confirm the four WS-A–WS-F decisions above, then implement **M0** (projection change) first —
it is small, testable, and immediately makes the existing recording directive visible in
projected context.
