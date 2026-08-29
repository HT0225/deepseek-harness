#!/usr/bin/env python3
"""Deploy plugin-path fix to server 124.221.182.15."""
import subprocess, sys, os, json

KEY = r"E:\HT\HT.pem"
HOST = "ubuntu@124.221.182.15"
DEPLOY_DIR = "/home/ubuntu/projects/deepseek-harness-official"
PEM = "-o StrictHostKeyChecking=no -i " + KEY

def run_ssh(cmd, timeout=600):
    full = f'ssh {PEM} {HOST} "{cmd}"'
    print(f"$ ssh {HOST} <<EOF\n{cmd}\nEOF")
    r = subprocess.run(full, shell=True, capture_output=True, text=True, timeout=timeout)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    print(f"[exit={r.returncode}]")
    return r

def main():
    steps = [
        ("1. Check Nginx 5001 deepseek-harness location proxy_pass tail slash",
         "grep -n 'proxy_pass' /etc/nginx/sites-enabled/*5001* /etc/nginx/sites-enabled/*deepseek* 2>/dev/null; echo '---'; ls /etc/nginx/sites-enabled/"),
        ("2. Git pull latest commit (expect ed4d004924)",
         f"cd {DEPLOY_DIR} && git --no-pager log --oneline -3 && echo '--- pulling ---' && git pull origin lht --ff-only && git --no-pager log --oneline -1"),
        ("3. pnpm install (no changes expected)",
         f"cd {DEPLOY_DIR} && pnpm install --frozen-lockfile=false 2>&1 | tail -20"),
        ("4. pnpm run build (expect exit 0)",
         f"cd {DEPLOY_DIR} && pnpm run build 2>&1 | tail -40"),
        ("5. systemctl restart dsh-official and check status",
         "sudo systemctl restart dsh-official && sleep 3 && sudo systemctl is-active dsh-official && sudo systemctl status dsh-official --no-pager -l | head -15"),
        ("6. Verify endpoints listen",
         "ss -ltn | grep -E ':(3080|5001)\\b' || netstat -ltn 2>/dev/null | grep -E ':(3080|5001)\\b'"),
        ("7. Smoke: curl login.json pass + fetch main page parse base href + test plugins combo URL",
         f"""
         cd {DEPLOY_DIR}
         COOKIE=/tmp/dsh_cookie.txt
         rm -f $COOKIE
         echo '--- login ---'
         curl -s -o /tmp/login_resp.json -w 'HTTP=%{{http_code}}\\n' -X POST http://127.0.0.1:3080/login.json -H 'Content-Type: application/json' -d '{{"password":"13586282293qAz"}}' -c $COOKIE
         cat /tmp/login_resp.json; echo
         echo '--- main page (with cookie) ---'
         curl -s -b $COOKIE -H 'X-Forwarded-Prefix: /deepseek-harness' 'http://127.0.0.1:3080/' -o /tmp/idx.html -w 'HTTP=%{{http_code}} size=%{{size_download}}\\n'
         echo 'base href =' ; grep -oE '<base href=\"[^\"]*\"' /tmp/idx.html | head -1
         echo 'script-preload hrefs (first 3) =' ; grep -oE '<link rel=\"preload\"[^>]*href=\"[^\"]*\"' /tmp/idx.html | head -3
         echo '--- combo URL sample ---'
         grep -oE 'href=\"\\./plugins\\?\\?[^\"&]+&rev=[^\"]*\"' /tmp/idx.html | head -1 || echo 'NO MATCH (checking alternative absolute)'
         grep -oE 'href=\"/plugins\\?\\?[^\"]*\"' /tmp/idx.html | head -1 || true
         """),
    ]
    for name, cmd in steps:
        print(f"\n===== {name} =====")
        r = run_ssh(cmd, timeout=900)
        if r.returncode != 0 and "4." not in name and "7." not in name:
            print(f"  !! non-zero exit for {name}, continuing\n")

if __name__ == "__main__":
    main()
