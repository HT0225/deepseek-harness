#!/bin/bash
set -u
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "=== 1. 再等 15 秒 ==="
/bin/sleep 15

echo
echo "=== 2. 最近 45s 日志(无 ERR_MODULE_NOT_FOUND 为成功) ==="
sudo journalctl -u dsh-official --no-pager -n 40 --since '45 sec ago' 2>&1 | /usr/bin/tail -40
echo "ERR count:"
sudo journalctl -u dsh-official --no-pager --since '45 sec ago' 2>&1 | /bin/grep -c 'ERR_MODULE_NOT_FOUND' || echo 0

echo
echo "=== 3. ~/.dsh/profiles 重建状态 ==="
/bin/ls -la ~/.dsh/profiles 2>&1 | /usr/bin/head -10
echo "profiles/node_modules/@deepseek-ai 插件数:"
/bin/ls ~/.dsh/profiles/node_modules/@deepseek-ai 2>/dev/null | /usr/bin/wc -l

echo
echo "=== 4. 登录 + 获取首页真实 plugins URL + 带 cookie 请求 200 ==="
node - <<'NODE' >/tmp/step4.txt
const http = require('http');
const fs = require('fs');

const cookiePromise = new Promise((resolve, reject) => {
  const data = JSON.stringify({ password: '13586282293qAz' });
  const req = http.request({
    hostname: '127.0.0.1', port: 3080, method: 'POST', path: '/login.json',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, (res) => {
    let b = '';
    res.setEncoding('utf8');
    res.on('data', (c) => (b += c));
    res.on('end', () => {
      const cs = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
      resolve({ status: res.statusCode, cookie: cs, body: b });
    });
  });
  req.on('error', reject);
  req.write(data);
  req.end();
});

(async () => {
  const login = await cookiePromise;
  fs.writeFileSync('/tmp/c4.txt', login.cookie);
  console.log('login status=' + login.status);
  const idx = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 3080, method: 'GET', path: '/',
      headers: { Cookie: login.cookie, 'X-Forwarded-Prefix': '/deepseek-harness' }
    }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.end();
  });
  // 提取 bootstrap script src
  const bsMatch = idx.match(/<script src="(\.\/plugins\/\?\?[^"]+client\.js[^"]*)"/);
  const bootstrapUrl = bsMatch ? bsMatch[1].replace(/^\./, '') : '';
  const preMatch = idx.match(/<link rel="preload"[^>]*href="(\.\/plugins\/\?\?[^"]+)"/);
  const preloadUrl = preMatch ? preMatch[1].replace(/^\./, '') : '';
  console.log('bootstrap plugins path = ' + bootstrapUrl);
  console.log('first preload plugins path (start) = ' + preloadUrl.slice(0, 120));
  fs.writeFileSync('/tmp/urls4.txt', JSON.stringify({ bootstrapUrl, preloadUrl }));

  // 实际请求 bootstrap URL
  const serve = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 3080, method: 'GET', path: bootstrapUrl,
      headers: { Cookie: login.cookie }
    }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, bytes: body.length, type: res.headers['content-type'] || '', head: body.slice(0, 140).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
  console.log('GET bootstrap URL: status=' + serve.status + ' bytes=' + serve.bytes + ' type=' + serve.type);
  console.log('body head: ' + serve.head);
})().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
NODE
/bin/cat /tmp/step4.txt
