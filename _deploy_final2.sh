#!/bin/bash
set -eu
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PNPM="node /home/ubuntu/.local/lib/node_modules/pnpm/bin/pnpm.cjs"
APP_DIR="/home/ubuntu/projects/deepseek-harness-official"

echo "=== 1. Git pull c61a17d ==="
cd "$APP_DIR"
git pull origin lht --ff-only 2>&1 | tail -5

echo
echo "=== 2. pnpm run build (install skipped - unchanged) ==="
$PNPM run build 2>&1 | /usr/bin/tail -20

echo
echo "=== 3. Clean profiles cache & restart service ==="
/bin/rm -rf ~/.dsh/profiles
sudo systemctl restart dsh-official
/bin/sleep 2
echo "Service status:"; sudo systemctl is-active dsh-official

echo
echo "=== 4. 等待 35s 让 profile cache 重建 + 插件 flush ==="
/bin/sleep 35
echo "journal (last 12 lines):"
sudo journalctl -u dsh-official --no-pager -n 12 --since '50 sec ago' 2>&1 | /usr/bin/tail -15

echo
echo "=== 5. SMOKE: 登录 + / + 提取 bootstrap combo URL 并验证 ==="
node - <<'NODE'
const http = require('http');
const POST = (path, data, headers = {}) => new Promise((resolve, reject) => {
  const body = JSON.stringify(data);
  const req = http.request({
    hostname: '127.0.0.1', port: 3080, method: 'POST', path,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers)
  }, (res) => {
    let b = '';
    res.setEncoding('utf8');
    res.on('data', (c) => (b += c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});
const GET = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port: 3080, method: 'GET', path, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});
const htmlUnescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

(async () => {
  const login = await POST('/login.json', { password: '13586282293qAz' });
  console.log('Login:', login.status);
  if (login.status !== 200) { console.log('login body:', login.body.slice(0, 200)); return; }
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const idx = await GET('/', { Cookie: cookie, 'X-Forwarded-Prefix': '/deepseek-harness' });
  const html = idx.body.toString('utf8');
  const base = html.match(/<base href="([^"]*)"/)?.[1];
  console.log('Index:', idx.status, 'base href =', base);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => htmlUnescape(m[1]));
  const preloads = [...html.matchAll(/<link rel="preload"[^>]*href="([^"]+)"/g)].map((m) => htmlUnescape(m[1]));
  console.log('Scripts total:', scripts.length, 'Preloads total:', preloads.length);
  const firstCombo = preloads.find((x) => x.includes('/??')) || scripts.find((x) => x.includes('/??'));
  if (!firstCombo) { console.log('No combo URL found in HTML. First script:', scripts[0]?.slice(0, 100)); return; }
  console.log('First combo src (160):', firstCombo.slice(0, 160));
  const abs = firstCombo.startsWith('.') ? firstCombo.replace(/^\./, '') : firstCombo;
  const u = new URL('http://x' + abs);
  const realPath = u.pathname + u.search;
  console.log('Canonical request (160):', realPath.slice(0, 160));
  const r1 = await GET(realPath, { Cookie: cookie });
  console.log('GET status=' + r1.status + ' bytes=' + r1.body.length + ' type=' + (r1.headers['content-type'] || ''));
  if (r1.status === 200) console.log('BODY HEAD:', r1.body.slice(0, 120).toString('utf8'));
  // all combos
  const allUrls = [...preloads, ...scripts].filter((x) => x.includes('/??'));
  let ok = 0, bad = 0;
  for (const url of allUrls.slice(0, 8)) {
    const a = url.startsWith('.') ? url.replace(/^\./, '') : url;
    const uu = new URL('http://x' + a);
    const rp = uu.pathname + uu.search;
    const r = await GET(rp, { Cookie: cookie });
    (r.status === 200 ? ok++ : bad++);
  }
  console.log('Checked ' + allUrls.slice(0, 8).length + ' combo URLs. 200 OK=' + ok + ' failed=' + bad);
  // last check: external access via nginx 5001 subpath
  if (bad === 0) {
    const nginxUrl = 'http://127.0.0.1:5001/deepseek-harness' + abs;
    console.log('External nginx URL preview:', nginxUrl.slice(0, 160));
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
NODE
