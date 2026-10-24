// Télécharge le logo des coins de coins.json dans artifact/coins-img.json (la version claude.ai bloque les images externes).
// Chaque logo est réduit (128 px, WebP) avec sharp ; plusieurs sources sont essayées si la première échoue.
import { readFile, writeFile } from "node:fs/promises";
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { console.log("sharp absent : logos gardés tels quels (limite 120 Ko)"); }
const coins = JSON.parse(await readFile("coins.json", "utf8"));
let camap = {};
try { camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
let map = {};
try { map = JSON.parse(await readFile("artifact/coins-img.json", "utf8")); } catch {}
const keys = new Set(coins.map((c) => `${c.t}|${c.n}`));
for (const k of Object.keys(map)) if (!keys.has(k)) delete map[k]; // on retire les coins qui ne sont plus dans la liste

async function shrink(buf, type) {
  if (!sharp) { if (buf.length > 120000) throw new Error("trop lourd"); return `data:${type};base64,${buf.toString("base64")}`; }
  const out = await sharp(buf, { animated: false }).resize(128, 128, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  return `data:image/webp;base64,${out.toString("base64")}`;
}
async function grab(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("Erreur " + r.status);
  const type = (r.headers.get("content-type") || "").split(";")[0];
  if (!type.startsWith("image/")) throw new Error("pas une image");
  return [Buffer.from(await r.arrayBuffer()), type];
}
// 1) réduire les logos déjà enregistrés mais trop lourds (une seule fois)
if (sharp) for (const [k, v] of Object.entries(map)) {
  if (v.length < 25000 && v.startsWith("data:image/webp")) continue;
  try { const [, b64] = v.split(","); map[k] = await shrink(Buffer.from(b64, "base64"), "image/png"); } catch (e) { console.log("non réduit", k, e.message); }
}
// 2) logos manquants : GeckoTerminal/CoinGecko, puis DexScreener, puis pump.fun
for (const c of coins) {
  const key = `${c.t}|${c.n}`;
  if (map[key]) continue;
  const mint = c.id || camap[key] || "";
  const urls = [c.img, mint && `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`, mint && /pump$/.test(mint) && `https://images.pump.fun/coin-image/${mint}?imageWidth=128`].filter(Boolean);
  for (const u of urls) {
    try { const [buf, type] = await grab(u); map[key] = await shrink(buf, type); break; }
    catch (e) { console.log("ignoré", c.t, u.split("/")[2], e.message); }
  }
}
await writeFile("artifact/coins-img.json", JSON.stringify(map));
console.log("logos :", Object.keys(map).length, "/", coins.length);
