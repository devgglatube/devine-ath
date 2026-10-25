import { writeFile } from "node:fs/promises";
const out = [];
const EPS = ["https://solana-rpc.publicnode.com","https://solana.drpc.org","https://rpc.ankr.com/solana","https://solana.api.onfinality.io/public","https://api.mainnet.solana.com","https://endpoints.omniatech.io/v1/sol/mainnet/public","https://solana.therpc.io","https://solana-mainnet.rpc.extrnode.com"];
for (const RPC of EPS) for (const m of ["6bW6xsZxYqcvqabk9rRgQwgjPNwe8SACPusx5o1wpump"]) {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [m] }), signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    out.push({ RPC, status: r.status, body: t.slice(0, 250) });
  } catch (e) { out.push({ RPC, error: String(e) }); }
  await new Promise((r) => setTimeout(r, 2000));
}
await writeFile("artifact/rpc-diag.json", JSON.stringify(out, null, 1));
