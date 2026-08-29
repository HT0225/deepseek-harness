// 模拟浏览器 combo URL 请求：先请求首页获取 cookie，再请求 preload/script URL
const http = require('http');
const POST = (host, port, path, data, headers = {}) => new Promise((resolve, reject) => {
  const body = JSON.stringify(data);
  const req = http.request({ hostname: host, port, method: 'POST', path,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers)
  }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
  req.on('error', reject); req.write(body); req.end();
});
const GET = (host, port, path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: host, port, method: 'GET', path, headers }, (res) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
  req.on('error', reject); req.end();
});
const htmlUnescape = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

(async () => {
  // A. 通过 Nginx 5001 走完整流程（和浏览器完全一致）
  console.log('===== [1] 通过 Nginx 5001 完整流程 =====');
  const login5001 = await POST('127.0.0.1', 5001, '/deepseek-harness/login.json', { password: '13586282293qAz' });
  console.log('5001 login:', login5001.status);
  const cookie5001 = (login5001.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const idx5001 = await GET('127.0.0.1', 5001, '/deepseek-harness/', { Cookie: cookie5001 });
  const html5001 = idx5001.body.toString('utf8');
  const base5001 = html5001.match(/<base href="([^"]*)"/)?.[1];
  console.log('5001 index:', idx5001.status, 'base:', base5001);
  const preloads5001 = [...html5001.matchAll(/<link rel="preload"[^>]*href="([^"]+)"/g)].map(m => htmlUnescape(m[1]));
  const scripts5001 = [...html5001.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => htmlUnescape(m[1]));
  const comboUrls5001 = [...preloads5001, ...scripts5001].filter(s => s.includes('/??'));
  console.log('Found ' + comboUrls5001.length + ' combo URLs. Preview:\n  ' + comboUrls5001.join('\n  ').slice(0, 600));
  for (const relUrl of comboUrls5001) {
    // base href = /deepseek-harness/ → 相对路径 ./plugins/??xxx 拼接后 = /deepseek-harness/plugins/??xxx
    const absUrl = new URL(relUrl, 'http://x' + base5001).pathname + new URL(relUrl, 'http://x' + base5001).search;
    console.log('\nRequest via NGINX 5001 path =', absUrl.length + ' bytes → ' + absUrl.slice(0, 120) + '...');
    const r = await GET('127.0.0.1', 5001, absUrl, { Cookie: cookie5001 });
    console.log(' → status=' + r.status + ' bytes=' + r.body.length + ' type=' + (r.headers['content-type'] || 'no-type') + ' server=' + (r.headers.server || ''));
    if (r.status !== 200) console.log('   BODY: ' + r.body.slice(0, 300).toString());
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
