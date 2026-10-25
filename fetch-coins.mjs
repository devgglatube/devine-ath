// Usage : node fetch-coins.mjs            -> complète coins.json (6 coins par tranche)
//         node fetch-coins.mjs 10         -> vise 10 coins par tranche
//         node fetch-coins.mjs --fresh    -> repart de zéro
// Les coins déjà présents sont gardés : seules les tranches incomplètes sont remplies.
// Source : API gratuite GeckoTerminal (Solana). Le fichier est sauvegardé après chaque coin.
import { readFile, writeFile, stat } from "node:fs/promises";
import { rmSync } from "node:fs";

const args = process.argv.slice(2);
const FRESH = args.includes("--fresh");
const PER = Number(args.find((a) => /^\d+$/.test(a))) || 6;
const DELAY = Number(process.env.DELAY_MS) || 2500; // l’API gratuite limite à environ 30 appels par minute
const BASE = "https://api.geckoterminal.com/api/v2";
const BUCKETS = [
  [1e4, 5e4, "10 K$ – 50 K$"],
  [5e4, 2.5e5, "50 K$ – 250 K$"],
  [2.5e5, 1e6, "250 K$ – 1 M$"],
  [1e6, 5e6, "1 M$ – 5 M$"],
  [5e6, 3e7, "5 M$ – 30 M$"],
  [3e7, 1.5e8, "30 M$ – 150 M$"],
];
const bucketOf = (ath) => BUCKETS.findIndex(([lo, hi]) => ath >= lo && ath < hi);
const SKIP = new Set(["SOL", "WSOL", "USDC", "USDT", "JUP", "JITOSOL", "MSOL", "USD1", "PYUSD"]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (c) => `${c.t}|${c.n}`;

// --- verrou : pas deux recherches en même temps (double-clic + tâche automatique) ---
const LOCK = ".fetch.lock";
try {
  const st = await stat(LOCK);
  if (Date.now() - st.mtimeMs < 45 * 60 * 1000) {
    console.log("Une mise à jour est déjà en cours. Rien à faire.");
    process.exit(0);
  }
} catch {}
await writeFile(LOCK, String(process.pid));
process.on("exit", () => rmSync(LOCK, { force: true }));
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

// --- rug pull : effondrement quasi total ou chute brutale juste après le sommet (les coins qui meurent doucement restent) ---
function isRug(ch) {
  if (!Array.isArray(ch) || ch.length < 3) return false;
  const mx = Math.max(...ch), i = ch.indexOf(mx);
  const last = ch[ch.length - 1] / mx;
  const after = Math.min(...ch.slice(i, i + 3)) / mx;
  return last < 0.01 || after < 0.15;
}

// --- courbe trop plate : pas assez de fluctuation pour jouer ---
function isFlat(ch) {
  if (!Array.isArray(ch) || ch.length < 12) return false;
  const mx = Math.max(...ch), mn = Math.min(...ch);
  const big = ch.slice(1).filter((v, i) => Math.abs(v - ch[i]) / ch[i] > 0.08).length;
  return mx / mn < 2.5 || big < 4;
}

// --- wallets liés (bundle / sybil) : beaucoup de gros comptes avec quasiment le même solde ---
// Vérifié via le RPC Solana (GitHub Actions y a accès). true = bundle, false = sain, null = inconnu (on réessaie plus tard).
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
let rpcDead = 0;
async function isBundled(mint) {
  if (!mint || rpcDead >= 4) return null;
  for (let a = 0; a < 3; a++) {
    await wait(1500);
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [mint] }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) { await wait(8000); continue; }
      const v = (await res.json())?.result?.value;
      if (!Array.isArray(v)) continue;
      rpcDead = 0;
      const am = v.map((x) => Number(x.uiAmount)).filter((x) => x > 0);
      if (am.length < 8) return false;
      const cluster = Math.max(...am.map((x) => am.filter((y) => Math.abs(y - x) / x < 0.02).length));
      return cluster >= 5;
    } catch {}
  }
  rpcDead++;
  return null;
}
let CAM = {};
try { CAM = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
const mintOf = (c) => c.id || CAM[keyOf(c)];

// --- coins déjà présents ---
let out = [];
if (!FRESH) {
  try {
    out = JSON.parse(await readFile("coins.json", "utf8"));
  } catch {}
}
out = out.filter((c) => c && c.ath && Array.isArray(c.ch) && bucketOf(c.ath) >= 0);
const before = out.length;
out = out.filter((c) => !isRug(c.ch));
if (out.length < before) console.log(`${before - out.length} rug pull(s) retiré(s) de coins.json`);
const bf = out.length;
out = out.filter((c) => !isFlat(c.ch));
if (out.length < bf) console.log(`${bf - out.length} coin(s) trop plat(s) retiré(s) de coins.json`);
out = out.filter((c, i) => out.findIndex((x) => keyOf(x) === keyOf(c)) === i); // pas deux coins avec le même nom
out.forEach((c) => (c.b = bucketOf(c.ath)));
{
  let n = 0;
  for (const c of out) {
    if (c.bz !== undefined || n >= 12) continue;
    const m = mintOf(c);
    if (!m) continue;
    n++;
    const r = await isBundled(m);
    if (r === null) continue;
    c.bz = r ? 1 : 0;
    if (r) console.log(`  wallets liés : ${c.n} retiré`);
  }
  const b2 = out.length;
  out = out.filter((c) => c.bz !== 1);
  if (out.length < b2) console.log(`${b2 - out.length} coin(s) avec wallets liés retiré(s)`);
  await writeFile("coins.json", JSON.stringify(out, null, 1));
}
const counts = BUCKETS.map((_, i) => out.filter((c) => c.b === i).length);
const known = new Set(out.map(keyOf));
const need = () => counts.map((n) => Math.max(0, PER - n));
const missing = () => need().reduce((a, b) => a + b, 0);

console.log(`Coins déjà présents : ${out.length}`);
BUCKETS.forEach(([, , l], i) => console.log(`  ${l} : ${counts[i]}/${PER}`));
if (!missing()) {
  console.log("\nTout est déjà complet. Pour plus de coins : node fetch-coins.mjs 10  (ou --fresh pour tout refaire)");
  process.exit(0);
}

async function get(path, retry = 2) {
  await wait(DELAY);
  let res;
  try {
    res = await fetch(BASE + path, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    if (retry > 0) return get(path, retry - 1);
    throw new Error("réseau indisponible");
  }
  if (res.status === 429 && retry > 0) {
    console.log("  trop d’appels, pause de 40 s…");
    await wait(40000);
    return get(path, retry - 1);
  }
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

// 1) Candidats : nouveaux coins (souvent nuls), coins les plus échangés, coins tendance
async function discover() {
  const paths = [];
  const smallNeeded = need()[0] > 0 || need()[1] > 0;
  // Les "nouveaux pools" ont moins d'1 h : pas assez d'historique. On préfère les pools pump.fun / PumpSwap
  // déjà vieux de quelques heures (beaucoup ont un ATH de 10 à 50 K$), puis les plus actifs.
  const pages = (f, n) => Array.from({ length: n }, (_, i) => f(i + 1));
  const small = [
    ...pages((p) => `/networks/solana/dexes/pump-fun/pools?page=${p}`, 10),
    ...pages((p) => `/networks/solana/dexes/pumpswap/pools?page=${p}`, 10),
    ...pages((p) => `/networks/solana/pools?sort=h24_tx_count_desc&page=${p}`, 5),
  ];
  const vol = pages((p) => `/networks/solana/pools?sort=h24_volume_usd_desc&page=${p}`, 6);
  const trend = pages((p) => `/networks/solana/trending_pools?duration=24h&page=${p}`, 3);
  paths.push(...(smallNeeded ? [...small, ...trend, ...vol] : [...vol, ...trend, ...small]));
  const seen = new Set();
  const found = [];
  let failures = 0;
  for (const path of paths) {
    console.log("Recherche de coins :", path);
    try {
      for (const pool of (await get(path)).data) {
        const a = pool.attributes;
        const symbol = (a.name || "").split(" / ")[0].replace("$", "").trim();
        const address = pool.relationships.base_token.data.id.replace(/^solana_/, "");
        const fdv = Number(a.fdv_usd);
        if (SKIP.has(symbol.toUpperCase()) || seen.has(address)) continue;
        if (!(fdv > 0 && fdv < 1.5e8) || !(Number(a.base_token_price_usd) > 0)) continue;
        if (Date.now() - new Date(a.pool_created_at) < 36e5) continue; // moins d'1 h : historique trop court
        seen.add(address);
        found.push({ address, pool: a, fdv });
      }
      failures = 0;
    } catch (e) {
      console.log("  ignoré :", e.message);
      if (++failures >= 3) {
        console.log("  Trop d’échecs d’affilée, arrêt de la recherche.");
        break;
      }
    }
  }
  return found.sort(() => Math.random() - 0.5);
}

// 2) Historique des prix : minutes pour les coins très récents, heures puis jours pour les autres
async function history(pool) {
  const age = (Date.now() - new Date(pool.pool_created_at)) / 864e5;
  const [tf, agg] = age < 2 ? ["minute", 5] : age < 40 ? ["hour", 1] : ["day", 1];
  const list = (await get(`/networks/solana/pools/${pool.address}/ohlcv/${tf}?aggregate=${agg}&limit=1000&currency=usd&token=base`)).data.attributes.ohlcv_list;
  return list.slice().reverse(); // du plus ancien au plus récent
}

// Courbe de 60 points maximum pour l’animation (le pic montre l’ATH exact)
function series(c, supply) {
  const mi = c.reduce((best, x, i) => (x[2] > c[best][2] ? i : best), 0);
  const n = Math.min(60, c.length);
  const res = [];
  for (let k = 0; k < n; k++) {
    const a = Math.floor((k * c.length) / n);
    const b = Math.max(a + 1, Math.floor(((k + 1) * c.length) / n));
    let v = c[b - 1][4] * supply;
    if (mi >= a && mi < b) v = c[mi][2] * supply;
    res.push(Math.max(1, Math.round(v)));
  }
  return res;
}

async function buildCoin({ address, pool }) {
  const c = await history(pool);
  if (c.length < 12) throw new Error("historique trop court");
  const supply = Number(pool.fdv_usd) / Number(pool.base_token_price_usd);
  const ath = Math.round(Math.max(...c.map((x) => x[2])) * supply);
  const b = bucketOf(ath);
  if (b < 0) throw new Error(`ATH hors tranche (${ath.toLocaleString("fr-FR")} $)`);
  if (need()[b] <= 0) throw new Error(`tranche ${BUCKETS[b][2]} déjà pleine`);

  const ch0 = series(c, supply);
  if (isRug(ch0)) throw new Error("rug pull détecté");
  if (isFlat(ch0)) throw new Error("courbe trop plate");
  const bz = await isBundled(address);
  if (bz === true) throw new Error("wallets liés (bundle)");
  let info = {};
  try {
    info = (await get(`/networks/solana/tokens/${address}/info`)).data.attributes;
  } catch {}
  const fallback = (pool.name || "").split(" / ")[0].replace("$", "").trim();
  const date = new Date(pool.pool_created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return {
    id: address,
    n: info.name || fallback,
    t: info.symbol || fallback,
    img: info.image_url && !info.image_url.includes("missing") ? info.image_url : "",
    ho: info.holders?.count ?? 0,
    c: "Solana",
    l: date,
    d: (info.description || "").slice(0, 200),
    ath,
    ch: series(c, supply),
    b,
    ...(bz === false ? { bz: 0 } : {}),
  };
}

const candidates = await discover();
console.log(`\n${candidates.length} candidats. Il manque ${missing()} coin(s). Ça peut prendre quelques minutes, tu peux laisser tourner.\n`);

let added = 0;
for (const cand of candidates) {
  if (!missing()) break;
  if (!BUCKETS.some(([, hi], i) => need()[i] > 0 && hi > cand.fdv)) continue;
  console.log("→", cand.pool.name);
  try {
    const coin = await buildCoin(cand);
    if (known.has(keyOf(coin))) throw new Error("déjà présent");
    known.add(keyOf(coin));
    out.push(coin);
    counts[coin.b]++;
    added++;
    await writeFile("coins.json", JSON.stringify(out, null, 1)); // sauvegarde après chaque coin
    console.log(`  ok : ${coin.n} · ATH ≈ ${coin.ath.toLocaleString("fr-FR")} $ · ${coin.ho} holders · tranche ${BUCKETS[coin.b][2]}`);
  } catch (e) {
    console.log("  ignoré :", e.message);
  }
}

console.log(`\n${added} coin(s) ajouté(s), ${out.length} au total dans coins.json`);
BUCKETS.forEach(([, , l], i) => console.log(`  ${l} : ${counts[i]}/${PER}`));
if (missing()) console.log("Certaines tranches ne sont pas pleines : relance plus tard, de nouveaux coins apparaissent toute la journée.");
