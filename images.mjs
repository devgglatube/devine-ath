// Télécharge le logo des coins de coins.json dans artifact/coins-img.json (la version claude.ai bloque les images externes).
import { readFile, writeFile } from "node:fs/promises";
const coins = JSON.parse(await readFile("coins.json", "utf8"));
let map = {};
try { map = JSON.parse(await readFile("artifact/coins-img.json", "utf8")); } catch {}
const keys = new Set(coins.map((c) => `${c.t}|${c.n}`));
for (const k of Object.keys(map)) if (!keys.has(k)) delete map[k]; // on retire les coins qui ne sont plus dans la liste
for (const c of coins) {
  const key = `${c.t}|${c.n}`;
  if (!c.img || map[key]) continue;
  try {
    const r = await fetch(c.img, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("Erreur " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 80000) throw new Error("trop lourd");
    const type = (r.headers.get("content-type") || "image/png").split(";")[0];
    map[key] = `data:${type};base64,${buf.toString("base64")}`;
  } catch (e) { console.log("ignoré", c.t, e.message); }
}
await writeFile("artifact/coins-img.json", JSON.stringify(map));
console.log("logos :", Object.keys(map).length);
