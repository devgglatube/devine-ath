import { writeFile } from "node:fs/promises";
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const out = [];
for (const m of ["FBcrTWLEVTxKuc67LLiN2DwUQ6JrPjNyz5MY5iBMpump", "HVCX2j4mch83a1sxtC2gjLeamGp3Z6bD8j8b2kqTG8ZA", "6bW6xsZxYqcvqabk9rRgQwgjPNwe8SACPusx5o1wpump"]) {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [m] }), signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    out.push({ m, status: r.status, body: t.slice(0, 600) });
  } catch (e) { out.push({ m, error: String(e) }); }
  await new Promise((r) => setTimeout(r, 2000));
}
await writeFile("artifact/rpc-diag.json", JSON.stringify(out, null, 1));
