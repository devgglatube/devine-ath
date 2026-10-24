// Diagnostic ponctuel n°2 : métadonnées Token-2022 (mint) pour les coins sans compte Metaplex (résultat dans probe.json, supprimé ensuite)
import { readFile, writeFile } from "node:fs/promises";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const prev = JSON.parse(await readFile("probe.json", "utf8"));
const RPC = "https://api.mainnet-beta.solana.com";
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const list = Object.entries(prev.coins).filter(([, o]) => o.meta && o.meta.account === false).map(([k, o]) => [k, o.mint]);
const out = { n: list.length, rpc: [], coins: {} };
function parse22(buf) {
  if (buf.length <= 166) return { err: "trop court " + buf.length };
  let o = 166;
  const types = [];
  while (o + 4 <= buf.length) {
    const type = buf.readUInt16LE(o), len = buf.readUInt16LE(o + 2); o += 4; types.push(type);
    if (type === 19) {
      let p = o + 64;
      const rd = () => { const n = buf.readUInt32LE(p); const s = buf.subarray(p + 4, p + 4 + n).toString("utf8"); p += 4 + n; return s; };
      try {
        const name = rd(), symbol = rd(), uri = rd();
        const extra = []; const cnt = buf.readUInt32LE(p); p += 4;
        for (let i = 0; i < cnt && p < o + len; i++) extra.push([rd(), rd()]);
        return { name, symbol, uri, extra, types };
      } catch (e) { return { err: String(e.message || e), types }; }
    }
    o += len;
  }
  return { err: "pas de métadonnées", types };
}
for (let i = 0; i < list.length; i += 50) {
  const b = list.slice(i, i + 50);
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [b.map((x) => x[1]), { encoding: "base64" }] }), signal: AbortSignal.timeout(20000) });
    out.rpc.push(r.status);
    const j = await r.json();
    const vals = j.result?.value || [];
    b.forEach(([k, m], x) => {
      const v = vals[x];
      const o = (out.coins[k] = { mint: m });
      if (!v) { o.account = false; return; }
      o.owner = v.owner; o.token22 = v.owner === T22;
      const buf = Buffer.from(v.data[0], "base64"); o.len = buf.length;
      if (o.token22) o.meta = parse22(buf);
    });
  } catch (e) { out.rpc.push(String(e.message || e)); }
  await wait(1200);
}
for (const [k, o] of Object.entries(out.coins)) {
  const uri = o.meta?.uri;
  if (!uri) continue;
  if (!/^https?:\/\//.test(uri)) { o.json = "uri non http: " + uri.slice(0, 40); continue; }
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
await writeFile("probe.json", JSON.stringify(out, null, 1));
console.log("ok", list.length);
