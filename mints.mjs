// Retrouve l'adresse du contrat (mint) des anciens coins qui n'en ont pas, puis la range dans artifact/ca-map.json.
// Méthode : on cherche les jetons Solana de même symbole ou même nom (GeckoTerminal + DexScreener),
// on garde ceux dont le logo ET le nom sont identiques à ceux du coin, puis :
//   - un seul candidat -> c'est lui ;
//   - plusieurs (copies d'un même jeton) -> on garde celui dont l'ATH correspond à celui du coin, s'il est unique ;
//   - sinon on préfère ne rien mettre plutôt qu'une mauvaise adresse.
// FORCE_KEYS="TICKER|Nom,TICKER2|Nom2" : refait aussi la recherche pour des coins qui ont déjà une adresse dans ca-map.json.
import { readFile, writeFile } from "node:fs/promises";

const GT = process.env.GT_BASE || "https://api.geckoterminal.com/api/v2";
const DS = process.env.DS_BASE || "https://api.dexscreener.com";
const DELAY = Number(process.env.DELAY_MS ?? 2500); // GeckoTerminal : environ 30 appels par minute
const MAX_CHECKS = 40; // vérifications de logo par coin (seulement pour les candidats sans logo connu)
const PAGES = 8; // pages de recherche GeckoTerminal par requête (20 pools par page)
const FORCE = new Set(String(process.env.FORCE_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = (s) => String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const norm = (s) => dec(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const imgKey = (u) => String(u || "").split("?")[0];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const launchMs = (l) => {
  const m = /^(\d{1,2})\s+(\S+)\s+(\d{4})$/.exec(String(l || "").trim());
  const mo = m ? MOIS.indexOf(m[2].toLowerCase()) : -1;
  return m && mo >= 0 ? Date.UTC(+m[3], mo, +m[1]) : 0;
};

async function getJson(url, retry = 2) {
  if (DELAY) await wait(DELAY);
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    if (retry > 0) return getJson(url, retry - 1);
    throw new Error("réseau : " + String(e.message || e));
  }
  if (res.status === 429 && retry > 0) {
    await wait(DELAY ? 40000 : 10);
    return getJson(url, retry - 1);
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// ATH (en market cap) d'un jeton : plus haut prix journalier de ses 2 plus gros pools x quantité en circulation, comme fetch-coins.mjs
async function athsOf(mint) {
  const out = [];
  const pools = (await getJson(`${GT}/networks/solana/tokens/${mint}/pools?page=1`)).data || [];
  for (const pool of pools.slice(0, 2)) {
    const a = pool.attributes || {};
    const supply = Number(a.fdv_usd) / Number(a.base_token_price_usd);
    if (!(supply > 0) || !a.address) continue;
    try {
      const list = (await getJson(`${GT}/networks/solana/pools/${a.address}/ohlcv/day?aggregate=1&limit=1000&currency=usd&token=base`)).data.attributes.ohlcv_list;
      const hi = Math.max(...list.map((x) => Number(x[2])));
      if (hi > 0) out.push({ pool: a.address, ath: Math.round(hi * supply), created: a.pool_created_at || "" });
    } catch (e) {
      out.push({ pool: a.address, err: e.message });
    }
  }
  return out;
}

const coins = JSON.parse(await readFile("coins.json", "utf8"));
let camap = {};
try { camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
const keyOf = (c) => `${c.t}|${c.n}`;
const todo = coins.filter((c) => !c.id && (!camap[keyOf(c)] || FORCE.has(keyOf(c))));
console.log(`${todo.length} coin(s) à traiter`);

const report = [];
let found = 0;
for (const c of todo) {
  const key = keyOf(c);
  const rep = { key, img: imgKey(c.img), launch: c.l, ath: c.ath, before: camap[key] || null, queries: [], cands: 0, checks: [], same: [], result: "aucun" };
  report.push(rep);
  const L = launchMs(c.l), nT = norm(c.t), nN = norm(c.n);
  const cands = new Map(); // mint -> { mint, name, symbol, created, image }
  const add = (mint, name, symbol, created, image) => {
    if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
    const symOk = !!nT && norm(symbol) === nT, nameOk = !!nN && norm(name) === nN;
    if (!symOk && !nameOk) return;
    const old = cands.get(mint) || { mint, name: "", symbol: "", created: 0, image: "" };
    cands.set(mint, { mint, name: name || old.name, symbol: symbol || old.symbol, created: created || old.created, image: image || old.image, symOk: symOk || old.symOk, nameOk: nameOk || old.nameOk });
  };

  // 1) GeckoTerminal : recherche de pools (jusqu'à PAGES pages par requête)
  for (const q of [...new Set([dec(c.t), dec(c.n)])].filter(Boolean)) {
    for (let p = 1; p <= PAGES; p++) {
      try {
        const r = await getJson(`${GT}/search/pools?query=${encodeURIComponent(q)}&network=solana&include=base_token&page=${p}`);
        const inc = new Map((r.included || []).filter((x) => x.type === "token").map((x) => [x.id, x.attributes || {}]));
        for (const pool of r.data || []) {
          const id = pool.relationships?.base_token?.data?.id || "";
          const t = inc.get(id) || {};
          const sym = t.symbol || String(pool.attributes?.name || "").split(" / ")[0].replace("$", "").trim();
          add(id.replace(/^solana_/, ""), t.name, sym, Date.parse(pool.attributes?.pool_created_at || "") || 0, t.image_url);
        }
        rep.queries.push(`gt ${q} p${p}: ${(r.data || []).length}`);
        if ((r.data || []).length < 20) break;
      } catch (e) {
        rep.queries.push(`gt ${q} p${p}: ${e.message}`);
        break;
      }
    }
  }
  // 2) DexScreener : recherche libre (30 paires maximum par requête)
  for (const q of [...new Set([dec(c.t), dec(c.n)])].filter(Boolean)) {
    try {
      const r = await getJson(`${DS}/latest/dex/search?q=${encodeURIComponent(q)}`);
      let n = 0;
      for (const p of r.pairs || []) {
        if (p.chainId !== "solana") continue;
        n++;
        add(p.baseToken?.address, p.baseToken?.name, p.baseToken?.symbol, Number(p.pairCreatedAt) || 0, "");
      }
      rep.queries.push(`ds ${q}: ${n}`);
    } catch (e) {
      rep.queries.push(`ds ${q}: ${e.message}`);
    }
  }

  // 3) Candidats au logo ET au nom identiques (les jetons sans logo connu sont vérifiés sur leur fiche GeckoTerminal)
  const list = [...cands.values()].sort((a, b) => (a.created && L ? Math.abs(a.created - L) : 9e15) - (b.created && L ? Math.abs(b.created - L) : 9e15));
  rep.cands = list.length;
  const same = [];
  if (imgKey(c.img)) {
    for (const k of list) if (k.image && imgKey(k.image) === imgKey(c.img) && k.nameOk) same.push({ ...k, how: "logo (recherche)" });
    for (const k of list.filter((x) => !x.image).slice(0, MAX_CHECKS)) {
      try {
        const a = (await getJson(`${GT}/networks/solana/tokens/${k.mint}/info`)).data.attributes;
        const sameImg = imgKey(a.image_url) === imgKey(c.img), nm = !!nN && norm(a.name) === nN;
        if (sameImg && nm) same.push({ ...k, how: "logo (fiche)" });
        else rep.checks.push(`${k.mint.slice(0, 6)} ${a.symbol} ${sameImg ? "logo=" : "logo≠"} ${nm ? "nom=" : "nom≠"}`);
      } catch (e) {
        rep.checks.push(`${k.mint.slice(0, 6)} ${e.message}`);
      }
    }
  }
  rep.same = same.map((k) => ({ mint: k.mint, how: k.how, created: k.created ? new Date(k.created).toISOString() : "" }));

  let hit = null;
  if (same.length === 1) {
    hit = same[0];
  } else if (same.length > 1) {
    // Plusieurs jetons identiques (copies) : on départage par l'ATH du coin (même formule que fetch-coins.mjs)
    for (const k of same.slice(0, 8)) {
      try { k.aths = await athsOf(k.mint); } catch (e) { k.aths = [{ err: e.message }]; }
    }
    rep.same.forEach((r, i) => { r.aths = (same[i] || {}).aths; });
    const gap = (k) => Math.min(9, ...(k.aths || []).filter((x) => x.ath).map((x) => Math.abs(x.ath / c.ath - 1)));
    const close = same.slice(0, 8).filter((k) => gap(k) <= 0.04);
    if (close.length === 1) {
      hit = { ...close[0], how: close[0].how + " + ATH" };
    } else if (close.length === 0) {
      // l'ATH a pu monter depuis le moment où le coin a été enregistré : on accepte un seul candidat de 0 à 50 % au-dessus
      const up = same.slice(0, 8).filter((k) => (k.aths || []).some((x) => x.ath >= c.ath * 0.96 && x.ath <= c.ath * 1.5));
      if (up.length === 1) hit = { ...up[0], how: up[0].how + " + ATH en hausse" };
    }
  } else if (!imgKey(c.img)) {
    // Coin sans logo : un seul jeton au même nom ET même symbole, créé à moins de 2 jours de la date de lancement
    const exact = list.filter((k) => k.nameOk && k.symOk);
    const near = exact.filter((k) => !L || (k.created && Math.abs(k.created - L) < 2 * 864e5));
    if (exact.length === 1 && near.length === 1) hit = { ...near[0], how: "unique" };
  }

  if (hit) {
    camap[key] = hit.mint;
    found++;
    rep.result = `${hit.mint} (${hit.how})`;
    console.log(`ok : ${key} -> ${hit.mint} (${hit.how})`);
  } else {
    if (FORCE.has(key) && camap[key]) delete camap[key]; // adresse précédente non confirmée : on la retire
    console.log(`introuvable ou ambigu : ${key} (${list.length} candidat(s), ${same.length} au même logo)`);
  }
  // sauvegarde après chaque coin (le délai de la tâche peut couper le script)
  await writeFile("artifact/ca-map.json", JSON.stringify(camap, null, 1) + "\n");
  await writeFile("mints-report.json", JSON.stringify(report, null, 1));
}

console.log(`${found} adresse(s) confirmée(s) sur ${todo.length}`);
