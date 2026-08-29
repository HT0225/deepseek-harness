#!/bin/bash
set -eu
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PNPM="node /home/ubuntu/.local/lib/node_modules/pnpm/bin/pnpm.cjs"
APP_DIR="/home/ubuntu/projects/deepseek-harness-official"

echo "=== 1. Git pull (expect fad145e) ==="
cd "$APP_DIR"
git pull origin lht --ff-only
git --no-pager log --oneline -2

echo
echo "=== 2. pnpm install ==="
$PNPM install --frozen-lockfile=false 2>&1 | /usr/bin/tail -5

echo
echo "=== 3. pnpm run build ==="
$PNPM run build 2>&1 | /usr/bin/tail -20

echo
echo "=== 4. Clean ~/.dsh/profiles cache ==="
/bin/rm -rf ~/.dsh/profiles
echo "Done"

echo
echo "=== 5. systemctl restart dsh-official ==="
sudo systemctl restart dsh-official
/bin/sleep 3
sudo systemctl is-active dsh-official
echo "Active PID:"
pgrep -f "bin.js web.*--port 3080" | head -1

echo
echo "=== 6. 等待 20s 让 profile cache 重建 + 插件激活 flush 完成 ==="
/bin/sleep 20
sudo journalctl -u dsh-official --no-pager -n 12 --since '35 sec ago' 2>&1 | /usr/bin/tail -15
echo "ERR_MODULE_NOT_FOUND count:"
sudo journalctl -u dsh-official --no-pager --since '35 sec ago' 2>&1 | /bin/grep -c 'ERR_MODULE_NOT_FOUND' || echo 0

echo
echo "=== 7. 最终 smoke: 登录 + 首页 + bootstrap combo URL 200 ==="
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
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const idx = await GET('/', { Cookie: cookie, 'X-Forwarded-Prefix': '/deepseek-harness' });
  const html = idx.body.toString('utf8');
  const base = html.match(/<base href="([^"]*)"/)?.[1];
  console.log('Index:', idx.status, 'base href =', base);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => htmlUnescape(m[1]));
  const preloads = [...html.matchAll(/<link rel="preload"[^>]*href="([^"]+)"/g)].map((m) => htmlUnescape(m[1]));
  const bootstrap = scripts.find((s) => s.includes('client-modules')) || scripts.find((s) => s.startsWith('./plugins/??'));
  console.log('Bootstrap script src (first 160):', bootstrap?.slice(0, 160));
  const absBootstrap = bootstrap?.startsWith('.') ? bootstrap.replace(/^\./, '') : bootstrap;
  const u = new URL('http://x' + absBootstrap);
  const realPath = u.pathname + u.search;
  console.log('Request canonical:', realPath.slice(0, 160));
  const res = await GET(realPath, { Cookie: cookie });
  console.log('GET bootstrap status=' + res.status + ' bytes=' + res.body.length + ' type=' + (res.headers['content-type'] || ''));
  if (res.status === 200) console.log('BODY HEAD:', res.body.slice(0, 120).toString('utf8'));
  // preload batch hit/miss
  if (preloads[0]) {
    const ap = preloads[0].startsWith('.') ? preloads[0].replace(/^\./, '') : preloads[0];
    const up = new URL('http://x' + ap);
    const rp = up.pathname + up.search;
    const r2 = await GET(rp, { Cookie: cookie });
    console.log('Preload[0] status=' + r2.status + ' bytes=' + r2.body.length);
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
NODE
