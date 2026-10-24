// Contrôle ponctuel : les adresses de artifact/ca-map.json correspondent-elles bien aux coins ?
// Pour chaque coin sans "id" mais avec une adresse dans ca-map.json : logo, nom et symbole identiques sur GeckoTerminal, et ATH cohérent.
import { readFile, writeFile } from "node:fs/promises";
const GT = process.env.GT_BASE || "https://api.geckoterminal.com/api/v2";
const DELAY = Number(process.env.DELAY_MS ?? 2500);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const norm = (s) => dec(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const imgKey = (u) => String(u || "").split("?")[0];
async function getJson(url, retry = 2) {
  if (DELAY) await wait(DELAY);
  let res;
  try { res = await fetch(url, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { if (retry > 0) return getJson(url, retry - 1); throw new Error("réseau : " + String(e.message || e)); }
  if (res.status === 429 && retry > 0) { await wait(DELAY ? 40000 : 10); return getJson(url, retry - 1); }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
const coins = JSON.parse(await readFile("coins.json", "utf8"));
const camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8"));
const out = [];
for (const c of coins) {
  const key = `${c.t}|${c.n}`, mint = !c.id && camap[key];
  if (!mint) continue;
  const rep = { key, mint, ath: c.ath };
  try {
    const a = (await getJson(`${GT}/networks/solana/tokens/${mint}/info`)).data.attributes;
    rep.logo = imgKey(a.image_url) === imgKey(c.img);
    rep.nom = norm(a.name) === norm(c.n);
    rep.symbole = norm(a.symbol) === norm(c.t);
    rep.holders = a.holders?.count ?? null;
  } catch (e) { rep.info = e.message; }
  try {
    const pools = (await getJson(`${GT}/networks/solana/tokens/${mint}/pools?page=1`)).data || [];
    rep.aths = [];
    for (const pool of pools.slice(0, 2)) {
      const a = pool.attributes || {};
      const supply = Number(a.fdv_usd) / Number(a.base_token_price_usd);
      if (!(supply > 0) || !a.address) continue;
      const list = (await getJson(`${GT}/networks/solana/pools/${a.address}/ohlcv/day?aggregate=1&limit=1000&currency=usd&token=base`)).data.attributes.ohlcv_list;
      rep.aths.push(Math.round(Math.max(...list.map((x) => Number(x[2]))) * supply));
    }
    rep.ratio = rep.aths.length ? +(Math.max(...rep.aths) / c.ath).toFixed(3) : null;
  } catch (e) { rep.pools = e.message; }
  out.push(rep);
  console.log(key, JSON.stringify(rep));
  await writeFile("ca-verify.json", JSON.stringify(out, null, 1));
}
