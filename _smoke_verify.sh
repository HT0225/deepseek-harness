#!/bin/bash
set -u
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

COOKIE=/tmp/dsh_cookie.txt
rm -f "$COOKIE"

echo "=== 1. 登录 ==="
node - <<'NODE'
const http = require('http');
const fs = require('fs');
const data = JSON.stringify({ password: '13586282293qAz' });
const req = http.request({
  hostname: '127.0.0.1', port: 3080, method: 'POST', path: '/login.json',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, (res) => {
  let b = '';
  res.setEncoding('utf8');
  res.on('data', (c) => { b += c; });
  res.on('end', () => {
    console.log('HTTP=' + res.statusCode);
    const cs = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    fs.writeFileSync('/tmp/dsh_cookie.txt', cs);
    console.log('COOKIE_LEN=' + cs.length);
    console.log('BODY=' + b.slice(0, 200));
  });
});
req.write(data);
req.end();
NODE

echo
echo "=== 2. 带 cookie 和 X-Forwarded-Prefix 拉取首页 ==="
COOKIE_STR=$(cat /tmp/dsh_cookie.txt 2>/dev/null)
echo "Using cookie len=${#COOKIE_STR}"

node - "$COOKIE_STR" <<'NODE'
const http = require('http');
const cookie = process.argv[2] || '';
const req = http.request({
  hostname: '127.0.0.1', port: 3080, method: 'GET', path: '/',
  headers: { Cookie: cookie, 'X-Forwarded-Prefix': '/deepseek-harness' }
}, (res) => {
  let b = '';
  res.setEncoding('utf8');
  res.on('data', (c) => { b += c; });
  res.on('end', () => {
    console.log('HTTP=' + res.statusCode + ' size=' + b.length);
    const base = b.match(/<base href="([^"]*)"/);
    console.log('base href = ' + (base ? base[1] : '(not found)'));
    const preloads = [...b.matchAll(/<link rel="preload"[^>]*href="([^"]*)"/g)].map((m) => m[1]).slice(0, 5);
    console.log('preload hrefs (first 5):');
    for (const p of preloads) console.log('  - ' + p);
    const scripts = [...b.matchAll(/<script src="([^"]*)"/g)].map((m) => m[1]).slice(0, 5);
    console.log('script srcs (first 5):');
    for (const s of scripts) console.log('  - ' + s);
    console.log('Absolute /plugins refs in href count = ' +
      (b.match(/href="\/plugins/g) || []).length);
    console.log('Relative ./plugins refs in href count = ' +
      (b.match(/href="\.\/plugins/g) || []).length);
  });
});
req.end();
NODE
