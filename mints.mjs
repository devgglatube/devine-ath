// Retrouve l'adresse du contrat (mint) des anciens coins qui n'en ont pas, puis la range dans artifact/ca-map.json.
// Méthode : on cherche les jetons Solana de même symbole ou même nom (GeckoTerminal + DexScreener),
// puis on ne garde que celui dont le logo est identique à celui du coin (vérification sur GeckoTerminal).
// Sans logo identique, on n'accepte un candidat que s'il est l'unique jeton au même nom ET même symbole créé le même jour.
import { readFile, writeFile } from "node:fs/promises";

const GT = process.env.GT_BASE || "https://api.geckoterminal.com/api/v2";
const DS = process.env.DS_BASE || "https://api.dexscreener.com";
const DELAY = Number(process.env.DELAY_MS ?? 2500); // GeckoTerminal : environ 30 appels par minute
const MAX_CHECKS = 30; // vérifications de logo par coin (seulement pour les candidats sans logo connu)
const PAGES = 8; // pages de recherche GeckoTerminal par requête (20 pools par page)
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

const coins = JSON.parse(await readFile("coins.json", "utf8"));
let camap = {};
try { camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
const todo = coins.filter((c) => !c.id && !camap[`${c.t}|${c.n}`]);
console.log(`${todo.length} coin(s) sans adresse`);

const report = [];
let found = 0;
for (const c of todo) {
  const key = `${c.t}|${c.n}`;
  const rep = { key, img: imgKey(c.img), launch: c.l, queries: [], cands: 0, checks: [], result: "aucun" };
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

  // 1) GeckoTerminal : recherche de pools (3 pages par requête)
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

  // 3) Vérification : le candidat doit avoir exactement le même logo (et le même nom)
  const list = [...cands.values()].sort((a, b) => (a.created && L ? Math.abs(a.created - L) : 9e15) - (b.created && L ? Math.abs(b.created - L) : 9e15));
  rep.cands = list.length;
  let hit = null;
  if (imgKey(c.img)) {
    for (const k of list) if (k.image && imgKey(k.image) === imgKey(c.img) && k.nameOk) { hit = { ...k, how: "logo (recherche)" }; break; }
    for (const k of hit ? [] : list.filter((x) => !x.image).slice(0, MAX_CHECKS)) {
      try {
        const a = (await getJson(`${GT}/networks/solana/tokens/${k.mint}/info`)).data.attributes;
        const same = imgKey(a.image_url) === imgKey(c.img), nm = !!nN && norm(a.name) === nN;
        rep.checks.push(`${k.mint.slice(0, 6)} ${a.symbol} ${same ? "logo=" : "logo≠"} ${nm ? "nom=" : "nom≠"}`);
        if (same && nm) { hit = { ...k, how: "logo (fiche)" }; break; }
      } catch (e) {
        rep.checks.push(`${k.mint.slice(0, 6)} ${e.message}`);
      }
    }
  }
  if (!hit) {
    // Repli prudent : un seul jeton au même nom ET même symbole, créé à moins de 2 jours de la date de lancement
    const same = list.filter((k) => k.nameOk && k.symOk && (!L || (k.created && Math.abs(k.created - L) < 2 * 864e5)));
    const exact = list.filter((k) => k.nameOk && k.symOk);
    if (same.length === 1 && exact.length === 1) hit = { ...same[0], how: "unique" };
  }
  if (hit) {
    camap[key] = hit.mint;
    found++;
    rep.result = `${hit.mint} (${hit.how})`;
    console.log(`ok : ${key} -> ${hit.mint} (${hit.how})`);
  } else {
    console.log(`introuvable : ${key} (${list.length} candidat(s))`);
  }
  // sauvegarde après chaque coin (le délai de la tâche peut couper le script)
  if (found) await writeFile("artifact/ca-map.json", JSON.stringify(camap, null, 1) + "\n");
  await writeFile("mints-report.json", JSON.stringify(report, null, 1));
}

console.log(`${found} adresse(s) trouvée(s) sur ${todo.length}`);
