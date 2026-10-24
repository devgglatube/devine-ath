// Trouve le tweet (ou à défaut le compte X) associé à chaque coin et l'enregistre dans artifact/tweets.json.
// Sources : métadonnées du token sur la blockchain (Metaplex ou extension Token-2022, champ "twitter"), puis réseaux sociaux DexScreener ; contenu via FxTwitter.
// Les images (avatar, photo du tweet) sont réduites et intégrées au fichier (la version claude.ai bloque les images externes).
import { readFile, writeFile } from "node:fs/promises";
const DS = process.env.DS_BASE || "https://api.dexscreener.com";
const FX = process.env.FX_BASE || "https://api.fxtwitter.com";
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const BUDGET = Number(process.env.BUDGET_MS) || 6 * 60 * 1000;
const t0 = Date.now();
const left = () => BUDGET - (Date.now() - t0);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let sharp = null, web3 = null;
try { sharp = (await import("sharp")).default; } catch { console.log("sharp absent : pas d'images"); }
try { web3 = await import("@solana/web3.js"); } catch { console.log("web3.js absent : métadonnées ignorées"); }

const coins = JSON.parse(await readFile("coins.json", "utf8"));
let camap = {}; try { camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
let map = {}; try { map = JSON.parse(await readFile("artifact/tweets.json", "utf8")); } catch {}
const keyOf = (c) => `${c.t}|${c.n}`;
const mintOf = (c) => c.id || camap[keyOf(c)] || "";
const keys = new Set(coins.map(keyOf));
for (const k of Object.keys(map)) if (!keys.has(k)) delete map[k];

const DAY = 864e5, now = Date.now();
const todo = coins.filter((c) => {
  const e = map[keyOf(c)];
  if (!mintOf(c)) return false;
  if (!e) return true;
  if (e.k === "none") return now - e.f > DAY;
  return now - e.f > 3 * DAY || (sharp && e.av === "" && now - e.f > 3600e3);
});
console.log(`${todo.length} coin(s) à traiter sur ${coins.length}`);
if (!todo.length) process.exit(0);

// ---- liens X ----
const STATUS = /(?:^|\/\/)(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/i;
const PROFILE = /(?:^|\/\/)(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
const RESERVED = new Set(["i", "home", "intent", "search", "hashtag", "share", "explore", "messages", "settings", "compose", "login"]);
function parseLink(u) {
  if (!u) return null;
  u = String(u).trim();
  let m = STATUS.exec(u);
  if (m) return { type: "tweet", user: m[1], id: m[2] };
  m = PROFILE.exec(u);
  if (m && !RESERVED.has(m[1].toLowerCase())) return { type: "profile", user: m[1] };
  return null;
}
async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length && left() > 0) { const it = q.shift(); try { await fn(it); } catch (e) { console.log("erreur :", String(e.message || e)); } }
  }));
}

// 1) DexScreener : liens des réseaux sociaux
const dexLinks = {};
for (let i = 0; i < todo.length && left() > 0; i += 30) {
  const b = todo.slice(i, i + 30);
  try {
    const r = await fetch(`${DS}/tokens/v1/solana/${b.map(mintOf).join(",")}`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (Array.isArray(j)) for (const p of j) { const m = p.baseToken?.address; if (m) (dexLinks[m] ||= []).push(...(p.info?.socials || []).filter((s) => s.type === "twitter").map((s) => s.url)); }
  } catch (e) { console.log("dexscreener ignoré :", String(e.message || e)); }
  await wait(400);
}
// 2) Métadonnées du token : extension Token-2022 portée par le mint (tokens récents) ou compte Metaplex (anciens tokens).
//    Le JSON pointé contient souvent le lien du tweet d'origine dans "twitter".
const metaLinks = {};
if (web3) {
  const { PublicKey } = web3;
  const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const str = (buf, o) => { const n = buf.readUInt32LE(o); return [buf.subarray(o + 4, o + 4 + n).toString("utf8").replace(/\0+$/, ""), o + 4 + n]; };
  // Token-2022 : 82 octets de mint, remplissage jusqu'à 165, type de compte, puis extensions (type, longueur, valeur). Type 19 = métadonnées.
  function uri22(buf) {
    let o = 166;
    while (o + 4 <= buf.length) {
      const type = buf.readUInt16LE(o), len = buf.readUInt16LE(o + 2); o += 4;
      if (type === 19) { let x; [x, o] = str(buf, o + 64); [x, o] = str(buf, o); [x, o] = str(buf, o); return x; }
      o += len;
    }
    return "";
  }
  async function accounts(addrs) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [addrs, { encoding: "base64" }] }), signal: AbortSignal.timeout(20000) });
        if (r.ok) { const v = (await r.json()).result?.value; if (Array.isArray(v)) return v; }
      } catch (e) { console.log("rpc ignoré :", String(e.message || e)); }
      await wait(2500 * (a + 1));
    }
    return [];
  }
  const need = todo.filter((c) => !(dexLinks[mintOf(c)] || []).some((u) => parseLink(u)?.type === "tweet"));
  const uris = {};
  for (let i = 0; i < need.length && left() > 0; i += 50) {
    const b = need.slice(i, i + 50);
    const mv = await accounts(b.map(mintOf));
    b.forEach((c, k) => {
      const v = mv[k];
      if (!v || v.owner !== T22) return;
      try { const u = uri22(Buffer.from(v.data[0], "base64")); if (/^https?:\/\//.test(u)) uris[mintOf(c)] = u; } catch {}
    });
    await wait(1200);
    const rest = b.filter((c) => !uris[mintOf(c)]);
    if (rest.length) {
      let pdas = [];
      try { pdas = rest.map((c) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL.toBuffer(), new PublicKey(mintOf(c)).toBuffer()], MPL)[0].toBase58()); } catch (e) { console.log("pda ignoré :", String(e.message || e)); }
      const pv = pdas.length ? await accounts(pdas) : [];
      rest.forEach((c, k) => {
        const v = pv[k];
        if (!v) return;
        try { const buf = Buffer.from(v.data[0], "base64"); let o = 65, x; [x, o] = str(buf, o); [x, o] = str(buf, o); [x, o] = str(buf, o); if (/^https?:\/\//.test(x)) uris[mintOf(c)] = x; } catch {}
      });
      await wait(1200);
    }
  }
  await pool(Object.entries(uris), 6, async ([m, uri]) => {
    const cid = uri.match(/ipfs\/([^/?#]+)/)?.[1];
    for (const u of [uri, cid && `https://ipfs.io/ipfs/${cid}`, cid && `https://gateway.pinata.cloud/ipfs/${cid}`].filter(Boolean)) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (!r.ok) continue;
        const j = await r.json();
        metaLinks[m] = [j.twitter, j.extensions?.twitter, j.website].filter((x) => typeof x === "string" && parseLink(x.trim())).map((x) => x.trim());
        return;
      } catch {}
    }
  });
}

// ---- contenu via FxTwitter + images ----
async function fx(path, st = {}) {
  for (let a = 0; a < 3; a++) {
    let r;
    try { r = await fetch(FX + path, { headers: { "user-agent": "Mozilla/5.0 (compatible; devine-ath)" }, signal: AbortSignal.timeout(15000) }); }
    catch (e) { st.s = "reseau"; if (a === 2) throw e; await wait(1500 * (a + 1)); continue; }
    st.s = r.status;
    if (r.ok) return r.json();
    if ([400, 404, 410, 451].includes(r.status)) return null; // compte ou tweet introuvable : définitif
    if (a === 2) throw new Error("fxtwitter " + r.status); // limite de débit, accès refusé ou panne : passagers
    const ra = Number(r.headers.get("retry-after"));
    await wait(Math.min(10000, ra > 0 ? ra * 1000 : 1500 * (a + 1)));
  }
  return null;
}
async function img(url, w, h, q) {
  if (!sharp || !url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const out = await sharp(Buffer.from(await r.arrayBuffer())).resize(w, h || undefined, { fit: h ? "cover" : "inside", withoutEnlargement: true }).webp({ quality: q }).toBuffer({ resolveWithObject: true });
    return { uri: `data:image/webp;base64,${out.data.toString("base64")}`, w: out.info.width, h: out.info.height };
  } catch { return null; }
}
const verif = (a) => { const v = a?.verification; if (!v?.verified) return 0; return v.type === "organization" ? 2 : v.type === "government" ? 3 : 1; };
async function author(a) {
  const av = await img((a.avatar_url || "").replace("_normal.", "_200x200."), 96, 96, 80);
  return { an: String(a.name || "").slice(0, 60), ah: a.screen_name, av: av?.uri || "", vf: verif(a), fo: a.followers ?? null, jd: a.joined ? Date.parse(a.joined) || null : null };
}
async function build(link, st = {}) {
  if (link.type === "tweet") {
    const j = await fx(`/${link.user}/status/${link.id}`, st);
    const t = j?.tweet;
    if (t) {
      const e = { k: "tweet", u: t.url, id: t.id, ...(await author(t.author)), tx: String(t.text || "").slice(0, 700), ts: (t.created_timestamp || 0) * 1000,
        lk: t.likes ?? null, rt: t.retweets ?? null, rp: t.replies ?? null, vw: t.views ?? null, bm: t.bookmarks ?? null, ph: "", pw: 0, pg: 0, vid: 0 };
      if (!t.possibly_sensitive) {
        const m = t.media || {};
        const src = m.photos?.[0]?.url?.replace("name=orig", "name=small") || m.videos?.[0]?.thumbnail_url || m.external?.thumbnail_url || "";
        const p = await img(src, 560, 0, 72);
        if (p) { e.ph = p.uri; e.pw = p.w; e.pg = p.h; e.vid = m.videos?.length || (m.external && !m.photos?.length) ? 1 : 0; }
      }
      return e;
    }
    link = { type: "profile", user: link.user }; // tweet supprimé : on retombe sur le compte
  }
  const j = await fx(`/${link.user}`, st);
  const u = j?.user;
  if (!u) return null;
  return { k: "profile", u: u.url, ...(await author(u)), tx: String(u.description || "").slice(0, 300) };
}

let done = 0;
await pool(todo, 3, async (c) => {
  const m = mintOf(c), key = keyOf(c), seen = new Set();
  // tweets d'abord (l'origine du coin), puis comptes ; sans doublon
  const cands = [...(metaLinks[m] || []), ...(dexLinks[m] || [])].map(parseLink).filter((x) => {
    if (!x) return false;
    const id = `${x.type}:${x.user.toLowerCase()}:${x.id || ""}`;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).sort((p, q) => (p.type === "tweet" ? 0 : 1) - (q.type === "tweet" ? 0 : 1));
  let entry = null, failed = false, why = cands.length ? "" : "aucun lien";
  for (const link of cands) {
    const st = {};
    try { entry = await build(link, st); } catch (e) { failed = true; console.log("échec", c.t, String(e.message || e)); continue; }
    await wait(600);
    if (entry) break;
    why = `${link.type}:${link.user} introuvable (${st.s})`;
  }
  if (!entry && failed) { console.log(c.t, "→ panne passagère, on réessaiera au prochain passage"); return; }
  map[key] = entry ? { ...entry, f: Date.now() } : { k: "none", f: Date.now(), w: why };
  console.log(c.t, "→", map[key].k, map[key].ah ? "@" + map[key].ah : "");
  if (++done % 10 === 0) await writeFile("artifact/tweets.json", JSON.stringify(map));
});
await writeFile("artifact/tweets.json", JSON.stringify(map));
const vals = Object.values(map);
console.log(`tweets : ${vals.filter((e) => e.k === "tweet").length}, comptes : ${vals.filter((e) => e.k === "profile").length}, sans lien : ${vals.filter((e) => e.k === "none").length}`);
