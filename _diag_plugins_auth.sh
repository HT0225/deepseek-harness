#!/bin/bash
set -u
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "=== 1. 登录 3080 拿 cookie ==="
LOGIN_RESP=$(node - <<'NODE'
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
    const cs = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    fs.writeFileSync('/tmp/dsh_cookie2.txt', cs);
    process.stdout.write(JSON.stringify({ status: res.statusCode, cookie: cs, body: b }));
  });
});
req.write(data);
req.end();
NODE
)
echo "$LOGIN_RESP"
COOKIE=$(cat /tmp/dsh_cookie2.txt)

echo
echo "=== 2. 获取首页，看实际注入的 preload batch URL (从HTML里提取) ==="
IDX=$(node - "$COOKIE" <<'NODE'
const http = require('http');
const cookie = process.argv[2] || '';
const req = http.request({
  hostname: '127.0.0.1', port: 3080, method: 'GET', path: '/',
  headers: { Cookie: cookie, 'X-Forwarded-Prefix': '/deepseek-harness' }
}, (res) => {
  let b = '';
  res.setEncoding('utf8');
  res.on('data', (c) => { b += c; });
  res.on('end', () => { process.stdout.write(b); });
});
req.end();
NODE
)
# 提取 preload href 第一个 batch URL (相对路径形式 ./plugins/??...)
BOOTSTRAP_SRC=$(echo "$IDX" | grep -oE '<script src="\./plugins/\?\?[^"]+"' | head -1 | sed 's/<script src=".\/plugins/\/plugins/;s/"$//')
PRELOAD_HREF=$(echo "$IDX" | grep -oE '<link rel="preload"[^>]*href="\./plugins/\?\?[^"]+"' | head -1 | grep -oE '\./plugins/\?\?[^"]+' | head -1 | sed 's/^\.//')
echo "Bootstrap /plugins URL = $BOOTSTRAP_SRC"
echo "First preload /plugins URL = $PRELOAD_HREF"

echo
echo "=== 3. 不带 cookie 请求 bootstrap URL (rev=28e1db08b1d0) ==="
curl -sS -o /tmp/a.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
  "http://127.0.0.1:3080/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=28e1db08b1d0"
echo "Response body: "; head -c 200 /tmp/a.txt; echo

echo
echo "=== 4. 带 cookie 请求 bootstrap URL (rev=旧版) ==="
curl -sS -o /tmp/a2.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
  -H "Cookie: $COOKIE" \
  "http://127.0.0.1:3080/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=28e1db08b1d0"
echo "Response body: "; head -c 200 /tmp/a2.txt; echo

echo
echo "=== 5. 带 cookie 请求首页实际的 bootstrap URL (新rev) ==="
curl -sS -o /tmp/a3.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
  -H "Cookie: $COOKIE" \
  "http://127.0.0.1:3080$BOOTSTRAP_SRC"
echo "Response head (200 bytes): "; head -c 200 /tmp/a3.txt; echo

echo
echo "=== 6. 带 cookie 请求首页实际 preload URL ==="
curl -sS -o /tmp/a4.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
  -H "Cookie: $COOKIE" \
  "http://127.0.0.1:3080$PRELOAD_HREF"
echo "Response head: "; head -c 200 /tmp/a4.txt; echo
