#!/usr/bin/env node
/**
 * Live smoke test for mcp-nsa (CBOSA upstream).
 *
 * Spawns the built server over stdio (MCP JSON-RPC) and validates against the
 * LIVE portal:
 *   1. tools/list          -> 3 tools
 *   2. search_by_case      -> "II FSK 2870/18" returns exactly-that judgment
 *   3. search + date range -> total is narrower than the unbounded query
 *   4. get_judgment        -> full text (sentencja + uzasadnienie) present
 *
 * Usage: node test/smoke.mjs   (requires `npm run build` first)
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, "../dist/index.js");

let idCounter = 1;
function makeRequest(method, params) {
    return JSON.stringify({ jsonrpc: "2.0", id: idCounter++, method, params });
}

async function runSmoke() {
    console.log("--- mcp-nsa smoke test (LIVE CBOSA) ---\n");

    const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.on("data", (d) => process.stderr.write(`[server stderr] ${d}`));

    const rl = createInterface({ input: child.stdout });
    const pending = new Map();
    rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(new Error(`RPC error: ${msg.error.message}`));
                else resolve(msg.result);
            }
        } catch {
            /* ignore non-JSON lines */
        }
    });

    function rpc(method, params, timeoutMs = 90000) {
        return new Promise((resolve, reject) => {
            const req = JSON.parse(makeRequest(method, params));
            pending.set(req.id, { resolve, reject });
            child.stdin.write(JSON.stringify(req) + "\n");
            setTimeout(() => {
                if (pending.has(req.id)) {
                    pending.delete(req.id);
                    reject(new Error(`timeout ${method}`));
                }
            }, timeoutMs);
        });
    }

    const failures = [];
    const check = (cond, msg) => {
        console.log(`${cond ? "OK  " : "FAIL"} ${msg}`);
        if (!cond) failures.push(msg);
    };

    try {
        await rpc("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "smoke", version: "0.0.0" },
        });
        child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
        );

        // 1. tools/list
        const tools = await rpc("tools/list", {});
        check(tools.tools?.length === 3, `tools/list -> ${tools.tools?.length} tools`);

        // 2. exact signature lookup
        const byCase = await rpc("tools/call", {
            name: "search_by_case",
            arguments: { caseNumber: "II FSK 2870/18" },
        });
        const byCaseText = byCase.content?.[0]?.text ?? "";
        check(!byCase.isError, "search_by_case bez isError");
        check(
            byCaseText.includes("II FSK 2870/18"),
            "search_by_case zwraca II FSK 2870/18",
        );
        const cits = byCase.structuredContent?.citations ?? [];
        check(cits.length >= 1, `citations wypelnione (${cits.length})`);
        const docId = cits[0]?.doc_id;
        check(/^[A-Z0-9]{10}$/.test(docId ?? ""), `doc_id z citations: ${docId}`);

        // 3. date narrowing - unbounded vs 2024-only
        const broad = await rpc("tools/call", {
            name: "search",
            arguments: { query: "RODO" },
        });
        const narrow = await rpc("tools/call", {
            name: "search",
            arguments: { query: "RODO", dateFrom: "2024-01-01", dateTo: "2024-12-31" },
        });
        const totalOf = (r) => {
            const m = (r.content?.[0]?.text ?? "").match(/Znaleziono:\s+(\d+)/);
            return m ? parseInt(m[1], 10) : -1;
        };
        const tBroad = totalOf(broad);
        const tNarrow = totalOf(narrow);
        check(tBroad > 1000, `broad total ${tBroad} > 1000`);
        check(
            tNarrow > 0 && tNarrow < tBroad,
            `date filter narrows: ${tNarrow} < ${tBroad}`,
        );

        // 4. full text fetch
        const doc = await rpc("tools/call", {
            name: "get_judgment",
            arguments: { doc_id: docId },
        });
        const docText = doc.content?.[0]?.text ?? "";
        check(!doc.isError, "get_judgment bez isError");
        check(docText.includes("II FSK 2870/18"), "get_judgment sygnatura zgodna");
        check(/Tresc \(pierwsze 2000 znakow/.test(docText), "get_judgment ma tresc");
    } catch (err) {
        failures.push(String(err));
        console.error("FAIL", err);
    } finally {
        child.kill();
    }

    if (failures.length === 0) {
        console.log("\nOK smoke - wszystkie asercje live przeszly.");
        process.exit(0);
    }
    console.error(`\nFAIL smoke - ${failures.length} problemow.`);
    process.exit(1);
}

runSmoke();
