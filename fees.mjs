// Lit sur la blockchain (programme Pump Fees) la configuration de partage des fees de chaque coin pump.fun.
// Résultat : champ "fs" = { s: 1 si le partage est actif, sh: [[wallet, part en 1/10000], ...] }. Sans config : pas de champ.
import { readFile, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseConfig(raw) {
  // 8 octets d'ancre, bump, version, statut, mint (32), admin (32), admin révoqué (1), liste des bénéficiaires
  let o = 8 + 3 + 32 + 32 + 1;
  const status = raw[10];
  const n = raw.readUInt32LE(o); o += 4;
  if (n > 10) return null;
  const sh = [];
  for (let i = 0; i < n; i++) {
    if (o + 34 > raw.length) return null;
    sh.push([new PublicKey(raw.subarray(o, o + 32)).toBase58(), raw.readUInt16LE(o + 32)]);
    o += 34;
  }
  return { s: status === 1 ? 1 : 0, sh };
}

if (process.argv[1] && process.argv[1].endsWith("fees.mjs")) {
  const coins = JSON.parse(await readFile("coins.json", "utf8"));
  let camap = {};
  try { camap = JSON.parse(await readFile("artifact/ca-map.json", "utf8")); } catch {}
  const addrOf = (c) => c.id || camap[`${c.t}|${c.n}`] || "";
  const todo = coins.filter((c) => /pump$/.test(addrOf(c)));
  let changed = 0, found = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const pdas = batch.map((c) => PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), new PublicKey(addrOf(c)).toBuffer()], PROGRAM)[0].toBase58());
    let values;
    try {
      const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [pdas, { encoding: "base64" }] }), signal: AbortSignal.timeout(20000) });
      values = (await res.json()).result?.value;
      if (!Array.isArray(values)) throw new Error("réponse inattendue");
    } catch (e) { console.log("lot ignoré :", String(e.message || e)); await wait(2000); continue; }
    batch.forEach((c, k) => {
      const v = values[k];
      if (!v || v.owner !== PROGRAM.toBase58()) return; // pas de config (ou lot partiel) : on ne touche à rien
      const cfg = parseConfig(Buffer.from(v.data[0], "base64"));
      if (!cfg) return;
      found++;
      if (JSON.stringify(c.fs) !== JSON.stringify(cfg)) { c.fs = cfg; changed++; }
    });
    await wait(1500);
  }
  if (changed) await writeFile("coins.json", JSON.stringify(coins, null, 1));
  console.log(`${found} coin(s) avec partage de fees, ${changed} mis à jour`);
}
