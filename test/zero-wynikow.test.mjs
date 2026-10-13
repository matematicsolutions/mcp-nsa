// Prawdziwe "zero wynikow" CBOSA vs obca strona HTTP 200 (ban, captcha, zmiana ukladu) - 2026-10-13.
//
// Zmierzone na zywo (POST /cbo/search, nonsensowna fraza): 200 + text/html, tekst
// "Nie znaleziono orzeczeń spełniających podany warunek!", zero linkow /doc/. Wynik dodatni ma
// "Znaleziono N orzeczeń". Do 2026-10-13 parser zwracal "Brak wynikow" dla KAZDEJ strony bez
// linkow /doc/ - takze dla strony bana albo captchy (awaria konczy sie sukcesem).
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
// Ksztalt zmierzony na zywo 2026-10-13 (fragment tresci; reszta strony to nawigacja).
const ZERO =
  "<html><head><title>Centralna Baza Orzeczeń Sądów Administracyjnych</title></head><body>" +
  "<p>Nie znaleziono orzeczeń spełniających podany warunek!</p>" +
  "<table><tr><td>Szukane słowa</td><td>qzxwvkjh</td></tr></table></body></html>";
const OBCA =
  "<html><head><title>Weryfikacja</title></head><body>Potwierdz, ze nie jestes robotem.</body></html>";

async function szukaj(status, body, args = { query: "qzxwvkjh" }) {
  const s = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "content-type": "text/html;charset=UTF-8" });
      res.end(body);
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    env: { ...process.env, CBOSA_BASE_URL: `http://127.0.0.1:${s.address().port}` },
    stderr: "ignore",
  });
  const c = new Client({ name: "zero-wynikow", version: "1" });
  await c.connect(t);
  try {
    return await c.callTool({ name: "search", arguments: args });
  } finally {
    await c.close();
    s.close();
  }
}

test("prawdziwe zero wynikow CBOSA -> zwykly pusty wynik, nie blad", async () => {
  const r = await szukaj(200, ZERO);
  assert.notEqual(r.isError, true, r.content?.[0]?.text);
});

test("obca strona 200 (captcha/ban) -> upstream_shape, NIE 'Brak wynikow'", async () => {
  const r = await szukaj(200, OBCA);
  assert.equal(r.isError, true, r.content?.[0]?.text);
  assert.equal(r.structuredContent?.error_code, "upstream_shape");
});

test("403 -> forbidden, nie 'sprobuj ponownie'", async () => {
  const r = await szukaj(403, "<html>Forbidden</html>");
  assert.equal(r.structuredContent?.error_code, "forbidden");
  assert.doesNotMatch(r.content[0].text, /Sprobuj ponownie/);
});

test("kontrola pozytywna: lista wynikow przechodzi", async () => {
  const r = await szukaj(200, LISTA);
  assert.notEqual(r.isError, true, r.content?.[0]?.text);
});
