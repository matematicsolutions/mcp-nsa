#!/usr/bin/env node
// Offline fixture test - parser HTML CBOSA na zrzutach z 2026-07-08.
// Fixtures pobrane live (probe widen-round): doc = II FSK 2870/18,
// search-results = wynik "podatek" (strona 1, 10 pozycji).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { parseJudgmentHtml, extractDocIds, extractTotalResults } = require(
    join(__dirname, "..", "dist", "index.js"),
);

const failures = [];
function check(cond, msg) {
    if (!cond) failures.push(msg);
}

// --- fixture 1: pelny dokument -------------------------------------------
const docHtml = readFileSync(
    join(__dirname, "fixtures", "doc-8889489BE0.html"),
    "utf-8",
);
const d = parseJudgmentHtml(docHtml, "8889489BE0");

check(d.doc_id === "8889489BE0", `doc_id: ${d.doc_id}`);
check(d.case_number === "II FSK 2870/18", `case_number: ${d.case_number}`);
check(
    d.court === "Naczelny Sąd Administracyjny",
    `court: ${d.court}`,
);
check(/^\d{4}-\d{2}-\d{2}$/.test(d.judgment_date ?? ""), `judgment_date: ${d.judgment_date}`);
check((d.text ?? "").length > 5000, `text length: ${(d.text ?? "").length}`);
check(
    (d.text ?? "").includes("---"),
    "text nie zawiera separatora sentencja/uzasadnienie",
);

// --- fixture 2: lista wynikow ---------------------------------------------
const searchHtml = readFileSync(
    join(__dirname, "fixtures", "search-results.html"),
    "utf-8",
);
const ids = extractDocIds(searchHtml);
const total = extractTotalResults(searchHtml);

// Strona nominalnie 10 wynikow, ale CBOSA potrafi wyrenderowac kilka
// dodatkowych wierszy (fixture z 2026-07-08 ma 12 linkow /doc/).
check(ids.length >= 10 && ids.length <= 15, `extractDocIds: ${ids.length} (oczekiwano 10-15)`);
check(
    ids.every((i) => /^[A-Z0-9]{10}$/.test(i)),
    `nie-heksowe id: ${ids.join(",")}`,
);
check(total === 750077, `extractTotalResults: ${total} (fixture: 750077)`);

if (failures.length === 0) {
    console.log(`OK parse - fixture doc (${d.case_number}) + lista (${ids.length} id, total ${total}).`);
    process.exit(0);
}
console.error(`FAIL parse - ${failures.length} problemow:`);
for (const f of failures) console.error("  - " + f);
process.exit(1);
