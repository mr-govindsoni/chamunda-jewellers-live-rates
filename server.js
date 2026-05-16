const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const START_PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const SOURCE_URL = "https://mcxlive.org/";
const METAL_PRICE_API_URL = "https://api.metalpriceapi.com/v1/latest";
const METAL_PRICE_API_KEY =
  process.env.METAL_PRICE_API_KEY || "134cbbbfe69ee44535317259c40b1888";
const CACHE_MS = 30_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

let cache = {
  expiresAt: 0,
  payload: null,
};

function numberFromText(value) {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").replace(/%/g, "").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function stripTags(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readCells(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) =>
    stripTags(match[1]),
  );
}

function classifyTrend(change) {
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "flat";
}

function parseMarketRows(html) {
  const wanted = new Map([
    ["MCX Gold", "gold"],
    ["MCX Gold Mini", "goldMini"],
    ["MCX Silver", "silver"],
    ["MCX Silver Mini", "silverMini"],
    ["MCX Silver Micro", "silverMicro"],
  ]);
  const rows = [];

  for (const rowMatch of html.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = readCells(rowMatch[0]);
    if (cells.length < 8) continue;

    const name = cells[0].replace(/\s+/g, " ").trim();
    if (!wanted.has(name)) continue;

    const last = numberFromText(cells[1]);
    const change = numberFromText(cells[2]);
    const changePercent = numberFromText(cells[3]);
    const close = numberFromText(cells[4]);
    const high = numberFromText(cells[5]);
    const low = numberFromText(cells[6]);

    rows.push({
      id: wanted.get(name),
      name,
      last,
      change,
      changePercent,
      close,
      high,
      low,
      lastTrade: cells[7].replace(/\s+/g, " ").trim(),
      trend: classifyTrend(change),
    });
  }

  return rows;
}

function parseInternationalRows(html) {
  const targets = new Map([
    ["GOLD", { id: "comexGold", name: "Gold COMEX", unit: "USD / oz" }],
    ["SILVER", { id: "comexSilver", name: "Silver COMEX", unit: "USD / oz" }],
    ["USD/INR", { id: "usdInr", name: "INR Spot", unit: "USDINR" }],
    ["US DOLLAR IN", { id: "usdInr", name: "INR Spot", unit: "USDINR" }],
  ]);
  const rowsById = new Map();

  for (const rowMatch of html.matchAll(/<tr class="index-line"[\s\S]*?<\/tr>/gi)) {
    const cells = readCells(rowMatch[0]);
    if (cells.length < 4) continue;

    const rawName = cells[0].replace(/\s+/g, " ").trim().toUpperCase();
    const target = targets.get(rawName);
    if (!target || rowsById.has(target.id)) continue;

    const last = numberFromText(cells[1]);
    const change = numberFromText(cells[2]);
    const changePercent = numberFromText(cells[3]);

    rowsById.set(target.id, {
      id: target.id,
      name: target.name,
      unit: target.unit,
      last,
      change,
      changePercent,
      trend: classifyTrend(change),
    });
  }

  return [...rowsById.values()];
}

function priceFromMetalPriceRates(rates, metalCode) {
  const directPair = rates[`USD${metalCode}`];
  if (Number.isFinite(directPair)) return directPair;

  const inversePair = rates[metalCode];
  if (Number.isFinite(inversePair) && inversePair !== 0) return 1 / inversePair;

  return null;
}

function priceFromUsdInrRates(rates) {
  if (Number.isFinite(rates.INR)) return rates.INR;

  const usdInr = rates.USDINR;
  if (!Number.isFinite(usdInr) || usdInr === 0) return null;

  return usdInr > 1 ? usdInr : 1 / usdInr;
}

async function fetchMetalPriceApiRows() {
  if (!METAL_PRICE_API_KEY) return [];

  const requestUrl = new URL(METAL_PRICE_API_URL);
  requestUrl.searchParams.set("api_key", METAL_PRICE_API_KEY);
  requestUrl.searchParams.set("base", "USD");
  requestUrl.searchParams.set("currencies", "INR,USDINR,XAU,XAG,USDXAU,USDXAG");

  const response = await fetch(requestUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ChamundaJewellersLiveBoard/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`MetalpriceAPI responded ${response.status}`);
  }

  const data = await response.json();
  if (data.success === false) {
    throw new Error(data.error?.info || data.error?.message || "MetalpriceAPI error");
  }

  const rates = data.rates || {};
  const gold = priceFromMetalPriceRates(rates, "XAU");
  const silver = priceFromMetalPriceRates(rates, "XAG");
  const inr = priceFromUsdInrRates(rates);

  return [
    {
      id: "comexGold",
      name: "Gold COMEX",
      unit: "USD / oz",
      last: gold,
      source: "MetalpriceAPI",
    },
    {
      id: "comexSilver",
      name: "Silver COMEX",
      unit: "USD / oz",
      last: silver,
      source: "MetalpriceAPI",
    },
    {
      id: "usdInr",
      name: "INR Spot",
      unit: "USDINR",
      last: inr,
      source: "MetalpriceAPI",
    },
  ].filter((row) => Number.isFinite(row.last));
}

function mergeInternationalRows(publicRows, apiRows) {
  if (!apiRows.length) return publicRows;

  const publicById = new Map(publicRows.map((row) => [row.id, row]));
  const mergedById = new Map(publicRows.map((row) => [row.id, row]));

  for (const apiRow of apiRows) {
    const publicRow = publicById.get(apiRow.id);
    mergedById.set(apiRow.id, {
      ...publicRow,
      ...apiRow,
      change: publicRow?.change ?? null,
      changePercent: publicRow?.changePercent ?? null,
      trend: publicRow?.trend ?? "flat",
    });
  }

  return [...mergedById.values()];
}

function deriveJewellery(mcxRows) {
  const gold = mcxRows.find((row) => row.id === "gold");
  const silver = mcxRows.find((row) => row.id === "silver");
  const baseGold = gold?.last || 0;
  const baseSilver = silver?.last || 0;

  const goldBid = baseGold ? Math.round(baseGold * 0.996) : null;
  const goldAsk = baseGold ? Math.round(baseGold * 1.004) : null;
  const silverBid = baseSilver ? Math.round(baseSilver * 0.996) : null;
  const silverAsk = baseSilver ? Math.round(baseSilver * 1.004) : null;

  return [
    {
      name: "24 Carat Gold",
      purity: "99.50",
      buy: goldBid,
      sell: goldAsk,
      high: gold?.high ?? null,
      low: gold?.low ?? null,
    },
    {
      name: "22 Carat Jewellery HUID",
      purity: "91.60",
      buy: goldBid ? Math.round(goldBid * 0.916) : null,
      sell: goldAsk ? Math.round(goldAsk * 0.916) : null,
      high: gold?.high ? Math.round(gold.high * 0.916) : null,
      low: gold?.low ? Math.round(gold.low * 0.916) : null,
    },
    {
      name: "20 Carat Jewellery HUID",
      purity: "83.30",
      buy: goldBid ? Math.round(goldBid * 0.833) : null,
      sell: goldAsk ? Math.round(goldAsk * 0.833) : null,
      high: gold?.high ? Math.round(gold.high * 0.833) : null,
      low: gold?.low ? Math.round(gold.low * 0.833) : null,
    },
    {
      name: "18 Carat Jewellery HUID",
      purity: "75.00",
      buy: goldBid ? Math.round(goldBid * 0.75) : null,
      sell: goldAsk ? Math.round(goldAsk * 0.75) : null,
      high: gold?.high ? Math.round(gold.high * 0.75) : null,
      low: gold?.low ? Math.round(gold.low * 0.75) : null,
    },
    {
      name: "Silver Chorsa / Bartan",
      purity: "99.90",
      buy: silverBid,
      sell: silverAsk,
      high: silver?.high ?? null,
      low: silver?.low ?? null,
    },
  ];
}

function parseSourceTimestamp(html) {
  const match = html.match(/As on([\s\S]{0,160})<\/div>/i);
  if (!match) return null;

  const timestamp = stripTags(`As on ${match[1]}`).replace(/^As on\s*/i, "").trim();
  return timestamp || null;
}

function buildPayload(html, apiRows = [], apiError = null) {
  const mcx = parseMarketRows(html);
  const international = mergeInternationalRows(parseInternationalRows(html), apiRows);
  const sourceTimestamp = parseSourceTimestamp(html);

  return {
    ok: mcx.length > 0 || international.length > 0,
    source: {
      name: "MCXLive.org",
      url: SOURCE_URL,
      comexProvider: apiRows.length ? "MetalpriceAPI" : "MCXLive.org",
      fetchedAt: new Date().toISOString(),
      sourceTimestamp,
      cacheSeconds: CACHE_MS / 1000,
      apiConnected: apiRows.length > 0,
      apiError,
    },
    international,
    mcx,
    jewellery: deriveJewellery(mcx),
    notice:
      "Rates public market/API sources se read hote hain. Trading/investment ke liye broker ya exchange feed se verify karein.",
  };
}

async function fetchRates() {
  if (cache.payload && Date.now() < cache.expiresAt) {
    return { ...cache.payload, cached: true };
  }

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 BullionLiveBoard/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Source responded ${response.status}`);
  }

  const html = await response.text();
  let apiRows = [];
  let apiError = null;

  try {
    apiRows = await fetchMetalPriceApiRows();
  } catch (error) {
    apiError = error.message;
  }

  const payload = buildPayload(html, apiRows, apiError);

  if (!payload.ok) {
    throw new Error("Source page parsed, but no rate rows were found");
  }

  cache = {
    expiresAt: Date.now() + CACHE_MS,
    payload,
  };

  return { ...payload, cached: false };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": MIME_TYPES[".json"],
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    throw error;
  }
}

async function handleRequest(req, res) {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/api/rates") {
      try {
        sendJson(res, 200, await fetchRates());
      } catch (error) {
        if (cache.payload) {
          sendJson(res, 200, {
            ...cache.payload,
            cached: true,
            stale: true,
            error: error.message,
          });
          return;
        }
        sendJson(res, 502, {
          ok: false,
          error: error.message,
          source: { name: "MCXLive.org", url: SOURCE_URL },
        });
      }
      return;
    }

    await serveStatic(req, res, requestUrl.pathname);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

function startServer(port, attemptsLeft = 10) {
  const appServer = http.createServer(handleRequest);

  appServer.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      startServer(port + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });

  appServer.listen(port, () => {
    console.log(`Chamunda Jewellers running at http://localhost:${port}`);
  });
}

startServer(START_PORT);
