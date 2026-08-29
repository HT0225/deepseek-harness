#!/bin/bash
set -eu
export PATH="/home/ubuntu/.hermes/node/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "=== [1/5] systemd service environment (DEEPSEEK_API_KEY / DSH_PUBLIC_BASE / HOME / DSH_CONFIG etc.) ==="
# EnvironmentFile + systemctl show --property=Environment
echo "--- Service file EnvironmentFile/Environment lines ---"
grep -E '^(Environment|EnvironmentFile)' /etc/systemd/system/dsh-official.service || echo "(missing)"
echo "--- Runtime environment (via systemctl show) ---"
sudo systemctl show dsh-official --property=Environment --no-pager || true
sudo systemctl show dsh-official --property=EnvironmentFiles --no-pager || true
# 如果有 EnvironmentFile，cat 它
ENV_FILE=$(sudo systemctl show dsh-official --property=EnvironmentFiles --no-pager | sed 's/EnvironmentFiles=//' | awk '{print $1}')
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  echo "--- EnvironmentFile $ENV_FILE content (masked) ---"
  sed -E 's/(DSH_WEB_PASSWORD=).*/\1***MASKED***/; s/(DEEPSEEK_API_KEY=).*/\1***SET***(len='$(grep -E "^DEEPSEEK_API_KEY=" "$ENV_FILE" 2>/dev/null | head -1 | sed "s/DEEPSEEK_API_KEY=//; s/\"//g" | awk '{print length($0)}')')/' "$ENV_FILE"
elif [[ -f /etc/dsh-official.env ]]; then
  echo "--- /etc/dsh-official.env content ---"
  sed -E 's/(DSH_WEB_PASSWORD=).*/\1***MASKED***/; s/(DEEPSEEK_API_KEY=).*/\1***SET***(len='$(grep -E "^DEEPSEEK_API_KEY=" /etc/dsh-official.env 2>/dev/null | head -1 | sed "s/DEEPSEEK_API_KEY=//; s/\"//g" | awk '{print length($0)}')')' /etc/dsh-official.env
fi

echo
echo "=== [2/5] Process + listening ports ==="
PID=$(pgrep -f "bin.js web.*--port 3080" | head -1)
echo "dsh PID: $PID"
if [[ -n "$PID" ]]; then
  echo "Process cmdline:"; cat /proc/$PID/cmdline | tr '\0' ' ' | head -c 200; echo
  echo "Process /proc/$PID/environ (keys only, masked values):"
  tr '\0' '\n' < /proc/$PID/environ | grep -E '^(DEEPSEEK|DSH_|HOME|PATH|NODE_|HTTP_|HTTPS_|OPENAI|MODEL)' | sed -E 's/(DSH_WEB_PASSWORD=).*/\1***MASKED***/; s/(DEEPSEEK_API_KEY=).*/\1***SET***(len='$(echo & | grep DEEPSEEK_API_KEY | head -1)')'
fi
echo
echo "Listening ports (ss -ltnp):"
ss -ltnp | grep -E ':(3080|5001|5432|3306)\b' || echo "(none on target ports; full ss below)"
ss -ltnp | head -20

echo
echo "=== [3/5] ~/.dsh directory tree (workspaces / presets / profiles / config) ==="
find ~/.dsh -maxdepth 3 -print 2>/dev/null | sort | head -80 || echo "(no ~/.dsh)"
echo
echo "--- ~/.dsh/workspaces listing (1-level depth) ---"
if [[ -d ~/.dsh/workspaces ]]; then
  echo "workspaces dir exists, items:"
  ls -la ~/.dsh/workspaces/ 2>&1 | head -20
else
  echo "~/.dsh/workspaces NOT EXIST ⚠️"
fi
echo
echo "--- ~/.dsh presets directory listing ---"
for d in ~/.dsh/presets ~/.dsh/preset ~/.dsh/agent-presets; do
  if [[ -d "$d" ]]; then echo "$d:"; ls -la "$d" | head -20; fi
done
echo
echo "--- dsh-official.service Full config ---"
cat /etc/systemd/system/dsh-official.service 2>&1 | head -40
