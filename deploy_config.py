# -*- coding: utf-8 -*-
"""统一部署配置：所有部署脚本从这里读取 飞牛 IP / SSH / 微信凭据。

IP 变更只需运行（无需改任何脚本文件）：
    python update_ip.py <新局域网IP> [新公网IP]
"""
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_CONFIG_PATH = os.path.join(_HERE, "deploy.config.json")


def load():
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


_cfg = load()

# 飞牛服务器（SSH 部署连接用局域网 IP）
HOST = _cfg["LAN_IP"]
PUBLIC_IP = _cfg["PUBLIC_IP"]
PORT = int(_cfg["PORT"])
USER = _cfg["SSH_USER"]
PASS = _cfg["SSH_PASS"]
DEPLOY_DIR = _cfg["DEPLOY_DIR"]

# 微信小程序凭据
WX_APPID = _cfg["WX_APPID"]
WX_SECRET = _cfg["WX_SECRET"]

# 对外地址（BASE_URL 为空时默认用局域网 IP）
BASE_URL = _cfg.get("BASE_URL") or f"http://{HOST}:{PORT}"
PUBLIC_URL = f"http://{PUBLIC_IP}:{PORT}"
