import { readFile, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
const coins = JSON.parse(await readFile("coins.json", "utf8"));
const im = JSON.parse(await readFile("artifact/coins-img.json", "utf8"));
const out = { logos: {}, fees: {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// 1) autres sources de logos pour les coins sans logo
for (const c of coins.filter((c) => c.id && !im[`${c.t}|${c.n}`])) {
  const urls = [`https://dd.dexscreener.com/ds-data/tokens/solana/${c.id}.png`, `https://images.pump.fun/coin-image/${c.id}?imageWidth=128`, `https://api.dexscreener.com/tokens/v1/solana/${c.id}`];
  for (const u of urls) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); const b = Buffer.from(await r.arrayBuffer()); let extra = ""; if (u.includes("tokens/v1")) { try { extra = JSON.parse(b.toString())[0]?.info?.imageUrl || ""; } catch {} }
      out.logos[`${c.t}|${u.split("/")[2]}`] = { status: r.status, type: r.headers.get("content-type"), bytes: b.length, extra }; } catch (e) { out.logos[`${c.t}|${u.split("/")[2]}`] = { error: String(e.message) }; }
    await wait(500);
  }
}
// 2) config de partage des fees pump.fun (programme Pump Fees) : existe-t-elle pour ces coins ?
const PROGRAMS = ["pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"];
const ids = coins.map((c) => c.id).filter(Boolean);
for (const prog of PROGRAMS) {
  const pdas = ids.map((m) => PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), new PublicKey(m).toBuffer()], new PublicKey(prog))[0].toBase58());
  for (let i = 0; i < pdas.length; i += 50) {
    try {
      const res = await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [pdas.slice(i, i + 50), { encoding: "base64" }] }), signal: AbortSignal.timeout(20000) });
      const j = await res.json();
      (j.result?.value || []).forEach((v, k) => { out.fees[ids[i + k]] = v ? { owner: v.owner, len: Buffer.from(v.data[0], "base64").length, b64: v.data[0].slice(0, 700) } : null; });
      if (!j.result) out.fees._error = JSON.stringify(j).slice(0, 300);
    } catch (e) { out.fees._error = String(e.message); }
    await wait(1500);
  }
}
await writeFile("probe.json", JSON.stringify(out, null, 1));
