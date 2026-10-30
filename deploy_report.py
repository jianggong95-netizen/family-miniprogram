import paramiko
import time
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from deploy_config import HOST, USER, PASS, DEPLOY_DIR

BACKEND_DIR = f"{DEPLOY_DIR}/backend"

# 只需上传有变动的后端文件（相对 BACKEND_DIR）
FILES = [
    "src/routes/report.js",
    "src/server.js",
]

SUDO = f"echo {PASS} | sudo -S"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print("连接飞牛...")
ssh.connect(HOST, username=USER, password=PASS, timeout=10)
print("OK")

def run(cmd, timeout=30):
    print(f"  >> {cmd[:80]}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        for line in out.split("\n")[:15]:
            print(f"     {line}")
    if err and "warning" not in err.lower() and "password" not in err.lower():
        for line in err.split("\n")[:5]:
            print(f"     [ERR] {line}")
    return out, err

local_base = os.path.dirname(os.path.abspath(__file__))

print("\n[1/3] 上传变更的后端文件...")
sftp = ssh.open_sftp()
try:
    for rel in FILES:
        local = os.path.join(local_base, "backend", rel)
        remote = os.path.join(BACKEND_DIR, rel).replace("\\", "/")
        if not os.path.exists(local):
            print(f"  跳过（本地不存在）: {rel}")
            continue
        remote_dir = os.path.dirname(remote)
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            run(f"mkdir -p {remote_dir}")
        sftp.put(local, remote)
        print(f"  ✓ {rel}")
finally:
    sftp.close()

print("\n[2/3] 重建容器...")
run(f"cd {DEPLOY_DIR} && {SUDO} docker compose up -d --build 2>&1", timeout=300)

print("\n[3/3] 验证服务...")
time.sleep(6)
out, _ = run("curl -sf http://localhost:9990/api/health")
if out: print("\n  健康检查:", out)
# report 接口冒烟测试（用测试家庭的管理员 token）
rep, _ = run("curl -s -H 'X-Token: test_openid_001' 'http://localhost:9990/api/stats/report?from=2026-01-01&to=2026-12-31'")
print("\n  report 接口:", rep[:260] if rep else "(空/失败)")

ssh.close()