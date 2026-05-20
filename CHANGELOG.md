# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
