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

interface HttpResponse {
    body: string;
    /** Ciasteczka z Set-Cookie - CBOSA trzyma wynik wyszukiwania w sesji;
     *  paginacja (GET /cbo/find?p=N) wymaga odeslania tych cookies. */
    cookies: string[];
}

async function httpRequest(args: {
    path: string;
    method?: "GET" | "POST";
    formData?: Record<string, string>;
    cookies?: string[];
}): Promise<HttpResponse> {
    const { path, method = "GET", formData, cookies } = args;
    const url = `${BASE_URL}${path}`;

    return new Promise<HttpResponse>((resolve, reject) => {
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
        if (cookies && cookies.length > 0) {
            headers["Cookie"] = cookies.join("; ");
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
                const setCookies = (res.headers["set-cookie"] ?? []).map(
                    (c) => c.split(";")[0],
                );
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
                        cookies: [...(cookies ?? []), ...setCookies],
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
                    resolve({
                        body: Buffer.concat(chunks).toString("utf8"),
                        cookies: setCookies,
                    }),
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

export function extractDocIds(html: string): string[] {
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

export function extractTotalResults(html: string): number {
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

export function parseJudgmentHtml(html: string, doc_id: string): JudgmentDetail {
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
    pageNumber?: number;
}): Promise<{ ids: string[]; total: number }> {
    // Nazwy pol ZWERYFIKOWANE live 2026-07-08 przeciw formularzowi /cbo/query:
    // daty to `odDaty`/`doDaty` (nie `dataOd`/`dataDo` - tamte byly cichym no-opem),
    // selecty przyjmuja wartosci tekstowe ("dowolny" / pelna nazwa sadu), nie indeksy.
    // CBOSA renderuje stale 10 wynikow na strone (parametr rozmiaru strony nie istnieje).
    const formData: Record<string, string> = {
        wszystkieSlowa: params.query ?? "",
        wystepowanie: "gdziekolwiek",
        odmiana: "on",
        sygnatura: params.caseNumber ?? "",
        sad: params.court ?? "dowolny",
        rodzaj: "dowolny",
        symbole: "",
        odDaty: params.dateFrom ?? "",
        doDaty: params.dateTo ?? "",
        sedziowie: "",
        funkcja: "",
        submit: "Szukaj",
    };
    // POST rejestruje zapytanie w sesji CBOSA i zwraca strone 1 wynikow.
    const first = await throttled(() =>
        httpRequest({ path: "/cbo/search", method: "POST", formData }),
    );
    const page = Math.max(1, params.pageNumber ?? 1);
    let html = first.body;
    if (page > 1) {
        // Kolejne strony: GET /cbo/find?p=N z cookies sesji z POST-a.
        const next = await throttled(() =>
            httpRequest({ path: `/cbo/find?p=${page}`, cookies: first.cookies }),
        );
        html = next.body;
    }
    return {
        ids: extractDocIds(html),
        total: extractTotalResults(html),
    };
}

async function nsaGetJudgment(doc_id: string): Promise<JudgmentDetail> {
    const safeId = doc_id.replace(/[^A-Z0-9]/g, "");
    const res = await throttled(() =>
        httpRequest({ path: `/doc/${safeId}` }),
    );
    return parseJudgmentHtml(res.body, safeId);
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
// Instructions (procedural orchestration)
// Pattern z dograh-hq/dograh v1.31.0 (BSD-2) via mcp-eu-compliance v0.2.0.
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `Ten serwer MCP udostepnia orzecznictwo polskich sadow administracyjnych - NSA (Naczelny Sad Administracyjny) + 16 WSA (Wojewodzkie Sady Administracyjne) - przez baze CBOSA (orzeczenia.nsa.gov.pl). To gdzie zyje polskie orzecznictwo RODO/UODO, podatkowe, celne, kontrola decyzji administracji.

## Kolejnosc wywolan

### Szukanie po sygnaturze
1. \`search_by_case\` - po sygnaturze ('III OSK 1377/23' NSA, 'I SA/Gl 659/22' WSA). Najszybciej.

### Szerokie szukanie
2. \`search\` - po slowach kluczowych (query: 'RODO art 6', 'tajemnica skarbowa'), sadzie, zakresie dat (dateFrom/dateTo, YYYY-MM-DD). CBOSA zwraca 10 wynikow na strone - paginacja przez pageNumber. Top-5 pelnych metadanych pobierane od razu.

### Pelny tekst
3. \`get_judgment\` - po doc_id (10-znakowy hex z URL CBOSA) zwraca sentencje + uzasadnienie (pierwsze 2000 znakow).

## Twarde ograniczenia

- **Rate limiting** - CBOSA nie ma oficjalnego API. Konektor throttluje. NIE wysylaj burstow zapytan.
  MIN_INTERVAL_MS=500 jest bezpieczne dla ruchu INTERAKTYWNEGO (pojedyncze zapytania uzytkownika).
  Do BULK-HARVESTU to za szybko: 2026-07-19 ciagly bieg na 2 rps dostal pelny ban IP (403 na
  wszystkie sciezki, takze GET /doc i formularz /cbo/query), a 0.5 rps chodzilo 10 h czysto.
- **Sady administracyjne TYLKO** - dla sadow powszechnych/SN/TK/KIO uzyj mcp-saos.
- **\`structuredContent.citations\`** zawsze: title, url (orzeczenia.nsa.gov.pl), case_number, court, judgment_date, doc_id.
- **Bez modyfikacji tresci wyroku** - integralna kopia z CBOSA.

## Iteracja po bledach

Tool zwraca \`isError: true\` + tekst z prefixem \`[code]\`. Kody:
- \`missing_arg\` - brak doc_id (get_judgment) lub caseNumber (search_by_case).
- \`invalid_args\` - parametr ma zly TYP wobec inputSchema (np. query jako liczba, pageNumber jako tekst). Popraw typ i powtorz - to blad wywolania, nie zrodla.
- \`not_found\` - orzeczenie nie ma w CBOSA. Sprobuj search z innym query lub czy nie sad powszechny.
- \`upstream_error\` - blad CBOSA (HTTP, timeout, scraping issue). Retry raz przed surface do uzytkownika.

## Styl odpowiedzi

- Cytuj z sadem i datą: "III OSK 1377/23 (NSA, 2023-10-15)".
- Dla linii orzeczniczej sortuj chronologicznie.
- NIE wymyslaj sygnatur ani sklad sedziowskich - wszystko z \`structuredContent.citations\`.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: true, // CBOSA upstream live
} as const;

const TOOLS = [
    {
        name: "search",
        annotations: READ_ONLY_ANNOTATIONS,
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
                pageNumber: {
                    type: "number",
                    description:
                        "Numer strony (od 1). CBOSA zwraca stale 10 wynikow na strone. Do paginacji.",
                    minimum: 1,
                },
            },
            required: [],
        },
    },
    {
        name: "get_judgment",
        annotations: READ_ONLY_ANNOTATIONS,
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
        annotations: READ_ONLY_ANNOTATIONS,
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

// Strukturalne kody bledow.
type ErrorCode = "missing_arg" | "invalid_args" | "not_found" | "upstream_error";

function errorResult(text: string, code: ErrorCode) {
    return {
        content: [{ type: "text" as const, text: `[${code}] ${text}` }],
        structuredContent: { error_code: code },
        isError: true,
    };
}

// --- Walidacja argumentow wobec ZADEKLAROWANEGO inputSchema ---------------
// setRequestHandler(CallToolRequestSchema) ze SDK waliduje tylko KOPERTE zadania;
// pola `arguments` NIE sprawdza wobec inputSchema danego toola. Skutek: `search`
// przyjmowal query jako liczbe/tablice i leciał dalej, podczas gdy get_judgment
// mial reczny `typeof === "string"`. Zewnetrzny audyt (Ahmad-Faraj/mcp-conformance,
// check `tools-call-invalid-args`) zlapal to na 4 konektorach floty.
// Zakres celowo waski: TYPY + pola WYMAGANE. `enum` NIE jest egzekwowany - dotad
// wartosc spoza listy szla do CBOSA i czasem dzialala, wiec zaostrzenie tego
// byloby zmiana zachowania szersza niz naprawiana wada (osobna decyzja).
// Nieznane pola przepuszczamy swiadomie (forward-compat ze starszymi klientami).
type JsonType = "string" | "number" | "integer" | "boolean" | "array" | "object";

function typeOk(v: unknown, t: JsonType): boolean {
    switch (t) {
        case "string":  return typeof v === "string";
        case "number":  return typeof v === "number" && Number.isFinite(v);
        case "integer": return typeof v === "number" && Number.isInteger(v);
        case "boolean": return typeof v === "boolean";
        case "array":   return Array.isArray(v);
        case "object":  return typeof v === "object" && v !== null && !Array.isArray(v);
        default:        return true;
    }
}

function describeType(v: unknown): string {
    if (Array.isArray(v)) return "array";
    if (v === null) return "null";
    return typeof v;
}

// Zwraca {msg, code} albo null. Kod rozrozniony celowo: BRAK pola wymaganego to
// nadal `missing_arg` (tak bylo przed ta zmiana i tak moga na to patrzec klienci),
// a `invalid_args` jest NOWE i dotyczy wylacznie zlego TYPU. Inaczej ta poprawka
// po cichu przemianowalaby istniejacy blad.
function validateArgs(
    toolName: string,
    args: Record<string, unknown>,
): { msg: string; code: ErrorCode } | null {
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) return null;
    const schema = tool.inputSchema as unknown as {
        properties?: Record<string, { type?: string | string[] }>;
        required?: readonly string[];
    };
    for (const req of schema.required ?? []) {
        if (args[req] === undefined || args[req] === null) {
            return { msg: `parametr '${req}' jest wymagany.`, code: "missing_arg" };
        }
    }
    for (const [key, val] of Object.entries(args)) {
        if (val === undefined || val === null) continue;
        const spec = schema.properties?.[key];
        if (!spec || !spec.type) continue;
        // `type` w JSON Schema moze byc UNIA (np. ["string","number"] w id).
        // Bez normalizacji takie pole wpadalo w `default: return true`, czyli
        // bylo ciche NIE-walidowane - zlapane przez generyczny test, nie przez
        // czytanie kodu.
        const types = (Array.isArray(spec.type) ? spec.type : [spec.type]) as JsonType[];
        if (!types.some((t) => typeOk(val, t))) {
            return {
                msg: `parametr '${key}' ma byc typu ${types.join(" | ")}, dostano ${describeType(val)}.`,
                code: "invalid_args",
            };
        }
    }
    return null;
}

const server = new Server(
    { name: "mcp-nsa", version: "1.3.0" }, // keep in sync with package.json "version"
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
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

    // Bramka typow PRZED dispatchem - zeby zly typ konczyl sie czytelnym bledem
    // narzedzia, a nie zapytaniem do CBOSA ze smieciem w parametrze.
    const invalid = validateArgs(name, a);
    if (invalid) return errorResult(invalid.msg, invalid.code);

    try {
        switch (name) {
            case "search": {
                const headline = `Wynik search(query="${a.query ?? ""}", caseNumber="${a.caseNumber ?? ""}", court="${a.court ?? "ALL"}", date=${a.dateFrom ?? "*"}..${a.dateTo ?? "*"}):`;
                return await handleSearch(a, headline);
            }

            case "get_judgment": {
                if (!a.doc_id || typeof a.doc_id !== "string") {
                    return errorResult(
                        "parametr 'doc_id' (10-znakowy hex) jest wymagany.",
                        "missing_arg",
                    );
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
                    return errorResult("parametr 'caseNumber' jest wymagany.", "missing_arg");
                }
                return await handleSearch(
                    { caseNumber: a.caseNumber },
                    `Wynik search_by_case(caseNumber="${a.caseNumber}"):`,
                );
            }

            default:
                return errorResult(`Nieznane narzedzie: ${name}`, "missing_arg");
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/404|not found/i.test(msg)) {
            return errorResult(`Orzeczenie nie znalezione w CBOSA: ${msg}.`, "not_found");
        }
        return errorResult(
            `Blad komunikacji z CBOSA (orzeczenia.nsa.gov.pl): ${msg}. Sprobuj ponownie za chwile.`,
            "upstream_error",
        );
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

// Uruchamiaj serwer tylko przy bezposrednim wykonaniu (node dist/index.js) -
// testy fixture importuja parsery z tego modulu bez startowania stdio transportu.
if (require.main === module) {
    main().catch((err) => {
        process.stderr.write(`Fatal error: ${err}\n`);
        process.exit(1);
    });
}
