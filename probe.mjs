import { readFile, writeFile } from "node:fs/promises";
const ids = JSON.parse(await readFile("probe-ids.json", "utf8"));
const urls = (m) => [
  `https://frontend-api-v3.pump.fun/coins/${m}`,
  `https://frontend-api.pump.fun/coins/${m}`,
  `https://api.dexscreener.com/latest/dex/tokens/${m}`,
  `https://api.dexscreener.com/tokens/v1/solana/${m}`,
  `https://swap-api.pump.fun/v1/coins/${m}`,
];
const out = {};
for (const m of ids) for (const u of urls(m)) {
  try { const r = await fetch(u, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }); const t = await r.text(); out[u] = { status: r.status, body: t.slice(0, 2500) }; }
  catch (e) { out[u] = { error: String(e.message || e) }; }
  await new Promise((r) => setTimeout(r, 1200));
}
await writeFile("probe.json", JSON.stringify(out, null, 1));
