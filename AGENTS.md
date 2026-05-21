# AGENTS.md - mcp-nsa

Plik standardu [agents.md](https://agents.md) (Linux Foundation / Agentic AI Foundation) - kanoniczne instrukcje dla agentow AI pracujacych z tym repozytorium. Czytany natywnie przez Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf, Aider, Amp, Factory, GitHub Copilot.

## Cel projektu

Serwer **MCP (Model Context Protocol)** dla **orzecznictwa polskich sadow administracyjnych** - **Naczelnego Sadu Administracyjnego (NSA) + 16 Wojewodzkich Sadow Administracyjnych (WSA)** - przez baze **CBOSA** (`orzeczenia.nsa.gov.pl`).

To miejsce gdzie zyje polskie orzecznictwo **RODO / podatkowe / administracyjne** - praktycznie wszystkie wyroki, ktore interesuja kancelarie compliance i podatkowe.

Jeden z 5 konektorow polskiego prawa MateMatic ([`mcp-saos`](https://github.com/matematicsolutions/mcp-saos), [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa) (ten), [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap), [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs), [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql)).

## Kontekst MateMatic (TWARDE OGRANICZENIA)

Repo prowadzi [MateMatic Solutions](https://matematicsolutions.com). Konektor jest **infrastruktura zaufania**.

- **Kazde wywolanie narzedzia MUSI zwracac `structuredContent.citations`** z: tytulem orzeczenia, URL kanonicznym (CBOSA), sadem (NSA / WSA + lokalizacja), data, sygnatura.
- **Stateless** - bez cache zapytan z PII.
- **Bez modyfikacji tekstu** - integralna kopia z CBOSA.
- **Rate limiting po stronie konektora** - CBOSA nie ma oficjalnego API, scrapujemy ostroznie z respektem dla zasobow sadu.

## Narzedzia MCP (tools contract)

| Tool | Parametry kluczowe | Zwraca |
|---|---|---|
| `search` | `query`, `court?` (NSA/WSA+miasto), `date_from?`, `date_to?` | lista orzeczen + citations |
| `get_judgment` | `judgment_id` | pelny tekst orzeczenia + citations |
| `search_by_case` | `case_number` (sygnatura) | wszystkie orzeczenia danej sygnatury |

Pelny opis: `src/index.ts` + `README.md`.

## Build i test

```bash
npm install        # Node 20+
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm run dev        # ts-node src/index.ts
```

Test przez Inspector MCP: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Zasady kodu

- **TypeScript strict**.
- **`@modelcontextprotocol/sdk` ^1.12.0**.
- **Respektuj `robots.txt` CBOSA** i rate limity (User-Agent z kontaktem, throttling).
- **Bez polskich znakow w commit messages**.
- **CHANGELOG bump przy zmianie kontraktu**.

## Czego NIE robic (twarde reguly)

- **NIE scrapuj agresywnie** - sady administracyjne to publiczna infrastruktura.
- **NIE dodawaj tools ktore wysylaja PII** poza CBOSA.
- **NIE modyfikuj tresci wyroku**.
- **NIE cachuj zapytan z PII** w konektorze.

## Zrodla prawdy

1. [README.md](./README.md)
2. [CHANGELOG.md](./CHANGELOG.md)
3. `src/index.ts`
4. [CBOSA - baza orzeczen](https://orzeczenia.nsa.gov.pl) - upstream

## Kompatybilnosc agentow

Standard [AGENTS.md](https://agents.md). Dla Claude Code dodatkowo plik [CLAUDE.md](./CLAUDE.md).

## Licencja

**MIT** - patrz [LICENSE](./LICENSE).

Cytowanie: *MateMatic Solutions (2026), mcp-nsa - MCP server dla polskiego orzecznictwa NSA/WSA (CBOSA), https://github.com/matematicsolutions/mcp-nsa, MIT.*
