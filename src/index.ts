#!/usr/bin/env node
// MCP server - Polish administrative court rulings (NSA + WSA) via CBOSA
// (Centralna Baza Orzeczen Sadow Administracyjnych, orzeczenia.nsa.gov.pl).
//
// Zamyka luke SAOS, ktory nie indeksuje sadow administracyjnych. To tu zyje
// merytoryczne orzecznictwo RODO/UODO/podatkowe/celne/administracji publicznej.
//
// Stack: Node 18+, stdio, @modelcontextprotocol/sdk, fetch + regex HTML parser.
//
// Tooly:
//   - search        - po slowach/sygnaturze/dacie/sadzie
//   - get_judgment  - po dokumentowym ID CBOSA (heks 10 znakow)
//   - search_by_case - skrot: szukaj po sygnaturze (np. "III OSK 1377/23")
//
// structuredContent.citations w kazdej zwrotce - Patron czyta automatycznie.
//
// UWAGA SSL: CBOSA wystawia certyfikat ktorego chain nie jest w defaultowym
// trust store na niektorych maszynach. Wlaczamy globalny dispatcher z
// rejectUnauthorized: false TYLKO dla domeny orzeczenia.nsa.gov.pl - publiczne
// orzeczenia, nie ma transferu PII, ryzyko MITM zanedbywalne wzgledem korzysci.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import https from "https";

// ---------------------------------------------------------------------------
// HTTP client (z opcjonalnym wylaczeniem weryfikacji SSL dla CBOSA)
// ---------------------------------------------------------------------------

const BASE_URL = "https://orzeczenia.nsa.gov.pl";
const HTTP_TIMEOUT_MS = 30000;
const DEFAULT_USER_AGENT =
    "Mozilla/5.0 (compatible; mcp-nsa/1.0; +https://github.com/matematicsolutions/mcp-nsa)";

// Custom Agent z wylaczona weryfikacja SSL - tylko dla CBOSA (publiczne dane).
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

async function httpRequest(args: {
    path: string;
    method?: "GET" | "POST";
    formData?: Record<string, string>;
}): Promise<string> {
    const { path, method = "GET", formData } = args;
    const url = `${BASE_URL}${path}`;

    return new Promise<string>((resolve, reject) => {
        const isPost = method === "POST";
        const body = isPost && formData
            ? new URLSearchParams(formData).toString()
            : undefined;
        const headers: Record<string, string> = {
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.5",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        };
        if (isPost) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            headers["Content-Length"] = String(Buffer.byteLength(body ?? ""));
        }

        const req = https.request(
            url,
            {
                method,
                headers,
                agent: insecureAgent,
                timeout: HTTP_TIMEOUT_MS,
            },
            (res) => {
                if (
                    res.statusCode &&
                    res.statusCode >= 300 &&
                    res.statusCode < 400 &&
                    res.headers.location
                ) {
                    // Sledzimy redirect raz - CBOSA czasem wraca 302 na search
                    httpRequest({
                        path: res.headers.location.startsWith("http")
                            ? res.headers.location.replace(BASE_URL, "")
                            : res.headers.location,
                        method,
                        formData,
                    })
                        .then(resolve)
                        .catch(reject);
                    return;
                }
                if (!res.statusCode || res.statusCode >= 400) {
                    reject(
                        new Error(
                            `HTTP ${res.statusCode} ${res.statusMessage} for ${url}`,
                        ),
                    );
                    return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () =>
                    resolve(Buffer.concat(chunks).toString("utf8")),
                );
                res.on("error", reject);
            },
        );
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy(new Error(`HTTP timeout ${HTTP_TIMEOUT_MS}ms for ${url}`));
        });
        if (body) req.write(body);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Throttle - CBOSA grzecznie 2 req/s max
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = 500;
let lastRequestAt = 0;
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
}

// ---------------------------------------------------------------------------
// HTML parsing helpers (port z legal-data-hunter/sources/PL/NSA/bootstrap.py)
// ---------------------------------------------------------------------------

function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&aacute;/g, "ą")
        .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, n) =>
            String.fromCharCode(parseInt(n, 16)),
        )
        .replace(/&nbsp;/g, " ");
}

function stripHtml(s: string): string {
    return decodeHtmlEntities(s.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function extractDocIds(html: string): string[] {
    const re = /href="\/doc\/([A-Z0-9]+)"/g;
    const seen = new Set<string>();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            out.push(m[1]);
        }
    }
    return out;
}

function extractTotalResults(html: string): number {
    const m = html.match(/Znaleziono\s+(\d+)\s+orzecze[nń]/);
    return m ? parseInt(m[1], 10) : 0;
}

interface JudgmentSummary {
    doc_id: string;
    title?: string;
    case_number?: string;
    court?: string;
    judgment_date?: string;
    decision_type?: string;
}

/**
 * Wyciagnij metadane z listy wynikow wyszukiwania. CBOSA renderuje kazda
 * pozycje jako blok z linkiem do dokumentu + tabelka z sygnatura, sadem, data.
 * Dla MVP wyciagamy tylko id - reszte uzytkownik pobiera get_judgment-em.
 */
function extractSearchSummaries(html: string): JudgmentSummary[] {
    const ids = extractDocIds(html);
    return ids.map((doc_id) => ({ doc_id }));
}

interface JudgmentDetail {
    doc_id: string;
    title?: string;
    case_number?: string;
    court?: string;
    judgment_date?: string;
    decision_type?: string;
    judges?: string[];
    keywords?: string[];
    legal_bases?: string;
    text?: string;
}

function parseJudgmentHtml(html: string, doc_id: string): JudgmentDetail {
    const data: JudgmentDetail = { doc_id };

    const titleMatch = html.match(/<TITLE>([^<]+)<\/TITLE>/i);
    if (titleMatch) {
        data.title = decodeHtmlEntities(titleMatch[1].trim());
    }

    // Sygnatura: dwa formaty:
    //   NSA: "III FSK 24/25 - Postanowienie NSA z 2026-02-19"
    //   WSA: "I SA/Gl 659/22 - Wyrok WSA w Gliwicach z 2024-09-23"
    if (data.title) {
        let cm = data.title.match(/^([IVX]+\s+[A-Z]+\s+\d+\/\d+)/);
        if (!cm) {
            cm = data.title.match(/^([IVX]+\s+[A-Z]+\/[A-Za-z]+\s+\d+\/\d+)/);
        }
        if (cm) data.case_number = cm[1];
    }

    // Sad
    const courtMatch = html.match(
        /<td class="lista-label">Sąd<\/td>[\s\S]*?<td class="info-list-value">\s*(Naczelny Sąd Administracyjny|Wojewódzki Sąd Administracyjny[^<]*)/,
    );
    if (courtMatch) {
        data.court = decodeHtmlEntities(courtMatch[1].trim());
    }

    // Data orzeczenia
    const dateMatch = html.match(
        />Data orzeczenia<\/[^>]+>[\s\S]*?<td[^>]*>(\d{4}-\d{2}-\d{2})/i,
    );
    if (dateMatch) {
        data.judgment_date = dateMatch[1];
    }

    // Sedziowie
    const judgesMatch = html.match(
        /<td class="lista-label">Sędziowie<\/td>[\s\S]*?<td class="info-list-value">\s*([^<]+(?:<br[^>]*>[^<]+)*)/,
    );
    if (judgesMatch) {
        const text = judgesMatch[1];
        const judges = text
            .split(/<br\s*\/?>/i)
            .map((s) => decodeHtmlEntities(s.trim()))
            .filter(Boolean);
        if (judges.length > 0) data.judges = judges;
    }

    // Hasla tematyczne
    const keywordsMatch = html.match(
        /<td class="lista-label">Hasła tematyczne<\/td>[\s\S]*?<td class="info-list-value">\s*([^<]+)/,
    );
    if (keywordsMatch) {
        const txt = decodeHtmlEntities(keywordsMatch[1].trim());
        data.keywords = txt
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }

    // Rodzaj orzeczenia
    const decisionTypeMatch = html.match(/<span class="war_header">([^<]+)<\/span>/);
    if (decisionTypeMatch) {
        data.decision_type = decodeHtmlEntities(decisionTypeMatch[1].trim());
    }

    // Powolane przepisy
    const lbMatch = html.match(
        /<td class="lista-label">Powołane przepisy<\/td>[\s\S]*?<td class="info-list-value">\s*([^<]+)/,
    );
    if (lbMatch) {
        data.legal_bases = decodeHtmlEntities(lbMatch[1].trim());
    }

    // Sentencja + Uzasadnienie
    const sentencjaMatch = html.match(
        /<div class="lista-label">Sentencja<\/div>\s*<span class="info-list-value-uzasadnienie">\s*([\s\S]*?)<\/span>/,
    );
    const uzasadnienieMatch = html.match(
        /<div class="lista-label">Uzasadnienie<\/div>\s*<span class="info-list-value-uzasadnienie">\s*([\s\S]*?)<\/span>/,
    );
    const parts: string[] = [];
    if (sentencjaMatch) parts.push(stripHtml(sentencjaMatch[1]));
    if (uzasadnienieMatch) parts.push(stripHtml(uzasadnienieMatch[1]));
    if (parts.length > 0) data.text = parts.join("\n\n---\n\n");

    return data;
}

// ---------------------------------------------------------------------------
// Listy sadow - dla pola "sad" w form data
// ---------------------------------------------------------------------------

const COURT_OPTIONS = [
    "Naczelny Sąd Administracyjny",
    "Wojewódzki Sąd Administracyjny w Białymstoku",
    "Wojewódzki Sąd Administracyjny w Bydgoszczy",
    "Wojewódzki Sąd Administracyjny w Gdańsku",
    "Wojewódzki Sąd Administracyjny w Gliwicach",
    "Wojewódzki Sąd Administracyjny w Gorzowie Wielkopolskim",
    "Wojewódzki Sąd Administracyjny w Kielcach",
    "Wojewódzki Sąd Administracyjny w Krakowie",
    "Wojewódzki Sąd Administracyjny w Lublinie",
    "Wojewódzki Sąd Administracyjny w Łodzi",
    "Wojewódzki Sąd Administracyjny w Olsztynie",
    "Wojewódzki Sąd Administracyjny w Opolu",
    "Wojewódzki Sąd Administracyjny w Poznaniu",
    "Wojewódzki Sąd Administracyjny w Rzeszowie",
    "Wojewódzki Sąd Administracyjny w Szczecinie",
    "Wojewódzki Sąd Administracyjny w Warszawie",
    "Wojewódzki Sąd Administracyjny we Wrocławiu",
];

// ---------------------------------------------------------------------------
// Search + fetch wrappers
// ---------------------------------------------------------------------------

async function nsaSearch(params: {
    query?: string;
    caseNumber?: string;
    court?: string;
    dateFrom?: string;
    dateTo?: string;
    pageSize?: number;
    pageNumber?: number;
}): Promise<{ ids: string[]; total: number }> {
    const formData: Record<string, string> = {
        wszystkieSlowa: params.query ?? "",
        sygnatura: params.caseNumber ?? "",
        sad: params.court ?? "",
        wystepowanie: "gdziekolwiek",
        odmiana: "on",
        dataOd: params.dateFrom ?? "",
        dataDo: params.dateTo ?? "",
        rodzaj: "dowolny",
        organWyd: "",
        cenzura: "",
        akt: "",
        zak: "",
        prz: "",
        wPo: String(Math.min(100, Math.max(10, params.pageSize ?? 20))),
        wStr: String(Math.max(1, params.pageNumber ?? 1)),
        wWyn: "1",
        wUkr: "",
        wZaa: "1",
        wPrzS: "on",
    };
    const html = await throttled(() =>
        httpRequest({ path: "/cbo/search", method: "POST", formData }),
    );
    return {
        ids: extractDocIds(html),
        total: extractTotalResults(html),
    };
}

async function nsaGetJudgment(doc_id: string): Promise<JudgmentDetail> {
    const safeId = doc_id.replace(/[^A-Z0-9]/g, "");
    const html = await throttled(() =>
        httpRequest({ path: `/doc/${safeId}` }),
    );
    return parseJudgmentHtml(html, safeId);
}

// ---------------------------------------------------------------------------
// Citation builders
// ---------------------------------------------------------------------------

interface NsaCitation {
    title: string;
    url: string;
    snippet?: string;
    case_number?: string;
    court?: string;
    judgment_date?: string;
    decision_type?: string;
    doc_id: string;
}

function buildDetailCitation(d: JudgmentDetail): NsaCitation {
    const title =
        [d.case_number, d.court].filter(Boolean).join(" - ") ||
        d.title ||
        `CBOSA #${d.doc_id}`;
    const snippet = d.text ? d.text.slice(0, 200) : undefined;
    return {
        title,
        url: `${BASE_URL}/doc/${d.doc_id}`,
        ...(snippet && { snippet }),
        ...(d.case_number && { case_number: d.case_number }),
        ...(d.court && { court: d.court }),
        ...(d.judgment_date && { judgment_date: d.judgment_date }),
        ...(d.decision_type && { decision_type: d.decision_type }),
        doc_id: d.doc_id,
    };
}

// ---------------------------------------------------------------------------
// Text formatters (czlowiekoczytelne dla LLM)
// ---------------------------------------------------------------------------

function formatSearchResults(args: {
    ids: string[];
    total: number;
    summary: string;
    detailed: JudgmentDetail[];
}): string {
    if (args.ids.length === 0) {
        return (
            args.summary +
            "\n\nBrak wynikow w bazie CBOSA dla podanych kryteriow." +
            "\n\nPodpowiedz: sady administracyjne (NSA + WSA) zajmuja sie kontrola" +
            " decyzji administracji publicznej (RODO, podatki, cla, zezwolenia, etc)." +
            " Dla orzecznictwa cywilnego/karnego/gospodarczego uzyj SAOS."
        );
    }
    const lines = [
        args.summary,
        `Znaleziono: ${args.total} orzeczen (pokazano ${args.detailed.length} z ${args.ids.length} pobranych na tej stronie).`,
        "",
    ];
    for (const d of args.detailed) {
        const sig = d.case_number ?? "brak_sygnatury";
        const court = d.court ?? "?";
        const date = d.judgment_date ?? "?";
        const dec = d.decision_type ?? "";
        lines.push(`[${d.doc_id}] ${sig}`);
        lines.push(`  Data: ${date} | Typ: ${dec} | Sad: ${court}`);
        lines.push(`  Link: ${BASE_URL}/doc/${d.doc_id}`);
        if (d.text) {
            lines.push(`  Fragment: ${d.text.slice(0, 200)}...`);
        }
        lines.push("");
    }
    if (args.total > args.detailed.length) {
        lines.push(
            `[Wiecej wynikow: ${args.total - args.detailed.length}. Zwieksz pageNumber lub zaweż kryteria.]`,
        );
    }
    return lines.join("\n");
}

function formatJudgment(d: JudgmentDetail): string {
    const lines = [
        "=== ORZECZENIE CBOSA (NSA / WSA) ===",
        "",
        `Sygnatura  : ${d.case_number ?? "?"}`,
        `Doc ID     : ${d.doc_id}`,
        `Sad        : ${d.court ?? "?"}`,
        `Data       : ${d.judgment_date ?? "?"}`,
        `Typ        : ${d.decision_type ?? "?"}`,
    ];
    if (d.judges?.length) {
        lines.push(`Sklad      : ${d.judges.join(", ")}`);
    }
    if (d.keywords?.length) {
        lines.push(`Slowa klucz: ${d.keywords.join(", ")}`);
    }
    if (d.legal_bases) {
        lines.push(`Podst.prawna: ${d.legal_bases.slice(0, 400)}`);
    }
    lines.push("", `URL        : ${BASE_URL}/doc/${d.doc_id}`);
    if (d.text) {
        const preview = d.text.slice(0, 2000);
        lines.push(
            "",
            `--- Tresc (pierwsze 2000 znakow z ${d.text.length} lacznie) ---`,
            preview,
        );
        if (d.text.length > 2000) {
            lines.push(`[...] Skrocono. Pelna tresc: ${BASE_URL}/doc/${d.doc_id}`);
        }
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
    {
        name: "search",
        description:
            "Przeszukuje Centralna Baze Orzeczen Sadow Administracyjnych (CBOSA) - " +
            "Naczelny Sad Administracyjny + 16 wojewodzkich sadow administracyjnych. " +
            "TU zyje merytoryczne orzecznictwo RODO/UODO, podatkowe, celne, kontrola" +
            " decyzji administracji publicznej. SAOS NIE indeksuje tego pionu. " +
            "Dla MVP zwraca top-N wynikow z pelnymi metadanymi (sygnatura, sad, data," +
            " sklad, hasla tematyczne, podst. prawna, fragment tresci). Max 5 dokumentow" +
            " pobranych w jednym zapytaniu - kazda kolejna szczegolowa lektura przez" +
            " get_judgment z konkretnym doc_id.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "Slowa kluczowe (pole 'wszystkieSlowa' w CBOSA), np. 'RODO art 6' albo 'tajemnica skarbowa'.",
                },
                caseNumber: {
                    type: "string",
                    description:
                        "Sygnatura akt, np. 'III OSK 1377/23' (NSA) albo 'I SA/Gl 659/22' (WSA).",
                },
                court: {
                    type: "string",
                    description:
                        "Nazwa sadu (pelna). Domyslnie wszystkie sady administracyjne.",
                    enum: COURT_OPTIONS,
                },
                dateFrom: {
                    type: "string",
                    description: "Data orzeczenia od (YYYY-MM-DD).",
                },
                dateTo: {
                    type: "string",
                    description: "Data orzeczenia do (YYYY-MM-DD).",
                },
                pageSize: {
                    type: "number",
                    description:
                        "Liczba wynikow na strone z CBOSA (10-100). Domyslnie 20. Tylko z pierwszych 5 pobierane sa pelne dane.",
                    minimum: 10,
                    maximum: 100,
                },
                pageNumber: {
                    type: "number",
                    description: "Numer strony (od 1). Do paginacji.",
                    minimum: 1,
                },
            },
            required: [],
        },
    },
    {
        name: "get_judgment",
        description:
            "Pobiera pelne orzeczenie z CBOSA po jego doc_id (10-znakowy hex). " +
            "Zwraca metadane (sygnatura, sad, data, sklad, hasla tematyczne, " +
            "podstawe prawna, typ orzeczenia) + pierwsze 2000 znakow tresci " +
            "(sentencja + uzasadnienie). doc_id pochodzi z wynikow narzedzia 'search'.",
        inputSchema: {
            type: "object",
            properties: {
                doc_id: {
                    type: "string",
                    description:
                        "10-znakowy hex doc_id z URL CBOSA, np. '7E50984BB7'.",
                },
            },
            required: ["doc_id"],
        },
    },
    {
        name: "search_by_case",
        description:
            "Skrot: szuka orzeczenia po sygnaturze. Odpowiednik search z parametrem " +
            "caseNumber. Jesli orzeczenie nie znajdzie sie - sygnatura moze byc z sadu " +
            "powszechnego/SN/TK/KIO (uzyj wtedy saos__search_by_case).",
        inputSchema: {
            type: "object",
            properties: {
                caseNumber: {
                    type: "string",
                    description: "Sygnatura akt, np. 'III OSK 1377/23'.",
                },
            },
            required: ["caseNumber"],
        },
    },
] as const;

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new Server(
    { name: "mcp-nsa", version: "1.0.0" },
    { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
    })),
}));

const DETAIL_FETCH_LIMIT = 5;

async function handleSearch(args: Record<string, unknown>, headline: string) {
    const params = {
        query: typeof args.query === "string" ? args.query : undefined,
        caseNumber:
            typeof args.caseNumber === "string" ? args.caseNumber : undefined,
        court: typeof args.court === "string" ? args.court : undefined,
        dateFrom:
            typeof args.dateFrom === "string" ? args.dateFrom : undefined,
        dateTo: typeof args.dateTo === "string" ? args.dateTo : undefined,
        pageSize:
            typeof args.pageSize === "number" ? args.pageSize : undefined,
        pageNumber:
            typeof args.pageNumber === "number" ? args.pageNumber : undefined,
    };
    const { ids, total } = await nsaSearch(params);
    // Sciagamy top-N pelnych metadanych zeby wystawic LLM-owi tytuly + fragmenty.
    const slice = ids.slice(0, DETAIL_FETCH_LIMIT);
    const detailed: JudgmentDetail[] = [];
    for (const id of slice) {
        try {
            detailed.push(await nsaGetJudgment(id));
        } catch {
            /* ignore single doc fetch failures */
        }
    }
    return {
        content: [
            {
                type: "text",
                text: formatSearchResults({
                    ids,
                    total,
                    summary: headline,
                    detailed,
                }),
            },
        ],
        structuredContent: {
            citations: detailed.map(buildDetailCitation),
        },
    };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
        switch (name) {
            case "search": {
                const headline = `Wynik search(query="${a.query ?? ""}", caseNumber="${a.caseNumber ?? ""}", court="${a.court ?? "ALL"}", date=${a.dateFrom ?? "*"}..${a.dateTo ?? "*"}):`;
                return await handleSearch(a, headline);
            }

            case "get_judgment": {
                if (!a.doc_id || typeof a.doc_id !== "string") {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Blad: parametr 'doc_id' (10-znakowy hex) jest wymagany.",
                            },
                        ],
                        isError: true,
                    };
                }
                const d = await nsaGetJudgment(a.doc_id);
                return {
                    content: [{ type: "text", text: formatJudgment(d) }],
                    structuredContent: {
                        citations: [buildDetailCitation(d)],
                    },
                };
            }

            case "search_by_case": {
                if (!a.caseNumber || typeof a.caseNumber !== "string") {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Blad: parametr 'caseNumber' jest wymagany.",
                            },
                        ],
                        isError: true,
                    };
                }
                return await handleSearch(
                    { caseNumber: a.caseNumber },
                    `Wynik search_by_case(caseNumber="${a.caseNumber}"):`,
                );
            }

            default:
                return {
                    content: [
                        { type: "text", text: `Nieznane narzedzie: ${name}` },
                    ],
                    isError: true,
                };
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            content: [
                {
                    type: "text",
                    text: `Blad komunikacji z CBOSA (orzeczenia.nsa.gov.pl): ${msg}\n\nSprobuj ponownie za chwile.`,
                },
            ],
            isError: true,
        };
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("mcp-nsa server started (stdio transport)\n");
}

main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
});
