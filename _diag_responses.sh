#!/bin/bash
set -u
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "=== 1. 列出 profile 的关键包 client.js 是否存在 ==="
for pkg in dsh-client-modules dsh-typert-registry dsh-api-gateway dsh-client-connection; do
  P="$HOME/.dsh/profiles/node_modules/@deepseek-ai/$pkg"
  if [ -d "$P" ]; then
    echo "+ $pkg: exists. lib/ listing:"
    ls "$P/lib" 2>/dev/null | head -5
  else
    echo "- $pkg: MISSING at $P"
  fi
done

echo
echo "=== 2. dsh 工作区包 client.js 是否存在（不是 profile cache）（项目里的 lib） ==="
cd /home/ubuntu/projects/deepseek-harness-official
for dir in packages/client/modules packages/typert/registry packages/api/gateway packages/client/connection packages/bundle/web-app packages/host/frontend-static; do
  pkgname=$(node -e "const fs=require('fs');try{const p='$dir/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log(j.name)}catch(e){console.log('?')}")
  echo "$dir ($pkgname) → lib exists? $(if [ -d "$dir/lib" ]; then echo YES $(ls $dir/lib/*.js 2>/dev/null | wc -l) files; else NO; fi)"
done

echo
echo "=== 3. 检查 profiles/web profile 配置文件有没有 import web-app（它会引入全部 UI 插件） ==="
cat ~/.dsh/profiles/web/cordis.yml 2>/dev/null | head -50 || echo "no cordis.yml"

echo
echo "=== 4. 启动 30s 后再检查 journalctl 有没有 WARNING 级别的 FAILED fiber ==="
sudo journalctl -u dsh-official --no-pager --since '5 min ago' 2>&1 | grep -iE 'warn|error|failed|fatal' | head -30 || echo "(no warn/error found => great)"
