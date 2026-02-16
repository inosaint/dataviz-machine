const ALLOWED_ENDPOINTS = new Set(["responses", "images/generations"]);
const ALLOWED_ORIGINS = new Set([
  "https://dataviz-machine.netlify.app",
  "http://localhost:8888",
]);
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const DAILY_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMIT_MAX = 100;
const rateLimitStore = new Map();
const dailyLimitStore = new Map();

function getClientIp(event) {
  return (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function isOriginAllowed(event) {
  const origin = event.headers.origin || "";
  if (origin && ALLOWED_ORIGINS.has(origin)) return true;
  const referer = event.headers.referer || "";
  if (referer) {
    try {
      const url = new URL(referer);
      if (ALLOWED_ORIGINS.has(url.origin)) return true;
    } catch (_) {
      // ignore bad referer
    }
  }
  return false;
}

function rateLimitOk(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start >= RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

function dailyLimitOk(ip) {
  const now = Date.now();
  const entry = dailyLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start >= DAILY_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  dailyLimitStore.set(ip, entry);
  return entry.count <= DAILY_LIMIT_MAX;
}

let fetchFn = globalThis.fetch;
async function getFetch() {
  if (fetchFn) return fetchFn;
  const mod = await import("node-fetch");
  fetchFn = mod.default;
  return fetchFn;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Method Not Allowed" } }),
    };
  }

  if (!isOriginAllowed(event)) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Forbidden origin" } }),
    };
  }

  const clientIp = getClientIp(event);
  if (!rateLimitOk(clientIp)) {
    return {
      statusCode: 429,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Rate limit exceeded (5 per minute)" } }),
    };
  }

  if (!dailyLimitOk(clientIp)) {
    return {
      statusCode: 429,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Daily limit exceeded (100 per day)" } }),
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Missing OPENAI_API_KEY" } }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Invalid JSON body" } }),
    };
  }

  const endpoint = body.endpoint;
  const payload = body.payload;
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: "Unsupported endpoint" } }),
    };
  }

  const upstream = `https://api.openai.com/v1/${endpoint}`;
  let upstreamResp;
  try {
    const fetch = await getFetch();
    upstreamResp = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload || {}),
    });
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: { message: `Upstream request failed: ${err?.message || "unknown error"}` },
      }),
    };
  }

  const text = await upstreamResp.text();
  return {
    statusCode: upstreamResp.status,
    headers: { "Content-Type": "application/json" },
    body: text,
  };
};
