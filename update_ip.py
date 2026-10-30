# -*- coding: utf-8 -*-
"""一键修改部署 IP（飞牛服务器局域网 IP / 公网 IP）。

用法（在项目目录下运行）：
    python update_ip.py                              # 查看当前配置
    python update_ip.py 192.168.1.100                # 只改局域网 IP
    python update_ip.py 192.168.1.100 203.0.113.10  # 同时改局域网 + 公网 IP

它会：
  1. 更新统一配置 deploy.config.json
  2. 同步改写 deploy.sh / one-click-deploy.sh / README.md / 小程序 request.js 里的旧 IP
  3. 其余 Python 脚本（deploy_auto.py 等）自动读取配置，无需改动
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "deploy.config.json")

# 需要把旧局域网 IP 全局替换为新 IP 的文本文件
SYNC_FILES = [
    "deploy.sh",
    "one-click-deploy.sh",
    "README.md",
    "miniprogram/utils/request.js",
]

IP_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")


def replace_in_file(path, old, new):
    """把文件里所有 old 替换成 new，返回替换次数。"""
    if not os.path.exists(path):
        print(f"  跳过（文件不存在）: {path}")
        return 0
    with open(path, encoding="utf-8") as f:
        content = f.read()
    count = content.count(old)
    if count:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content.replace(old, new))
    return count


def update_request_js(cfg):
    """按配置重写小程序 request.js 的 BASE_URL 行。"""
    path = os.path.join(HERE, "miniprogram", "utils", "request.js")
    if not os.path.exists(path):
        print(f"  跳过（文件不存在）: {path}")
        return
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")

    base_url = cfg.get("BASE_URL") or f"http://{cfg['LAN_IP']}:{cfg['PORT']}"
    comment = f"   // 局域网直连；公网直连: http://{cfg['PUBLIC_IP']}:{cfg['PORT']}（需路由器端口映射）"
    out = []
    for line in lines:
        if line.strip().startswith("const BASE_URL"):
            out.append(f"const BASE_URL = '{base_url}';{comment}")
        else:
            out.append(line)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"  ✓ request.js BASE_URL = {base_url}")


def main():
    args = sys.argv[1:]
    cfg = load_config()
    old_lan = cfg["LAN_IP"]
    old_pub = cfg["PUBLIC_IP"]

    if not args:
        print("当前配置:")
        print(f"  局域网 IP (LAN_IP):   {old_lan}")
        print(f"  公网 IP (PUBLIC_IP):  {old_pub}")
        print(f"  端口 (PORT):          {cfg['PORT']}")
        print(f"  小程序 BASE_URL:      {cfg.get('BASE_URL') or 'http://' + old_lan + ':' + str(cfg['PORT'])}")
        print()
        print("用法:")
        print("  python update_ip.py <新局域网IP> [新公网IP]")
        return

    new_lan = args[0].strip()
    if not IP_RE.match(new_lan):
        print(f"错误: 无效的 IP 格式: {new_lan}")
        sys.exit(1)

    new_pub = old_pub
    if len(args) >= 2:
        new_pub = args[1].strip()
        if not IP_RE.match(new_pub):
            print(f"错误: 无效的 IP 格式: {new_pub}")
            sys.exit(1)

    if new_lan == old_lan and new_pub == old_pub:
        print("IP 没有变化，无需更新。")
        return

    # 1. 更新统一配置
    cfg["LAN_IP"] = new_lan
    cfg["PUBLIC_IP"] = new_pub
    save_config(cfg)
    print(f"✓ 已更新 deploy.config.json: LAN={new_lan} PUBLIC={new_pub}")

    # 2. 全局替换文本文件里的旧局域网 IP
    total = 0
    for rel in SYNC_FILES:
        n = replace_in_file(os.path.join(HERE, rel), old_lan, new_lan)
        if n:
            print(f"  ✓ {rel}: 替换 {n} 处")
        total += n

    # 3. 公网 IP 同步（如这些文件里曾出现过）
    for rel in SYNC_FILES:
        replace_in_file(os.path.join(HERE, rel), old_pub, new_pub)

    # 4. 重写小程序 BASE_URL
    update_request_js(cfg)

    print()
    print("完成！所有部署脚本已同步。")
    print(f"  - 小程序 BASE_URL: http://{new_lan}:{cfg['PORT']}")
    print(f"  - 公网直连(需路由器端口映射): http://{new_pub}:{cfg['PORT']}")
    print("  - 重新部署/验证: python deploy_auto.py")


if __name__ == "__main__":
    main()
