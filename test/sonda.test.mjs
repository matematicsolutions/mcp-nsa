// Sonda zgodnosci z CBOSA: trojstan + `actionable`, na lokalnej atrapie (zero sieci).
// Wzorzec soba-labs/krs-mcp #2. Run: npm run test:e2e (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sonduj, KOD_WYJSCIA, PRZYPADKI } from "./sonda.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Zrzut z zywego CBOSA (doc 8889489BE0 = II FSK 2870/18).
const DOKUMENT = readFileSync(join(ROOT, "test", "fixtures", "doc-8889489BE0.html"), "utf-8");
const LISTA =
  '<html><body><p>Znaleziono 1 orzeczeń, Str. 1 z 1</p>' +
  '<a href="/doc/8889489BE0">II FSK 2870/18 - Wyrok NSA z 2021-02-10</a></body></html>';
const ZERO = "<html><body><p>Nie znaleziono orzeczeń spełniających podany warunek!</p></body></html>";
const OBCA = "<html><head><title>Weryfikacja</title></head><body>Potwierdz, ze nie jestes robotem.</body></html>";

async function zAtrapa(obsluga, fn) {
  const s = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const [status, body] = obsluga(req);
      res.writeHead(status, { "content-type": "text/html;charset=UTF-8" });
      res.end(body);
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  try {
    return await fn({ ...process.env, CBOSA_BASE_URL: `http://127.0.0.1:${s.address().port}` });
  } finally {
    s.close();
  }
}
const zdrowe = (req) => (req.url.startsWith("/cbo/") ? [200, LISTA] : [200, DOKUMENT]);

test("zdrowe zrodlo -> OK, pelny mianownik", async () => {
  const w = await zAtrapa(zdrowe, (env) => sonduj({ env }));
  assert.equal(w.status, "OK", JSON.stringify(w.kontrole));
  assert.equal(w.kontrole.length, PRZYPADKI.length);
  assert.equal(KOD_WYJSCIA[w.status], 0);
});

test("503 -> UWAGI, nie budzi czlowieka", async () => {
  const w = await zAtrapa(() => [503, "<html>busy</html>"], (env) => sonduj({ env }));
  assert.equal(w.status, "UWAGI", JSON.stringify(w.kontrole));
  assert.equal(w.actionable, false);
});

test("obca strona 200 (captcha/ban) -> BLOKADA", async () => {
  const w = await zAtrapa((req) => (req.url.startsWith("/cbo/") ? [200, OBCA] : [200, DOKUMENT]), (env) => sonduj({ env }));
  assert.equal(w.status, "BLOKADA");
  assert.equal(w.actionable, true);
});

test("znany rekord znika z wyszukiwania (uczciwe zero) -> BLOKADA, nie OK", async () => {
  const w = await zAtrapa((req) => (req.url.startsWith("/cbo/") ? [200, ZERO] : [200, DOKUMENT]), (env) => sonduj({ env }));
  assert.equal(w.status, "BLOKADA");
});

test("403 -> BLOKADA", async () => {
  const w = await zAtrapa(() => [403, "<html>Forbidden</html>"], (env) => sonduj({ env }));
  assert.equal(w.status, "BLOKADA");
  assert.equal(KOD_WYJSCIA[w.status], 20);
});

test("pusta lista przypadkow = BLOKADA, nie sukces", async () => {
  assert.equal((await sonduj({ przypadki: [] })).status, "BLOKADA");
});
