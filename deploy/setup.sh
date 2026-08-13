#!/bin/bash
# SMS Platform Webhook 自动部署 - 服务器初始化脚本
# 使用方法：sudo bash setup.sh <仓库地址>

set -e

REPO_URL=$1
DEPLOY_DIR="/opt/sms-platform"
WEBHOOK_PORT=9000

if [ -z "$REPO_URL" ]; then
    echo "用法：sudo bash setup.sh <仓库地址>"
    echo "示例：sudo bash setup.sh https://github.com/yourname/sms-platform.git"
    exit 1
fi

echo "========================================="
echo "SMS Platform 自动部署初始化"
echo "========================================="
echo ""

# 1. 安装依赖
echo "[1/8] 安装依赖..."
apt update
apt install -y webhook git docker.io docker-compose

# 2. 创建部署目录
echo "[2/8] 创建部署目录..."
mkdir -p $DEPLOY_DIR
chown -R $SUDO_USER:$SUDO_USER $DEPLOY_DIR

# 3. 克隆代码
echo "[3/8] 克隆代码仓库..."
cd $DEPLOY_DIR
sudo -u $SUDO_USER git clone $REPO_URL .
sudo -u $SUDO_USER git checkout main

# 4. 复制部署文件
echo "[4/8] 配置部署脚本..."
cp deploy/webhook.json $DEPLOY_DIR/deploy/
cp deploy/deploy.sh $DEPLOY_DIR/deploy/
chmod +x $DEPLOY_DIR/deploy/deploy.sh

# 5. 创建日志目录
echo "[5/8] 创建日志目录..."
mkdir -p /var/log/sms-platform
chown -R www-data:www-data /var/log/sms-platform

# 6. 安装 webhook 服务
echo "[6/8] 安装 webhook 服务..."
cp deploy/webhook.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable webhook
systemctl start webhook

# 7. 配置防火墙
echo "[7/8] 配置防火墙..."
if command -v ufw &> /dev/null; then
    ufw allow $WEBHOOK_PORT/tcp
    echo "已开放端口 $WEBHOOK_PORT"
else
    echo "未检测到 ufw，请手动开放端口 $WEBHOOK_PORT"
fi

# 8. 初始部署
echo "[8/8] 执行初始部署..."
cd $DEPLOY_DIR
docker-compose build
docker-compose up -d

echo ""
echo "========================================="
echo "✅ 初始化完成！"
echo "========================================="
echo ""
echo "Webhook URL: http://$(hostname -I | awk '{print $1}'):$WEBHOOK_PORT/hooks/deploy-sms-platform"
echo ""
echo "下一步："
echo "1. 在 GitHub/GitLab 配置 Webhook（参考 deploy/WEBHOOK_SETUP.md）"
echo "2. 推送代码到 main 分支测试自动部署"
echo ""
echo "查看日志："
echo "  - Webhook 服务：sudo journalctl -u webhook -f"
echo "  - 部署日志：tail -f /var/log/sms-platform/deploy.log"
echo ""
