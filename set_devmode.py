# -*- coding: utf-8 -*-
"""临时把洗衣橱后端切到【开发模式】（去掉 WX_APPID/WX_SECRET）。
开发模式下 code 直接当 openid 用，绕过微信 code2session 的 IP 白名单限制，
方便在开发者工具里预览完整登录流程。

恢复生产模式：运行 update_wechat.py（会把微信凭据写回并重启）。
"""
import paramiko
import time

from deploy_config import HOST, PORT, USER, PASS, DEPLOY_DIR

SUDO = f"echo {PASS} | sudo -S"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print("连接飞牛...")
ssh.connect(HOST, username=USER, password=PASS, timeout=10)
print("连接成功")


def run(cmd, timeout=120):
    print(f"  >> {cmd[:90]}...")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        for line in out.split("\n")[-20:]:
            print(f"     {line}")
    if err and "warning" not in err.lower() and "password" not in err.lower():
        for line in err.split("\n")[-5:]:
            print(f"     [ERR] {line}")
    return out, err


# 0. 备份当前生产 compose
print("\n[0/4] 备份生产 docker-compose.yml...")
run(f"{SUDO} cp {DEPLOY_DIR}/docker-compose.yml {DEPLOY_DIR}/docker-compose.prod.yml.bak")

# 1. 写入【开发模式】compose（不带微信凭证）
print("\n[1/4] 写入开发模式 docker-compose.yml...")
dev_compose = """services:
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
"""
sftp = ssh.open_sftp()
with sftp.file(f"{DEPLOY_DIR}/docker-compose.yml", "w") as f:
    f.write(dev_compose)
sftp.close()
print("  done")

# 2. 重建并重启容器
print("\n[2/4] 重启容器（应用开发模式）...")
run(f"cd {DEPLOY_DIR} && {SUDO} docker compose up -d --force-recreate 2>&1", timeout=300)

# 3. 等待启动
print("\n[3/4] 等待服务启动...")
time.sleep(6)

# 4. 验证
print("\n[4/4] 验证 devMode...")
out, _ = run("curl -sf http://localhost:9990/api/health")
if out and '"devMode":true' in out:
    print("\n" + "=" * 50)
    print("  OK 已切到开发模式 (devMode=true)")
    print(f"  后端: http://{HOST}:{PORT}/api/health")
    print("  恢复生产: 运行 update_wechat.py")
    print("=" * 50)
else:
    print("\n  结果:", out)
    print("  ✗ 未检测到 devMode:true，请检查 docker compose logs")

ssh.close()