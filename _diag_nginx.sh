#!/bin/bash
set -u
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

PLUGIN_URL='plugins/??@deepseek-ai/dsh-client-modules/client.js&rev=28e1db08b1d0'

echo "=== 1. 直接 curl 3080 后端 /plugins/??... (应该200有内容) ==="
curl -sS -o /tmp/plug_body.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
  "http://127.0.0.1:3080/$PLUGIN_URL"
head -c 120 /tmp/plug_body.txt; echo

echo
echo "=== 2. 直接 curl 3080 后端 /deepseek-harness/plugins/??... (应该200，fallback到SPA? 不一定) ==="
curl -sS -o /tmp/plug_body2.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
  "http://127.0.0.1:3080/deepseek-harness/$PLUGIN_URL"

echo
echo "=== 3. curl 127.0.0.1:80 (通过本机 nginx 层) /deepseek-harness/plugins/??... ==="
curl -sS -o /tmp/plug_body3.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' \
  -H 'Host: 124.221.182.15' "http://127.0.0.1:5001/deepseek-harness/$PLUGIN_URL" 2>&1
/usr/bin/head -c 300 /tmp/plug_body3.txt 2>/dev/null; echo

echo
echo "=== 4. nginx 5001 根 location 命中检查 = /deepseek-harness/abc 的 proxy_pass ==="
curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' \
  -H 'Host: 124.221.182.15' "http://127.0.0.1:5001/deepseek-harness/login.json"

echo
echo "=== 5. ss 确认端口监听 ==="
/usr/bin/ss -ltnp 2>/dev/null | /usr/bin/grep -E ':(3080|5001)\b' || /bin/netstat -ltnp 2>/dev/null | /bin/grep -E ':(3080|5001)\b'
