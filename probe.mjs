// Sonde temporaire : compare plusieurs sources de pools pour trouver des coins à ATH 10-50 K$.
import { writeFile } from "node:fs/promises";
const BASE = "https://api.geckoterminal.com/api/v2";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path, retry = 2) {
  await wait(2500);
  try {
    const res = await fetch(BASE + path, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(20000) });
    if (res.status === 429 && retry > 0) { await wait(40000); return get(path, retry - 1); }
    if (!res.ok) return { error: res.status };
    return await res.json();
  } catch (e) { return { error: String(e.message || e) }; }
}
const sources = {
  new_pools: (p) => `/networks/solana/new_pools?page=${p}`,
  tx_count: (p) => `/networks/solana/pools?sort=h24_tx_count_desc&page=${p}`,
  pumpswap: (p) => `/networks/solana/dexes/pumpswap/pools?page=${p}`,
  pumpfun: (p) => `/networks/solana/dexes/pump-fun/pools?page=${p}`,
  raydium: (p) => `/networks/solana/dexes/raydium/pools?page=${p}`,
  trending24: (p) => `/networks/solana/trending_pools?duration=24h&page=${p}`,
  search: (p) => `/search/pools?query=pump&network=solana&page=${p}`,
};
const out = { when: new Date().toISOString(), sources: {} };
for (const [name, f] of Object.entries(sources)) {
  const rows = []; const errors = [];
  for (let p = 1; p <= 10; p++) {
    const j = await get(f(p));
    if (j.error || !j.data) { errors.push(`p${p}:${j.error || "vide"}`); if (errors.length >= 2) break; continue; }
    if (!j.data.length) break;
    for (const x of j.data) {
      const a = x.attributes;
      rows.push({ fdv: Number(a.fdv_usd), age: (Date.now() - new Date(a.pool_created_at)) / 36e5, vol: Number(a.volume_usd?.h24 || 0) });
    }
  }
  const n = rows.length;
  const c = (fn) => rows.filter(fn).length;
  out.sources[name] = { n, errors, fdv_10k_50k: c((r) => r.fdv >= 1e4 && r.fdv < 5e4), fdv_lt_10k: c((r) => r.fdv < 1e4), fdv_50k_250k: c((r) => r.fdv >= 5e4 && r.fdv < 2.5e5),
    age_gt_1h: c((r) => r.age > 1), age_gt_6h: c((r) => r.age > 6), fdv_lt_50k_age_gt_1h: c((r) => r.fdv < 5e4 && r.age > 1), fdv_lt_250k_age_gt_1h: c((r) => r.fdv < 2.5e5 && r.age > 1),
    median_age_h: n ? rows.map((r) => r.age).sort((a, b) => a - b)[Math.floor(n / 2)] : null };
  await writeFile("probe.json", JSON.stringify(out, null, 1));
}
