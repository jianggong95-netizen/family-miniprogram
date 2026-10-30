#!/bin/bash
# ============================================
# 家庭衣橱后端 - 飞牛OS 一键部署脚本
# 用法: 在飞牛SSH中执行 bash deploy.sh
# ============================================

set -e

FEINIU_IP="192.168.1.100"
DEPLOY_DIR="/vol1/closet"
BACKEND_DIR="${DEPLOY_DIR}/backend"

echo "=========================================="
echo "  家庭衣橱后端 - 飞牛OS 部署脚本"
echo "=========================================="

# 1. 创建部署目录
echo ""
echo "[1/6] 创建部署目录..."
mkdir -p "${DEPLOY_DIR}"
mkdir -p "${DEPLOY_DIR}/data"
mkdir -p "${DEPLOY_DIR}/images"
echo "  目录已创建: ${DEPLOY_DIR}"

# 2. 检查Docker
echo ""
echo "[2/6] 检查Docker环境..."
if ! command -v docker &> /dev/null; then
    echo "  错误: Docker未安装，请先安装Docker"
    exit 1
fi
echo "  Docker版本: $(docker --version)"

if ! docker compose version &> /dev/null; then
    echo "  警告: docker compose 不可用，尝试使用 docker-compose"
    COMPOSE_CMD="docker-compose"
else
    COMPOSE_CMD="docker compose"
fi
echo "  Compose命令: ${COMPOSE_CMD}"

# 3. 检查后端代码是否存在
echo ""
echo "[3/6] 检查后端代码..."
if [ ! -d "${BACKEND_DIR}" ]; then
    echo "  错误: ${BACKEND_DIR} 不存在"
    echo "  请先将 backend/ 目录和 docker-compose.yml 上传到 ${DEPLOY_DIR}/"
    exit 1
fi

if [ ! -f "${DEPLOY_DIR}/docker-compose.yml" ]; then
    echo "  错误: ${DEPLOY_DIR}/docker-compose.yml 不存在"
    echo "  请将 docker-compose.yml 放到 ${DEPLOY_DIR}/"
    exit 1
fi

echo "  后端代码目录: ${BACKEND_DIR}"
echo "  docker-compose.yml: 已找到"

# 4. 停止旧容器（如果存在）
echo ""
echo "[4/6] 停止旧容器..."
cd "${DEPLOY_DIR}"
${COMPOSE_CMD} down 2>/dev/null || true
echo "  旧容器已停止（如有）"

# 5. 构建并启动
echo ""
echo "[5/6] 构建并启动服务..."
${COMPOSE_CMD} up -d --build

echo ""
echo "  服务启动中..."
sleep 3

# 6. 验证服务
echo ""
echo "[6/6] 验证服务..."
if curl -s http://localhost:9990/api/health | grep -q '"code"'; then
    echo "  ✓ 服务健康检查通过!"
    echo ""
    echo "=========================================="
    echo "  部署成功!"
    echo "=========================================="
    echo "  访问地址: http://${FEINIU_IP}:9990/api/health"
    echo "  数据目录: ${DEPLOY_DIR}/data/"
    echo "  图片目录: ${DEPLOY_DIR}/images/"
    echo ""
    echo "  常用命令:"
    echo "    查看日志: cd ${DEPLOY_DIR} && ${COMPOSE_CMD} logs -f"
    echo "    重启服务: cd ${DEPLOY_DIR} && ${COMPOSE_CMD} restart"
    echo "    停止服务: cd ${DEPLOY_DIR} && ${COMPOSE_CMD} down"
    echo "=========================================="
else
    echo "  ✗ 服务健康检查失败"
    echo "  请查看日志: cd ${DEPLOY_DIR} && ${COMPOSE_CMD} logs"
    exit 1
fi
