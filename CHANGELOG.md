# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-07-08

Live re-audit of the CBOSA search backend (widen-round 2026-07-08). Two silent no-ops fixed,
pagination implemented for real. Verified against the live portal: 2 390 229 judgments total
(full date range query), exact-signature lookup confirmed (`II FSK 2870/18` -> 1 hit -> full text).

### Fixed

- **Date filters were a silent no-op**: the form fields are `odDaty`/`doDaty`, not
  `dataOd`/`dataDo`. Now `dateFrom`/`dateTo` actually narrow results
  (verified live: "RODO" 2 605 -> 451 for 2024).
- **Pagination was a silent no-op**: CBOSA ignores `wStr`. Real flow is POST `/cbo/search`
  (registers the query in a server-side session, returns page 1) then GET `/cbo/find?p=N`
  with the session cookies. `pageNumber` now works.
- Select fields take text values (`sad="dowolny"` or the full court name), not numeric
  indexes - a numeric value registers the query but always returns 0 hits.

### Changed

- Removed `pageSize` parameter from `search` - CBOSA renders a fixed 10 results per page;
  the parameter never had any effect upstream.
- Dropped unrecognized form fields (`organWyd`, `cenzura`, `akt`, `zak`, `prz`, `wPo`,
  `wStr`, `wWyn`, `wUkr`, `wZaa`, `wPrzS`) - none exist in the CBOSA form.

### Added

- Offline fixture test (`npm run test:parse`) for the judgment HTML parser.
- Live smoke test (`npm run smoke`): exact-signature lookup, date-narrowing assertion,
  full-text fetch.
- `SOURCES.md` - machine-diffable Legal Data Hunter ledger (PL/NSA + PL/CBOSA reversal:
  LDH says `blocked`, live probe 2026-07-08 says open).

## [1.1.0] — 2026-05-25

Retrofit do kanonu MCP MateMatic (pattern z dograh v1.31.0 BSD-2). Backward-compatible.

### Added

- `instructions` w Server (kolejnosc wywolan, rate limit CBOSA, kompetencja: tylko sady administracyjne, iteracja po bledach).
- `ToolAnnotations` per tool (`readOnlyHint`, `openWorldHint=true` bo CBOSA scraping live).
- Strukturalne `ErrorCode`: `missing_arg`, `not_found`, `upstream_error`. Format `[code] tekst` + `structuredContent.error_code`.
- Routing HTTP 404 -> `not_found` (lepsza wskazowka dla LLM).
- Drift test (`npm run drift`).

## [1.0.0] — 2026-05-20

Initial public release.

Polish administrative court rulings: NSA + 16 WSA, ~427k+ judgments (via CBOSA HTML scraping). Where Polish GDPR / tax / admin case law lives. 3 tools: search / get_judgment / search_by_case.

### Highlights

- Node 18+ stdio MCP server, single `dist/index.js` entry.
- LIVE smoke-tested on real data.
- `structuredContent.citations` consumed by [Patron](https://github.com/matematicsolutions/patron)
  and any other MCP-aware legal agent.
- MIT license, 500 ms request throttle, zero secrets required.

[1.0.0]: https://github.com/matematicsolutions/mcp-nsa/releases/tag/v1.0.0
