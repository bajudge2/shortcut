// Generates a printable sheet of QR codes, one per graph node.
//   npm run qr                              -> qr-codes/index.html  (payload "cnav:<nodeId>", for the iOS app scanner)
//   npm run qr -- --url https://your.app    -> payload "https://your.app/?at=<nodeId>" (works with the iPhone Camera app / Safari)
//   npm run qr -- --only f1_j2,f2_stairs    -> only these nodes
import fs from 'node:fs';
import QRCode from 'qrcode';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const baseUrl = opt('url');
const only = opt('only')?.split(',');

const building = JSON.parse(fs.readFileSync(new URL('../src/data/building.json', import.meta.url), 'utf8'));
const nodes = building.nodes.filter((n) => !only || only.includes(n.id));
const payload = (id) => (baseUrl ? `${baseUrl.replace(/\/$/, '')}/?at=${encodeURIComponent(id)}` : `cnav:${id}`);

let html = `<!doctype html><meta charset="utf-8"><title>Shortcut QR codes</title>
<style>body{font-family:system-ui;margin:16px}.grid{display:flex;flex-wrap:wrap;gap:12px}
.c{width:220px;border:1px solid #999;padding:8px;text-align:center;page-break-inside:avoid}
.c img{width:200px;height:200px}.n{font-weight:700;font-size:16px}.i{font-size:11px;color:#555}h2{margin:18px 0 8px}</style>
<h1>${building.name}</h1>`;

for (const floor of building.floors) {
  html += `<h2>${floor.label}</h2><div class="grid">`;
  for (const n of nodes.filter((x) => x.floor === floor.id)) {
    const dataUrl = await QRCode.toDataURL(payload(n.id), { margin: 1, width: 400, errorCorrectionLevel: 'M' });
    html += `<div class="c"><img src="${dataUrl}"><div class="n">${n.name ?? n.kind}</div><div class="i">${n.id}</div></div>`;
  }
  html += '</div>';
}
fs.mkdirSync(new URL('../qr-codes/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../qr-codes/index.html', import.meta.url), html);
console.log(`Wrote qr-codes/index.html (${nodes.length} codes). Open it in a browser and print.`);
