import paramiko
import time

from deploy_config import HOST, PORT, USER, PASS, DEPLOY_DIR, WX_APPID, WX_SECRET

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

# 1. 更新 docker-compose.yml 加入微信环境变量
print("\n[1/3] 更新 docker-compose.yml (写入微信凭据)...")
new_compose = f"""services:
  closet-api:
    build: ./backend
    image: closet-api:latest
    container_name: closet-api
    restart: unless-stopped
    ports:
      - "9990:3000"
    volumes:
      - ./data:/app/data
      - ./images:/app/images
    environment:
      - PORT=3000
      - DB_PATH=/app/data/closet.db
      - IMAGES_DIR=/app/images
      - NODE_ENV=production
      - WX_APPID={WX_APPID}
      - WX_SECRET={WX_SECRET}
"""

sftp = ssh.open_sftp()
with sftp.file(f"{DEPLOY_DIR}/docker-compose.yml", "w") as f:
    f.write(new_compose)
sftp.close()
print("  OK")

# 2. 重建并重启容器
print("\n[2/3] 重建容器（应用新环境变量）...")
run(f"cd {DEPLOY_DIR} && {SUDO} docker compose up -d --build 2>&1", timeout=300)

# 3. 等待启动并验证
print("\n[3/3] 验证服务...")
time.sleep(6)
out, _ = run("curl -sf http://localhost:9990/api/health")
if out and '"code"' in out:
    print("\n" + "=" * 50)
    print("  OK - 微信凭据配置完成，服务已重启！")
    print("=" * 50)
    print(f"  后端地址: http://{HOST}:{PORT}/api/health")
    print(f"  WX_APPID: {WX_APPID}")
    print(f"  devMode: false (生产模式)")
    print("=" * 50)
else:
    print("\n  FAIL - 服务可能未正常启动:")
    run(f"cd {DEPLOY_DIR} && {SUDO} docker compose logs --tail=20")

ssh.close()
