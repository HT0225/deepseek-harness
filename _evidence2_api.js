// ============================================================
// Evidence 2: 以登录用户身份（先POST /login.json 拿 cookie）逐个调用关键 API
// 记录 status + body 前 1200 chars
// ============================================================
const http = require('http');
const POST = (path, data, host, port, headers = {}) => new Promise((resolve, reject) => {
  const body = JSON.stringify(data);
  const req = http.request({ hostname: host, port, method: 'POST', path,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers)
  }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
  req.on('error', reject); req.write(body); req.end();
});
const REQ = (method, path, host, port, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: host, port, method, path, headers }, (res) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
  req.on('error', reject); req.end();
});
const HOST = '127.0.0.1';
const PORT = 3080;

(async () => {
  const login = await POST('/login.json', { password: '13586282293qAz' }, HOST, PORT);
  console.log('=== Login /login.json status=' + login.status + ' set-cookie count=' + (login.headers['set-cookie'] || []).length);
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  if (!cookie) { console.log('LOGIN FAILED. Body:', login.body.slice(0, 300)); process.exit(1); }
  const headers = {
    Cookie: cookie,
    'Content-Type': 'application/json',
    // dsh API expects Host connection authority via header matching
    Host: '127.0.0.1:3080',
  };
  const targets = [
    { name: 'GET  /api/workspaces/list',                 method: 'GET',  path: '/api/workspaces/list' },
    { name: 'GET  /api/models/listProviders',             method: 'GET',  path: '/api/models/listProviders' },
    { name: 'POST /api/models/listProviders (RPC variant)', method: 'POST', path: '/api/models', json: { jsonrpc: '2.0', id: 1, method: 'models/listProviders', params: {} } },
    { name: 'GET  /api/agentPresets/list',                method: 'GET',  path: '/api/agentPresets/list' },
    { name: 'POST /api/agentPresets/list (RPC variant)',    method: 'POST', path: '/api/agentPresets', json: { jsonrpc: '2.0', id: 2, method: 'agentPresets/list', params: {} } },
    { name: 'GET  /api/plugins/inventory',                method: 'GET',  path: '/api/plugins/inventory' },
    { name: 'POST /api/dynamicCordisRunner/inventory',   method: 'POST', path: '/api/dynamicCordisRunner', json: { jsonrpc: '2.0', id: 3, method: 'dynamicCordisRunner/inventory', params: {} } },
    { name: 'GET  /api/sessions/list (会话列表)',          method: 'GET',  path: '/api/sessions/list' },
    { name: 'GET  /api/todo/list',                        method: 'GET',  path: '/api/todo/list' },
  ];
  console.log('\n=== API Response (per target: METHOD PATH → STATUS + BODY[:1200]) ===\n');
  for (const t of targets) {
    let r;
    try {
      if (t.method === 'POST') {
        const body = JSON.stringify(t.json);
        r = await new Promise((res, rej) => {
          const req = http.request({ hostname: HOST, port: PORT, method: 'POST', path: t.path,
            headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers)
          }, (resp) => { const c = []; resp.on('data', x => c.push(x)); resp.on('end', () => res({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(c) })); });
          req.on('error', rej); req.write(body); req.end();
        });
      } else {
        r = await REQ(t.method, t.path, HOST, PORT, headers);
      }
    } catch(e) { console.log(t.name + ' → ERROR: ' + e.message); continue; }
    const bodyStr = r.body.toString('utf8');
    console.log('━━ ' + t.name + ' → status=' + r.status + ' bytes=' + r.body.length + ' type=' + (r.headers['content-type'] || ''));
    console.log('    BODY[:1200]: ' + bodyStr.slice(0, 1200).replace(/\n/g, ' ↵ '));
    if (r.status >= 400) {
      // Try to provide hints: is it JSON-RPC error?
      try { const j = JSON.parse(bodyStr); if (j && j.error) console.log('    ⚠️ JSON-RPC error.code=' + j.error.code + ' message=' + String(j.error.message||'').slice(0,200)); } catch(_) {}
    }
    console.log();
  }

  // --- 列出所有已注册的 RPC 方法名（通过 dsh 内部 RPC introspection：typert.list 等）---
  console.log('=== Typert Introspection: POST /api/... typert/registry/listMethods on common packages ===');
  const introTargets = [
    '/api/typertRegistry',
    '/api/models',
    '/api/agentPresets',
    '/api/workspaces',
    '/api/plugins',
    '/api/sessions',
  ];
  for (const p of introTargets) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 'intro_' + p, method: 'typert.registry.listMethods', params: {} });
    const r = await new Promise((res, rej) => {
      const req = http.request({ hostname: HOST, port: PORT, method: 'POST', path: p,
        headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers)
      }, (resp) => { const c = []; resp.on('data', x => c.push(x)); resp.on('end', () => res({ status: resp.statusCode, body: Buffer.concat(c) })); });
      req.on('error', rej); req.write(body); req.end();
    });
    const txt = r.body.toString('utf8');
    const result = (() => { try { const j = JSON.parse(txt); return j && j.result ? JSON.stringify(j.result).slice(0,400) : 'no-result'; } catch(_e){ return 'not-json / parse fail'; } })();
    console.log(p + ' typert.registry.listMethods → status=' + r.status + ' result=' + result);
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
