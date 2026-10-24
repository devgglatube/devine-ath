// Ajoute à chaque coin ses paires de trading (DEX, token de cotation, adresse de la paire) : champ "pr".
// Source : API gratuite DexScreener (jusqu'à 30 adresses par appel). Les paires déjà connues sont gardées si l'API ne répond pas.
import { readFile, writeFile } from "node:fs/promises";
const BASE = process.env.DS_BASE || "https://api.dexscreener.com";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const coins = JSON.parse(await readFile("coins.json", "utf8"));
let camap = {};
try { camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
const addrOf = (c) => c.id || camap[`${c.t}|${c.n}`] || "";
const todo = coins.filter((c) => addrOf(c));
let changed = 0, updated = 0;
for (let i = 0; i < todo.length; i += 30) {
  const batch = todo.slice(i, i + 30);
  let pairs;
  try {
    const res = await fetch(`${BASE}/tokens/v1/solana/${batch.map(addrOf).join(",")}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(res.status);
    pairs = await res.json();
    if (!Array.isArray(pairs)) throw new Error("réponse inattendue");
  } catch (e) { console.log("lot ignoré :", String(e.message || e)); await wait(2000); continue; }
  for (const c of batch) {
    const a = addrOf(c);
    const mine = pairs.filter((p) => p.baseToken?.address === a && p.pairAddress)
      .sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0)).slice(0, 3)
      .map((p) => ({ d: String(p.dexId || "").slice(0, 24), q: String(p.quoteToken?.symbol || "").slice(0, 12), a: p.pairAddress }));
    if (!mine.length) continue;
    updated++;
    if (JSON.stringify(c.pr) !== JSON.stringify(mine)) { c.pr = mine; changed++; }
  }
  await wait(400);
}
if (changed) await writeFile("coins.json", JSON.stringify(coins, null, 1));
console.log(`${updated} coin(s) avec paires, ${changed} mis à jour`);
