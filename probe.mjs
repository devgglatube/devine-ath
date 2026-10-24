// Diagnostic ponctuel : pourquoi certains coins n'ont ni tweet ni compte X ? (résultat dans probe.json, supprimé ensuite)
import { readFile, writeFile } from "node:fs/promises";
import * as web3 from "@solana/web3.js";
const { PublicKey } = web3;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const coins = JSON.parse(await readFile("coins.json", "utf8"));
const camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8"));
const tw = JSON.parse(await readFile("artifact/tweets.json", "utf8"));
const keyOf = (c) => `${c.t}|${c.n}`;
const mintOf = (c) => c.id || camap[keyOf(c)] || "";
const none = coins.filter((c) => tw[keyOf(c)]?.k === "none" && mintOf(c));
const out = { n: none.length, coins: {}, dexStatus: [], rpcStatus: [] };
for (const c of none) out.coins[keyOf(c)] = { mint: mintOf(c) };
// 1) DexScreener
for (let i = 0; i < none.length; i += 30) {
  const b = none.slice(i, i + 30);
  try {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${b.map(mintOf).join(",")}`, { signal: AbortSignal.timeout(20000) });
    out.dexStatus.push(r.status);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : [];
    for (const c of b) {
      const ps = arr.filter((p) => p.baseToken?.address === mintOf(c));
      out.coins[keyOf(c)].dex = { pairs: ps.length, info: ps.filter((p) => p.info).length, socials: ps.flatMap((p) => p.info?.socials || []).slice(0, 6), websites: ps.flatMap((p) => p.info?.websites || []).slice(0, 3) };
    }
  } catch (e) { out.dexStatus.push(String(e.message || e)); }
  await wait(500);
}
// 2) Métadonnées du token
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const str = (buf, o) => { const n = buf.readUInt32LE(o); return [buf.subarray(o + 4, o + 4 + n).toString("utf8").replace(/\0+$/, ""), o + 4 + n]; };
const uris = {};
for (let i = 0; i < none.length; i += 50) {
  const b = none.slice(i, i + 50);
  try {
    const pdas = b.map((c) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL.toBuffer(), new PublicKey(mintOf(c)).toBuffer()], MPL)[0].toBase58());
    const r = await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [pdas, { encoding: "base64" }] }), signal: AbortSignal.timeout(20000) });
    out.rpcStatus.push(r.status);
    const j = await r.json();
    const vals = j.result?.value || [];
    if (!vals.length) out.rpcStatus.push(JSON.stringify(j).slice(0, 200));
    b.forEach((c, k) => {
      const v = vals[k];
      const o = out.coins[keyOf(c)].meta = { account: !!v };
      if (!v) return;
      try { const buf = Buffer.from(v.data[0], "base64"); let p = 65, x; [x, p] = str(buf, p); [x, p] = str(buf, p); [x, p] = str(buf, p); o.uri = x; uris[mintOf(c)] = [keyOf(c), x]; } catch (e) { o.err = String(e.message || e); }
    });
  } catch (e) { out.rpcStatus.push(String(e.message || e)); }
  await wait(1200);
}
// 3) JSON des métadonnées
for (const [m, [k, uri]] of Object.entries(uris)) {
  const o = out.coins[k].meta;
  if (!/^https?:\/\//.test(uri)) { o.json = "uri non http"; continue; }
  const cid = uri.match(/ipfs\/([^/?#]+)/)?.[1];
  for (const u of [uri, cid && `https://ipfs.io/ipfs/${cid}`, cid && `https://gateway.pinata.cloud/ipfs/${cid}`].filter(Boolean)) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) { o.json = "http " + r.status; continue; }
      const j = await r.json();
      o.json = { twitter: j.twitter, website: j.website, telegram: j.telegram, keys: Object.keys(j).slice(0, 12) };
      break;
    } catch (e) { o.json = "err " + String(e.message || e).slice(0, 60); }
  }
}
// 4) FxTwitter sur les liens trouvés
for (const [k, o] of Object.entries(out.coins)) {
  const links = [o.meta?.json?.twitter, ...(o.dex?.socials || []).filter((s) => s.type === "twitter").map((s) => s.url)].filter(Boolean);
  o.links = links;
  const m = links.map((u) => /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i.exec(u)).find(Boolean);
  if (!m) continue;
  try {
    const r = await fetch(`https://api.fxtwitter.com/${m[1]}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; devine-ath)" }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    o.fx = { status: r.status, code: j.code, message: j.message, user: j.user?.screen_name };
  } catch (e) { o.fx = { err: String(e.message || e).slice(0, 80) }; }
  await wait(400);
}
await writeFile("probe.json", JSON.stringify(out, null, 1));
console.log("ok", none.length);
