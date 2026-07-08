# mcp-nsa

## Installation (one command)

Published on npm + the MCP Registry (`io.github.matematicsolutions/mcp-nsa`). Run without cloning:

```bash
npx -y @matematicsolutions/mcp-nsa
```

MCP client configuration (stdio):

```json
{ "mcpServers": { "mcp-nsa": { "command": "npx", "args": ["-y", "@matematicsolutions/mcp-nsa"] } } }
```

(Building from source - below.)

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org)

MCP server for the case law of the Polish administrative courts -
Naczelny Sad Administracyjny / NSA (Supreme Administrative Court) + 16 Wojewodzkie Sady Administracyjne / WSA (regional administrative courts) - via **CBOSA** (Centralna Baza Orzeczen Sadow Administracyjnych - the administrative courts' central case-law database)
(`orzeczenia.nsa.gov.pl`).

## Why

SAOS (the common-courts case-law analysis system) **does not index the administrative courts**.
Yet that is exactly where the substantive case law lives:

- **GDPR / data protection** - decisions of the President of UODO appealed to the WSA, cassation appeals to the NSA
- **Taxes** - individual tax rulings, decisions of tax authorities
- **Customs and excise**
- **Administrative permits, concessions**
- **Review of public-administration activity**

`mcp-nsa` closes this gap. Coverage: **2,390,000+ rulings** (verified live 2026-07-08 across the full date range), from 1981 to today.

## Tools

- **`search(query, caseNumber?, court?, dateFrom?, dateTo?, pageNumber?)`**
  - search by keyword, case number, court, date. Fetches the top 5 full
  rulings (case number, court, date, panel, keywords, legal basis, excerpt).
- **`get_judgment(doc_id)`** - full ruling by 10-character hex doc_id
  (from the CBOSA URL, e.g. `7E50984BB7`).
- **`search_by_case(caseNumber)`** - shortcut: search by case number
  (e.g. `III OSK 1377/23`, `I SA/Gl 659/22`).

Every response contains `structuredContent.citations` with the fields:
`title`, `url` (CBOSA), `case_number`, `court`, `judgment_date`,
`decision_type`, `snippet`, `doc_id`. Patron reads this field automatically
and surfaces it in the UI panel as the section **"Rulings from CBOSA (NSA / WSA - administrative courts)"**.

## Stack

- Node 18+
- `@modelcontextprotocol/sdk`
- Stdio transport
- `https` + regex HTML parser (zero external deps beyond the SDK)
- 500 ms throttle between requests (2 req/s)
- SSL: `rejectUnauthorized: false` - the CBOSA chain is sometimes incomplete on some
  machines; public rulings, no PII, MITM risk negligible against the benefit.
  See: LDH issue #167.

## Build + run

```bash
npm install
npm run build
node dist/index.js   # starts the server on stdio
```

## Wiring into Patron

In `patron/backend/mcp-servers.json` (alongside `mcp-saos` and `mcp-eu-sparql`):

```json
{
  "name": "nsa",
  "transport": "stdio",
  "command": "node",
  "args": ["C:/Users/<YOUR-USERNAME>/mcp-nsa/dist/index.js"],
  "enabled": true
}
```

## Smoke test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"RODO art 6"}}}' \
  | node dist/index.js
```

Should return ~1500 hits + the top 5 with Polish NSA/WSA case numbers + CBOSA URLs
+ structuredContent.citations.

## Lineage

Implementation rewritten in TypeScript on the basis of the HTTP/HTML contract from
[`legal-data-hunter/sources/PL/NSA`](https://github.com/worldwidelaw/legal-sources)
(Python + BeautifulSoup, MIT). It does not import the source code - it reproduces the
query pattern and HTML parsing.

## License

MIT.

## Part of the MateMatic legal stack

This server is one of five MCP connectors covering Polish jurisdiction +
EU law, used by [Patron](https://github.com/matematicsolutions/patron)
(AGPL-3.0) and any other MCP-aware legal AI agent.

- **mcp-nsa** (this repo) - NSA + 16 WSA administrative courts (CBOSA)
- [mcp-saos](https://github.com/matematicsolutions/mcp-saos) - common courts, SN, TK, KIO
- [mcp-isap](https://github.com/matematicsolutions/mcp-isap) - Polish legislation (Dz.U. + M.P.)
- [mcp-krs](https://github.com/matematicsolutions/mcp-krs) - Polish company registry (KRS)
- [mcp-eu-sparql](https://github.com/matematicsolutions/mcp-eu-sparql) - EU law + CJEU (EUR-Lex)


All five MCP servers share the same `structuredContent.citations`
contract: each tool returns an array of `{title, url, snippet?, ...metadata}`
that legal agents can render directly in their citation panel.

See [matematicsolutions/.github](https://github.com/matematicsolutions)
for the full org profile.
