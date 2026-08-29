#!/bin/bash
set -eu
echo "=== A) sudo cat /etc/dsh-official.env (masked secrets) ==="
sudo sed -E 's/(DSH_WEB_PASSWORD=).*/\1***MASKED***/; s/(DEEPSEEK_API_KEY=.*)/\1***SET***/' /etc/dsh-official.env 2>&1 || echo "FAILED TO READ"

echo
echo "=== B) journal dsh-official, last activation: grep for TypertGateway / intercept / connection: /api / workspace CONTROLLER names ==="
sudo journalctl -u dsh-official --no-pager --since '1 hour ago' 2>&1 \
  | grep -Ei 'TypertGateway|intercept|connection:.*api|workspace.*controller|models.*controller|agent.*preset|plugin.*invent|session.*controll|register.*RPC|not found' \
  | sort -u | head -50

echo
echo "=== C) Activation errors (error/Error/ERROR in last 30 lines that aren't ExperimentalWarning) ==="
sudo journalctl -u dsh-official --no-pager --since '1 hour ago' 2>&1 \
  | grep -Ei 'error' \
  | grep -v 'ExperimentalWarning' | grep -v 'cordis-client-runner.*404' | grep -v 'ui-cordis.*404' | grep -v 'agentPresets.*404' | grep -v 'loading.*provider目录失败' | head -50

echo
echo "=== D) /etc/dsh-official.env 真实 DEEPSEEK_API_KEY 是否设置（以长度判断）==="
KEY_LINE=$(sudo grep -E '^DEEPSEEK_API_KEY=' /etc/dsh-official.env 2>&1 || echo "MISSING")
if [[ "$KEY_LINE" == "MISSING" ]]; then
  echo "⚠️  DEEPSEEK_API_KEY 完全未设置"
else
  VAL=$(echo "$KEY_LINE" | sed -E 's/DEEPSEEK_API_KEY=//; s/^"//; s/"$//')
  LEN=${#VAL}
  echo "DEEPSEEK_API_KEY set: length=$LEN (empty? $([[ $LEN -eq 0 ]] && echo YES || echo NO))"
  # Prefix check: DeepSeek real key starts with "sk-"
  PREFIX=$(echo "$VAL" | cut -c1-3)
  [[ "$PREFIX" == "sk-" ]] && echo "Prefix: $PREFIX (matches real key format ✅)" || echo "Prefix: $PREFIX (expected sk-)"
fi
