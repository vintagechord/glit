#!/usr/bin/env node
// Tell IndexNow search engines (Naver, Bing and others) that public pages
// changed. Run after a production deploy that changes public content:
//   node scripts/seo/indexnow-submit.mjs            (all sitemap URLs)
//   node scripts/seo/indexnow-submit.mjs /guide/album-review /faq
// The key file public/d107e0fa30e94dd29616f063b5c9f1b4.txt proves ownership; the key is public by design.
const key = "d107e0fa30e94dd29616f063b5c9f1b4";
const origin = process.env.INDEXNOW_ORIGIN ?? "https://iamonside.com";
const host = new URL(origin).host;
const explicit = process.argv.slice(2);
let urls = explicit.map((path) => new URL(path, origin).toString());
if (!urls.length) {
  const xml = await (await fetch(`${origin}/sitemap.xml`)).text();
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}
const keyCheck = await fetch(`${origin}/${key}.txt`);
if (!keyCheck.ok || (await keyCheck.text()).trim() !== key) throw new Error("The IndexNow key file is not live yet; deploy first.");
const body = JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls });
for (const endpoint of ["https://api.indexnow.org/indexnow", "https://searchadvisor.naver.com/indexnow"]) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body });
  console.log(JSON.stringify({ endpoint, status: response.status, urls: urls.length }));
}
