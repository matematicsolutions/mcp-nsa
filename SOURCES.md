# Sources ledger - Poland / administrative courts (PL)

Machine-diffable record of every Legal Data Hunter (`worldwidelaw/legal-sources`) source we have
checked for this repo's scope, and what we did about it. Purpose: the next gap-audit
(eu-legal-mcp PLAYBOOK.md section 8) is a file diff against a fresh `manifest.yaml`, not a re-run
of hours of research.

Update this file every time a widen-round touches this repo. One row per LDH source `id`.

Machine-read by `eu-legal-mcp/gap_scan.py`.

| LDH id | LDH name | LDH status @ check | Our status | Our tool(s) | Notes / rejection reason |
|---|---|---|---|---|---|
| PL/NSA | Polish Supreme Administrative Court (CBOSA) | blocked | shipped | `search`, `get_judgment`, `search_by_case` | REVERSAL 2026-07-08: LDH says `blocked`, live probe says OPEN. POST `/cbo/search` (form fields `wszystkieSlowa`/`sygnatura`/`odDaty`/`doDaty`, selects take TEXT values e.g. `sad=dowolny`) returns results directly, cookieless; pagination GET `/cbo/find?p=N` with session cookies from the POST. Verified: 2 390 229 judgments total (full date range), exact sygnatura `II FSK 2870/18` -> 1 hit -> full text 64 KB. Prior block was a wrong-request-shape artifact (`sad=0` registers the query but always returns 0 hits). |
| PL/CBOSA | CBOSA portal (duplicate id of PL/NSA channel) | blocked | shipped | same as PL/NSA | `duplicate` of PL/NSA in LDH; same portal, same channel, covered by this repo. |
| PL/NSA-Tax | NSA tax subset via dane.gov.pl | complete | rejected | - | `duplicate` - tax judgments are a subset of CBOSA already served by `search` (symbols/keywords); a separate bulk-dataset client would add no lookup capability. |

The `LDH status @ check` column records what LDH said WHEN WE CHECKED. LDH flips statuses over
time; `gap_scan.py` flags rejected-by-us + complete-in-LDH pairs as STALE-REJ. Here the flip is
inverted: WE mark `shipped` while LDH still says `blocked` (probe URLs above, 2026-07-08).

## Status vocabulary

- `shipped` - live in this repo, has at least one MCP tool, tested and published.
- `rejected` - scouted, deliberately NOT built. `Notes` column MUST give a reason
  (`bot_protection`, `captcha_required`, `geo_restricted`, `duplicate`, `no_full_text_access`,
  `needs_separate_subscription`, `unreliable_exact_match`).
- `todo` - LDH has it as `complete`, we have not evaluated it yet.

## Not on this list

Anything NOT in this table has simply not been checked yet against this repo's LDH sources -
absence is not a claim of non-existence. Other Poland sources live in their own single-source
repos per fleet convention: `mcp-saos` (SAOS), `mcp-eureka` (KIS/MF tax interpretations),
`kio-orzeczenia-mcp` (KIO), `sejm-eli-mcp` / `mcp-isap` (legislation).
