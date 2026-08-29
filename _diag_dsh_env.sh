#!/bin/bash
set -u
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/lib/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "=== 1. dsh-official 启动日志 (journalctl 最近 100 行) ==="
sudo journalctl -u dsh-official --no-pager -n 100 --reverse 2>&1 | /usr/bin/tac 2>/dev/null || sudo journalctl -u dsh-official --no-pager -n 100

echo
echo "=== 2. /etc/dsh-official.env 内容 (看环境变量 DSH_PUBLIC_BASE DSH_WEB_PASSWORD) ==="
/usr/bin/sudo /bin/cat /etc/dsh-official.env 2>&1 || echo "无法读取"

echo
echo "=== 3. 进程 env (从 /proc/1199251/environ 实际读) ==="
sudo tr '\0' '\n' < /proc/1199251/environ 2>&1 | /bin/grep -E 'DSH_|NODE_|PATH' || echo "进程已变更 pid，动态查找..."
PID=$(pgrep -f "bin.js web.*--port 3080" | head -1)
echo "Active PID=$PID"
[ -n "$PID" ] && sudo tr '\0' '\n' < /proc/$PID/environ 2>&1 | /bin/grep -E 'DSH_|NODE_|PATH'

echo
echo "=== 4. 验证 webServer 有没有注册任何路径: 直接 curl 一个已知的静态路径 ==="
curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' -H 'Cookie: dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw=v1.eyJ2ZXJzaW9uIjoxLCJhdXRob3JpdHkiOiIxMjcuMC4wLjE6MzA4MCIsImlzc3VlZEF0IjoxNzg4MDI3NDk2MTI4LCJleHBpcmVzQXQiOjE3OTA2MTk0OTYxMjh9.2c8yVmbPbTMz-EzAKKGFqbfMzlJZuJR-rMQ2u41b_44' \
  "http://127.0.0.1:3080/assets/index-D-eoFxDP.js"
curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' "http://127.0.0.1:3080/assets/index-D-eoFxDP.js"

echo
echo "=== 5. 直接访问一个确定存在的单独 plugins 路径(不带 combo): /plugins/@deepseek-ai/dsh-client-modules/client.js ==="
COOKIE=$(cat /tmp/dsh_cookie2.txt)
echo "cookie=${#COOKIE}"
curl -sS -o /tmp/p.txt -w 'HTTP=%{http_code} bytes=%{size_download}\n' -H "Cookie: $COOKIE" \
  "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=28e1db08b1d0"
head -c 200 /tmp/p.txt; echo
