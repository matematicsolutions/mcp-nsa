# AGENTS.md - mcp-nsa

An [agents.md](https://agents.md) standard file (Linux Foundation / Agentic AI Foundation) - canonical instructions for AI agents working with this repository. Read natively by Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf, Aider, Amp, Factory, GitHub Copilot.

## Project goal

An **MCP (Model Context Protocol)** server for the **case law of the Polish administrative courts** - **Naczelny Sad Administracyjny / NSA (Supreme Administrative Court) + 16 Wojewodzkie Sady Administracyjne / WSA (regional administrative courts)** - via the **CBOSA** database (`orzeczenia.nsa.gov.pl`).

This is where Polish **GDPR / tax / administrative** case law lives - practically every ruling of interest to compliance and tax law firms.

One of MateMatic's 5 Polish-law connectors ([`mcp-saos`](https://github.com/matematicsolutions/mcp-saos), [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa) (this one), [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap), [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs), [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql)).

## MateMatic context (HARD CONSTRAINTS)

The repo is run by [MateMatic Solutions](https://matematicsolutions.com). The connector is **trust infrastructure**.

- **Every tool call MUST return `structuredContent.citations`** with: ruling title, canonical URL (CBOSA), court (NSA / WSA + location), date, case number.
- **Stateless** - no caching of queries with PII.
- **No text modification** - a faithful copy from CBOSA.
- **Rate limiting on the connector side** - CBOSA has no official API; we scrape carefully, with respect for the court's resources.

## MCP tools (tools contract)

| Tool | Key parameters | Returns |
|---|---|---|
| `search` | `query`, `court?` (NSA/WSA+city), `date_from?`, `date_to?` | list of rulings + citations |
| `get_judgment` | `judgment_id` | full ruling text + citations |
| `search_by_case` | `case_number` (case number) | all rulings for a given case number |

Full description: `src/index.ts` + `README.md`.

## Build and test

```bash
npm install        # Node 20+
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm run dev        # ts-node src/index.ts
```

Test via the MCP Inspector: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Code rules

- **TypeScript strict**.
- **`@modelcontextprotocol/sdk` ^1.12.0**.
- **Respect CBOSA `robots.txt`** and rate limits (User-Agent with contact, throttling).
- **No Polish characters in commit messages**.
- **CHANGELOG bump on contract change**.

## What NOT to do (hard rules)

- **DO NOT scrape aggressively** - the administrative courts are public infrastructure.
- **DO NOT add tools that send PII** outside CBOSA.
- **DO NOT modify ruling content**.
- **DO NOT cache queries with PII** in the connector.

## Sources of truth

1. [README.md](./README.md)
2. [CHANGELOG.md](./CHANGELOG.md)
3. `src/index.ts`
4. [CBOSA - case-law database](https://orzeczenia.nsa.gov.pl) - upstream

## Agent compatibility

The [AGENTS.md](https://agents.md) standard. For Claude Code there is additionally a [CLAUDE.md](./CLAUDE.md) file.

## License

**MIT** - see [LICENSE](./LICENSE).

Citation: *MateMatic Solutions (2026), mcp-nsa - MCP server for Polish NSA/WSA case law (CBOSA), https://github.com/matematicsolutions/mcp-nsa, MIT.*
