# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] - 2026-10-13

Aktualizacja zaleznosci (bezpieczenstwo). Bez zmian w kodzie serwera i w kontrakcie narzedzi.

### Security

- `npm audit`: 6 doradztw (1 krytyczne, 2 wysokie, 3 srednie) -> 0. Zadna paczka nie doszla ani nie zniknela (porownanie zbiorow z lockfile'a); `@modelcontextprotocol/sdk` -> 1.32.1 i jego zaleznosci transportow HTTP (hono, proxy-addr, qs, ip-address, fast-uri i inne).
- Ekspozycja przed poprawka (zderzone z kodem): serwer uzywa wylacznie `StdioServerTransport` - zaleznosci HTTP SDK nie sa ladowane; doradztwo SDK dotyczy KLIENTA OAuth. Realna ekspozycja bliska zera - aktualizacja, bo tania i bez zmiany wersji glownej SDK.
- Weryfikacja: build, wszystkie bramki offline, zywy smoke NIEMOZLIWY 13.10 (CBOSA blokuje nasze IP) - wydanie wstrzymane do przebiegu na zywym zrodle.

## [1.4.0] - 2026-10-13

Odpornosc na ciche awarie zrodla (wzorce z oceny soba-labs/krs-mcp i leniwyposel/sejm-mcp,
retrofit z mcp-saos, 2026-10-13). Wersja minor: kody bledow sa rozdzielone (konkretniejsze niz `upstream_error`), ale zaden znany konsument nie rozgalezia sie na nich - PATRON czyta tylko `isError`, prawo-pl-mcp opakowuje bledy konektora we wlasny `upstream_error` (sprawdzone 2026-10-13).
sa addytywne (nowe pola), ale nieistniejacy `doc_id` daje teraz `not_found` zamiast `upstream_error` -
klient branchujacy na kodzie zobaczy roznice. Opisy narzedzi (tools/list) bez zmian -
`tools.lock.json` przechodzi.

### Fixed

- **Nieistniejacy `doc_id`**: CBOSA odpowiada 410 (zmierzone na zywo), a klasyfikacja szla regexem `/404|not found/` po tresci komunikatu - 410 wychodzil jako `upstream_error` "sprobuj ponownie". Teraz `not_found`.
- **Ten sam regex** czytal komunikat z URL-em, wiec 5xx dla `doc_id` zawierajacego "404" (np. `8404ABCDEF`) wychodzil jako `not_found` - awaria zrodla udawala brak orzeczenia. Klasyfikacja idzie teraz po kodzie statusu (`CbosaHttpError.status`).
- **Obca strona 200 jako "Brak wynikow"**: kazda strona bez linkow `/doc/` (ban, captcha, zmiana ukladu) dawala "Brak wynikow w bazie CBOSA". Zmierzone na zywo: prawdziwe zero ma komunikat "Nie znaleziono orzeczeń spełniających podany warunek!". Teraz strona bez wynikow i bez tego komunikatu -> `upstream_shape` (nowy kod); zywe zero nadal daje uczciwy pusty wynik (sprawdzone przez MCP na zywym CBOSA).
- **401/403 CBOSA** wychodzil jako `upstream_error` "sprobuj ponownie" - teraz `forbidden` (nowy kod; przeglad czlowieka, bez obchodzenia zabezpieczen).
- **`search` / `search_by_case`**: nieudane pobranie strony orzeczenia konczylo sie pustym `catch {}` - citations kurczyly sie po cichu. Teraz `structuredContent.status` (`ok` / `degraded`), `partial_result` (mianownik `coverage`, `brakujace_doc_id`, dlaczego, jak uzupelnic), a odpowiedz ZACZYNA SIE od "Wynik niepelny: ...".

### Added

- Sonda zgodnosci `node test/sonda.mjs` (wzorzec soba-labs/krs-mcp #2): znany rekord CBOSA doc 8889489BE0 (II FSK 2870/18): `get_judgment` + `search_by_case`, przez protokol MCP do zbudowanego serwera; trojstan 0 OK / 10 UWAGI / 20 BLOKADA (`upstream_error` (5xx/timeout) = UWAGI; obca strona 200 i zniknicie rekordu = BLOKADA); pusta lista kontroli = BLOKADA. Workflow `sonda-zgodnosci.yml` codziennie (bez automatycznych issue). Testy na atrapie `test/sonda.test.mjs`; na zywo 13.10: OK 2/2.
- `structuredContent.provenance` w kazdym udanym wyniku: `source` (URL-e CBOSA), `retrieved_at`, `source_produced_at: null` (jawnie - CBOSA go nie podaje), `processing` (wzorzec soba-labs/krs-mcp, warunki ponownego wykorzystania ISP).
- `CBOSA_BASE_URL` (env) - testy E2E na lokalnej atrapie CBOSA przez protokol MCP (`test/e2e-atrapa.test.mjs`, `npm run test:e2e`); atrapa podaje zrzuty HTML z zywego CBOSA z `test/fixtures`. Test provenance z pelnym mianownikiem: `tools/list` == klucze wywolan, pusta lista = BLOKADA.
- Smoke: provenance dla kazdego narzedzia, zywy przypadek 410 -> `not_found`, pelny mianownik (kazde narzedzie z `tools/list` wywolane na zywo).
- Bramka paczki `npm run test:package` (`npm pack --dry-run --json`; wymagane pliki wyprowadzone z `bin`/`main` + przechodnich `require`/`import` w `dist/`, pusta lista = BLOKADA).
- `release.yml`: krok "Run gates before publishing" (drift, parse, e2e, descriptor lock, bramka paczki) - do tej pory wydanie szlo bez zadnego testu. `ci.yml`: e2e + bramka paczki.

## [1.3.0] - 2026-07-28

### Added

- **Argument type validation against the declared `inputSchema`.** The SDK's
  `setRequestHandler(CallToolRequestSchema, …)` validates only the request envelope, never
  the `arguments` payload, so `search` happily accepted `query` as a number or an array and
  forwarded the garbage to CBOSA. A gate now runs before dispatch and rejects type
  mismatches with the new `invalid_args` error code.
- New error code **`invalid_args`** (wrong argument *type*). A *missing* required argument
  still returns `missing_arg`, exactly as before — the two cases are deliberately kept
  apart so this change does not silently rename an existing error.
- `test/invalid-args.mjs` — generic conformance test. It reads `tools/list` from the built
  server over real MCP stdio and derives the cases from the declared schema, so a new tool is
  covered automatically. 13 checks: wrong type per property, missing required, plus a positive
  control proving well-typed calls still reach the upstream.
- Union types (`type: ["string","number"]`) are normalised, so such properties are validated
  instead of being silently skipped by the single-type switch.

### Notes

- Found by an external audit: `Ahmad-Faraj/mcp-conformance`, check `tools-call-invalid-args`.
- `enum` values are intentionally **not** enforced. Out-of-enum court names currently reach
  CBOSA and sometimes work; tightening that is a behaviour change wider than the defect
  being fixed, so it is left as a separate decision.
- Released as 1.3.0: `package.json`, `server.json` and the `serverInfo` literal in
  `src/index.ts` bumped together. `serverInfo` had drifted behind the published version in
  some connectors, so the handshake reported an older release than npm served.

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
