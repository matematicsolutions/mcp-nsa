// Test bramki typow (fix dla mcp-conformance: tools-call-invalid-args).
// Odpala serwer po stdio i wysyla realne zadania MCP - nie testuje kopii logiki.
import { spawn } from "node:child_process";

const proc = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const waiters = new Map();
proc.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  }
});
let id = 0;
const send = (method, params) => new Promise((res) => {
  const myId = ++id;
  waiters.set(myId, res);
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
});

await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const code = (r) => r?.result?.structuredContent?.error_code ?? (r?.error ? "jsonrpc_error" : "OK");
const cases = [
  ["search: query jako liczba",        "search",       { query: 12345 },            "invalid_args"],
  ["search: query jako tablica",       "search",       { query: ["a", "b"] },       "invalid_args"],
  ["search: pageNumber jako string",   "search",       { pageNumber: "abc" },       "invalid_args"],
  ["get_judgment: doc_id jako liczba", "get_judgment", { doc_id: 42 },              "invalid_args"],
  ["get_judgment: brak doc_id",        "get_judgment", {},                          "missing_arg"],
  ["search_by_case: obiekt zamiast str","search_by_case",{ caseNumber: { a: 1 } },   "invalid_args"],
];

let fail = 0;
for (const [label, tool, args, want] of cases) {
  const r = await send("tools/call", { name: tool, arguments: args });
  const got = code(r);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  -> ${got} (oczekiwane ${want})`);
}

// Kontrola pozytywna: poprawne typy MUSZA przejsc bramke. Upstream (CBOSA) moze
// oddac blad sieci/403 - liczy sie tylko to, ze to NIE jest invalid_args.
const okCall = await send("tools/call", { name: "search", arguments: { query: "RODO", pageNumber: 1 } });
const okCode = code(okCall);
const passed = okCode !== "invalid_args";
if (!passed) fail++;
console.log(`${passed ? "PASS" : "FAIL"}  KONTROLA POZYTYWNA: poprawne typy przechodza -> ${okCode}`);

proc.kill();
console.log(fail === 0 ? "\nWYNIK: 7/7 OK" : `\nWYNIK: ${fail} NIEPOWODZEN`);
process.exit(fail === 0 ? 0 : 1);
