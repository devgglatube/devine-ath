import { writeFile, readFile } from "node:fs/promises";
const cs = JSON.parse(await readFile("coins.json", "utf8")).filter((c) => c.id).slice(0, 14);
const ms = [{ n: "EXEMPLE", id: "FBcrTWLEVTxKuc67LLiN2DwUQ6JrPjNyz5MY5iBMpump" }, ...cs];
const out = [];
for (const c of ms) {
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${c.id}/info`, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const a = j?.data?.attributes || {};
    out.push({ n: c.n, status: r.status, holders: a.holders, score: a.gt_score, ca: a.gt_score_details });
  } catch (e) { out.push({ n: c.n, error: String(e) }); }
}
await writeFile("artifact/rpc-diag.json", JSON.stringify(out, null, 1));
