import { writeFile } from "node:fs/promises";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const urls = {
  t1: "https://api.fxtwitter.com/zumpsol/status/2113707399198503265",
  t2: "https://api.fxtwitter.com/imBilngineer/status/2113353187541545094",
  t3: "https://api.fxtwitter.com/uncquant/status/2113831195284808001",
  p1: "https://api.fxtwitter.com/alloxdotai",
  p2: "https://api.fxtwitter.com/kimchi1x",
  p3: "https://api.fxtwitter.com/NamiAgent",
};
for (const [k, u] of Object.entries(urls)) {
  try { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }); out[k] = { status: r.status, json: await r.json().catch(() => null) }; }
  catch (e) { out[k] = { error: e.message }; }
  await wait(800);
}
await writeFile("probe.json", JSON.stringify(out, null, 1));
