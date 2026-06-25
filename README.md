# mcp-nsa

## Instalacja (jedna komenda)

Opublikowany na npm + MCP Registry (`io.github.matematicsolutions/mcp-nsa`). Uruchomienie bez klonowania:

```bash
npx -y @matematicsolutions/mcp-nsa
```

Konfiguracja klienta MCP (stdio):

```json
{ "mcpServers": { "mcp-nsa": { "command": "npx", "args": ["-y", "@matematicsolutions/mcp-nsa"] } } }
```

(Budowanie ze źródeł — niżej.)

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org)

MCP server dla orzecznictwa polskich sądów administracyjnych
(NSA + 16 WSA) przez **CBOSA** — Centralną Bazę Orzeczeń Sądów Administracyjnych
(`orzeczenia.nsa.gov.pl`).

## Po co

SAOS (System Analizy Orzeczeń Sądowych) **nie indeksuje sądów administracyjnych**.
A to właśnie tam żyje merytoryczne orzecznictwo:

- **RODO / ochrona danych** — decyzje Prezesa UODO zaskarżane do WSA, kasacje do NSA
- **Podatki** — interpretacje indywidualne, decyzje organów podatkowych
- **Cła i akcyza**
- **Zezwolenia administracyjne, koncesje**
- **Kontrola działalności administracji publicznej**

`mcp-nsa` zamyka tę lukę. Pokrycie: **427 000+ orzeczeń**, od 2004 do dziś.

## Tooly

- **`search(query, caseNumber?, court?, dateFrom?, dateTo?, pageSize?, pageNumber?)`**
  — wyszukiwanie po słowach, sygnaturze, sądzie, dacie. Pobiera top-5 pełnych
  orzeczeń (sygnatura, sąd, data, skład, hasła, podst. prawna, fragment).
- **`get_judgment(doc_id)`** — pełne orzeczenie po 10-znakowym hex doc_id
  (z URL CBOSA, np. `7E50984BB7`).
- **`search_by_case(caseNumber)`** — skrót: szukaj po sygnaturze
  (np. `III OSK 1377/23`, `I SA/Gl 659/22`).

Każda zwrotka zawiera `structuredContent.citations` z polami:
`title`, `url` (CBOSA), `case_number`, `court`, `judgment_date`,
`decision_type`, `snippet`, `doc_id`. Patron czyta to pole automatycznie
i wystawia w panelu UI jako sekcję **"Orzeczenia z CBOSA (NSA / WSA — sądy administracyjne)"**.

## Stack

- Node 18+
- `@modelcontextprotocol/sdk`
- Stdio transport
- `https` + regex HTML parser (zero zewnętrznych dep poza SDK)
- Throttle 500 ms między żądaniami (2 req/s)
- SSL: `rejectUnauthorized: false` — chain CBOSA bywa niekompletny na niektórych
  maszynach; publiczne orzeczenia, bez PII, ryzyko MITM znikome wobec korzyści.
  Patrz: LDH issue #167.

## Build + uruchomienie

```bash
npm install
npm run build
node dist/index.js   # uruchomi serwer na stdio
```

## Wpięcie do Patrona

W `patron/backend/mcp-servers.json` (równolegle do `mcp-saos` i `mcp-eu-sparql`):

```json
{
  "name": "nsa",
  "transport": "stdio",
  "command": "node",
  "args": ["C:/Users/<TWOJ-UZYTKOWNIK>/mcp-nsa/dist/index.js"],
  "enabled": true
}
```

## Smoke test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"RODO art 6","pageSize":10}}}' \
  | node dist/index.js
```

Powinno zwrócić ~1500 trafień + top-5 z polskimi sygnaturami NSA/WSA + URL CBOSA
+ structuredContent.citations.

## Lineage

Implementacja przepisana do TypeScript na bazie kontraktu HTTP/HTML z
[`legal-data-hunter/sources/PL/NSA`](https://github.com/worldwidelaw/legal-sources)
(Python + BeautifulSoup, MIT). Nie importuje kodu źródłowego — odtwarza wzorzec
zapytań i parsowanie HTML.

## Licencja

MIT.

## Part of the MateMatic legal stack

This server is one of five MCP connectors covering Polish jurisdiction +
EU law, used by [Patron](https://github.com/matematicsolutions/patron)
(AGPL-3.0) and any other MCP-aware legal AI agent.

- **mcp-nsa** (this repo) — NSA + 16 WSA administrative courts (CBOSA)
- [mcp-saos](https://github.com/matematicsolutions/mcp-saos) — common courts, SN, TK, KIO
- [mcp-isap](https://github.com/matematicsolutions/mcp-isap) — Polish legislation (Dz.U. + M.P.)
- [mcp-krs](https://github.com/matematicsolutions/mcp-krs) — Polish company registry (KRS)
- [mcp-eu-sparql](https://github.com/matematicsolutions/mcp-eu-sparql) — EU law + CJEU (EUR-Lex)


All five MCP servers share the same `structuredContent.citations`
contract: each tool returns an array of `{title, url, snippet?, ...metadata}`
that legal agents can render directly in their citation panel.

See [matematicsolutions/.github](https://github.com/matematicsolutions)
for the full org profile.
