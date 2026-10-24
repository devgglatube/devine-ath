import { readFile, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const coins = JSON.parse(await readFile("coins.json", "utf8"));
let camap = {}; try { camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
const list = coins.map((c) => ({ k: `${c.t}|${c.n}`, m: c.id || camap[`${c.t}|${c.n}`] || "" })).filter((x) => x.m);
const out = { n: list.length, dex: {}, meta: {}, tweets: {}, errors: [] };
// 1) DexScreener : réseaux sociaux
for (let i = 0; i < list.length; i += 30) {
  const b = list.slice(i, i + 30);
  try {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${b.map((x) => x.m).join(",")}`);
    const j = await r.json();
    for (const p of j) { const m = p.baseToken?.address; if (m && !out.dex[m]) out.dex[m] = { socials: p.info?.socials || [], websites: p.info?.websites || [] }; }
  } catch (e) { out.errors.push("dex:" + e.message); }
  await wait(500);
}
// 2) Métadonnées Metaplex (adresse du fichier JSON du token) puis champs twitter/website
const MPL = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const str = (buf, o) => { const n = buf.readUInt32LE(o); return [buf.subarray(o + 4, o + 4 + n).toString("utf8").replace(/\0+$/, ""), o + 4 + n]; };
for (let i = 0; i < list.length; i += 50) {
  const b = list.slice(i, i + 50);
  const pdas = b.map((x) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL.toBuffer(), new PublicKey(x.m).toBuffer()], MPL)[0].toBase58());
  let vals = [];
  try {
    const r = await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [pdas, { encoding: "base64" }] }) });
    vals = (await r.json()).result?.value || [];
  } catch (e) { out.errors.push("rpc:" + e.message); }
  for (let k = 0; k < b.length; k++) {
    const v = vals[k]; if (!v) continue;
    try {
      const buf = Buffer.from(v.data[0], "base64"); let o = 1 + 32 + 32; let name, sym, uri;
      [name, o] = str(buf, o); [sym, o] = str(buf, o); [uri, o] = str(buf, o);
      const rec = { uri };
      const cid = uri.match(/ipfs\/([^/?#]+)/)?.[1];
      const urls = [uri, cid && `https://ipfs.io/ipfs/${cid}`, cid && `https://cloudflare-ipfs.com/ipfs/${cid}`, cid && `https://gateway.pinata.cloud/ipfs/${cid}`].filter(Boolean);
      for (const u of urls) {
        try { const r2 = await fetch(u, { signal: AbortSignal.timeout(12000) }); if (!r2.ok) { rec.err = `${u.split("/")[2]}:${r2.status}`; continue; } const j = await r2.json(); rec.twitter = j.twitter || ""; rec.website = j.website || ""; rec.telegram = j.telegram || ""; rec.err = ""; break; }
        catch (e) { rec.err = `${u.split("/")[2]}:${e.message}`; }
      }
      out.meta[b[k].m] = rec;
    } catch (e) { out.errors.push("parse:" + e.message); }
  }
  await wait(1500);
}
// 3) liens de tweets trouvés -> contenu via FxTwitter et syndication
const re = /(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/i;
const found = [];
for (const m of Object.keys({ ...out.dex, ...out.meta })) {
  const cands = [...(out.dex[m]?.socials || []).map((s) => s.url), out.meta[m]?.twitter].filter(Boolean);
  for (const u of cands) { const x = re.exec(u); if (x) { found.push({ m, user: x[1], id: x[2] }); break; } }
}
out.stats = { coins: list.length, dex_twitter: Object.values(out.dex).filter((d) => d.socials.some((s) => s.type === "twitter")).length, meta_twitter: Object.values(out.meta).filter((d) => d.twitter).length, meta_uri_ok: Object.values(out.meta).filter((d) => d.twitter !== undefined).length, status_links: found.length };
for (const f of found.slice(0, 6)) {
  const tok = ((Number(f.id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  for (const [name, u] of [["fx", `https://api.fxtwitter.com/${f.user}/status/${f.id}`], ["syn", `https://cdn.syndication.twimg.com/tweet-result?id=${f.id}&lang=en&token=${tok}`]]) {
    try { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }); out.tweets[`${f.m}|${name}`] = { status: r.status, body: (await r.text()).slice(0, 1800) }; }
    catch (e) { out.tweets[`${f.m}|${name}`] = { error: e.message }; }
    await wait(800);
  }
}
await writeFile("probe.json", JSON.stringify(out, null, 1));
