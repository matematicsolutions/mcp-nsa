// E2E przez protokol MCP: zbudowany serwer (dist/) + lokalna atrapa CBOSA (CBOSA_BASE_URL).
//
// Atrapa podaje PRAWDZIWY ksztalt CBOSA: zrzuty HTML z test/fixtures (pobrane z zywego
// orzeczenia.nsa.gov.pl; ksztalt /doc/<id> potwierdzony sonda 2026-10-13), a nieistniejacy
// doc_id dostaje to, co CBOSA naprawde oddaje: 410 + krotki text/html (zmierzone 2026-10-13).
//
// Sprawdza to, co naprawde dostaje agent - nie funkcje w izolacji.
// Run: npm run test:e2e (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LISTA = readFileSync(join(ROOT, "test", "fixtures", "search-results.html"), "utf-8");
const DOKUMENT = readFileSync(join(ROOT, "test", "fixtures", "doc-8889489BE0.html"), "utf-8");
const BRAK_ID = "0000000000";

async function atrapa(obsluga) {
  const s = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const [status, body] = obsluga(req);
      res.writeHead(status, { "content-type": "text/html;charset=UTF-8" });
      res.end(body);
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${s.address().port}`, zamknij: () => s.close() };
}

// Zachowanie CBOSA: lista wynikow na POST /cbo/search i GET /cbo/find, dokument na /doc/<id>,
// nieistniejacy dokument -> 410 "Error 410: Zgloszono blad: 410".
const cbosa = (req) => {
  if (req.url.startsWith("/cbo/")) return [200, LISTA];
  if (req.url === `/doc/${BRAK_ID}`) return [410, "Error 410: Zgłoszono błąd: 410 "];
  if (req.url.startsWith("/doc/")) return [200, DOKUMENT];
  return [404, "nie ma"];
};

async function klient(base) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    env: { ...process.env, CBOSA_BASE_URL: base },
    stderr: "ignore",
  });
  const c = new Client({ name: "e2e-atrapa", version: "1.0" });
  await c.connect(transport);
  return c;
}

// Wzorzec soba-labs/krs-mcp #1 (`src/tools/common.ts:38-51`): blok provenance w KAZDYM udanym
// wyniku - zrodlo, czas pobrania, czas wytworzenia (jawne null zamiast zgadywania) i co zrobil
// konektor. Pod warunki ponownego wykorzystania informacji sektora publicznego.
const WYWOLANIA = {
  search: { query: "podatek" },
  get_judgment: { doc_id: "8889489BE0" },
  search_by_case: { caseNumber: "II FSK 2870/18" },
};

test("provenance w kazdym udanym wyniku - pelny mianownik narzedzi", async () => {
  const { base, zamknij } = await atrapa(cbosa);
  const c = await klient(base);
  try {
    const narzedzia = (await c.listTools()).tools.map((t) => t.name).sort();
    assert.ok(narzedzia.length > 0, "pusta lista narzedzi = BLOKADA");
    assert.deepEqual(narzedzia, Object.keys(WYWOLANIA).sort(), "kazde narzedzie musi miec wywolanie");
    for (const [name, args] of Object.entries(WYWOLANIA)) {
      const r = await c.callTool({ name, arguments: args });
      assert.notEqual(r.isError, true, `${name}: ${r.content?.[0]?.text}`);
      assert.ok(r.structuredContent?.citations?.length > 0, `${name}: brak citations - atrapa nie trafila`);
      const p = r.structuredContent?.provenance;
      assert.ok(p, `${name}: brak provenance`);
      assert.ok(p.source && String(p.source).includes(base), `${name}: source = ${p.source}`);
      assert.ok(!Number.isNaN(Date.parse(p.retrieved_at)), `${name}: retrieved_at = ${p.retrieved_at}`);
      assert.equal(p.source_produced_at, null, `${name}: source_produced_at ma byc jawnym null`);
      assert.ok(p.processing && p.processing.length > 10, `${name}: processing`);
    }
  } finally {
    await c.close();
    zamknij();
  }
});

test("nieistniejacy doc_id (CBOSA 410) -> not_found, nie 'sprobuj ponownie'", async () => {
  const { base, zamknij } = await atrapa(cbosa);
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "get_judgment", arguments: { doc_id: BRAK_ID } });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent?.error_code, "not_found", r.content?.[0]?.text);
  } finally {
    await c.close();
    zamknij();
  }
});

test("search, gdy strony orzeczen nie daja sie pobrac -> degraded + 'Wynik niepelny' na poczatku", async () => {
  // Do 2026-10-13 nieudane pobranie metadanych konczylo sie `catch {}` - citations kurczyly
  // sie po cichu, a agent nie wiedzial, ze wynik jest niepelny ani dlaczego.
  const { base, zamknij } = await atrapa((req) =>
    req.url.startsWith("/cbo/") ? [200, LISTA] : [503, "Service Unavailable"]
  );
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "search", arguments: { query: "podatek" } });
    assert.notEqual(r.isError, true);
    const sc = r.structuredContent;
    assert.equal(sc.status, "degraded");
    assert.deepEqual(sc.partial_result.coverage, { unit: "metadane_orzeczen", total: 5, usable: 0 });
    assert.match(sc.partial_result.dlaczego, /503/);
    assert.match(r.content[0].text, /^Wynik niepelny: /);
  } finally {
    await c.close();
    zamknij();
  }
});

test("kontrola pozytywna: search z udanym pobraniem -> status ok, bez dopisku", async () => {
  const { base, zamknij } = await atrapa(cbosa);
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "search", arguments: { query: "podatek" } });
    assert.equal(r.structuredContent.status, "ok");
    assert.equal(r.structuredContent.partial_result, null);
    assert.doesNotMatch(r.content[0].text, /^Wynik niepelny/);
  } finally {
    await c.close();
    zamknij();
  }
});

test("kontrola pozytywna: 500 CBOSA zostaje upstream_error, choc doc_id zawiera '404'", async () => {
  // Do 2026-10-13 klasyfikacja szla regexem /404|not found/ po komunikacie z URL-em -
  // doc_id z ciagiem "404" przy awarii 5xx wychodzil jako not_found ("nie ma takiego orzeczenia").
  const { base, zamknij } = await atrapa(() => [500, "Internal Server Error"]);
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "get_judgment", arguments: { doc_id: "8404ABCDEF" } });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent?.error_code, "upstream_error", r.content?.[0]?.text);
  } finally {
    await c.close();
    zamknij();
  }
});
