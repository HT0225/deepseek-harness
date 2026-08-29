#!/bin/bash
set -u
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

node - <<'NODE'
const http = require('http');

const POST = (path, data, headers = {}) => new Promise((resolve, reject) => {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
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
  // 1. Login
  const login = await POST('/login.json', { password: '13586282293qAz' });
  console.log('1. Login:', login.status);
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  console.log('   Cookie length:', cookie.length);

  // 2. Fetch index
  const idx = await GET('/', { Cookie: cookie, 'X-Forwarded-Prefix': '/deepseek-harness' });
  const html = idx.body.toString('utf8');
  console.log('2. Index:', idx.status, 'bytes=' + html.length);

  // 3. Extract base + bootstrap script src + preloads
  const base = html.match(/<base href="([^"]*)"/)?.[1];
  console.log('3. Base href =', base);
  const allScriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => htmlUnescape(m[1]));
  const allPreloads = [...html.matchAll(/<link rel="preload"[^>]*href="([^"]+)"/g)].map((m) => htmlUnescape(m[1]));
  // Find client-modules bootstrap src (should be relative plugins combo)
  const bootstrapSrc = allScriptSrcs.find((s) => s.includes('client-modules') || s.includes('/plugins/??'));
  console.log('4. Bootstrap (client-modules) script src:', bootstrapSrc);
  console.log('   Preload sample:', allPreloads[0]?.slice(0, 160));

  // 4. Request via absolute path (no . prefix)
  const absBootstrap = bootstrapSrc.startsWith('.') ? bootstrapSrc.replace(/^\./, '') : bootstrapSrc;
  const urlObj = new URL('http://x' + absBootstrap);
  const realPath = urlObj.pathname + urlObj.search; // decode entities back, no double-encoded &amp;
  console.log('5. Requesting plugin combo URL:', realPath.slice(0, 180));
  const res = await GET(realPath, { Cookie: cookie });
  console.log('   GET status=' + res.status + ' bytes=' + res.body.length + ' type=' + (res.headers['content-type'] || ''));
  if (res.status !== 200) {
    console.log('   RETRY: requesting the ALL preloads URLs to see if any returns 200...');
    for (const p of allPreloads.slice(0, 3)) {
      const abs = p.startsWith('.') ? p.replace(/^\./, '') : p;
      const u = new URL('http://x' + abs);
      const rl = u.pathname + u.search;
      const r2 = await GET(rl, { Cookie: cookie });
      console.log('   - status=' + r2.status + ' bytes=' + r2.body.length + ' path=' + rl.slice(0, 100));
      if (r2.status === 200) { console.log('   OK, first 80 bytes head:', r2.body.slice(0, 80).toString('utf8')); break; }
    }
  } else {
    console.log('   Body head (160 bytes):', res.body.slice(0, 160).toString('utf8'));
  }

  // 5. Also try combo for a single well-known package id without &rev (match exact responses key)
  const trySingle = '/plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=placeholder';
  // skip - we know responses keyed by exact pathname+search including real rev
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
NODE
