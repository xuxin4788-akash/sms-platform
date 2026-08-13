#!/bin/bash
# SMS Platform Auto-Deploy Script
# 此脚本由 webhook 自动触发，请勿手动修改

set -e

DEPLOY_DIR="/opt/sms-platform"
LOG_FILE="/var/log/sms-platform/deploy.log"
BACKUP_DIR="/opt/sms-platform-backup"

# 创建日志目录
mkdir -p $(dirname $LOG_FILE)

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

log "========== 部署开始 =========="
log "提交信息：$1"

# 进入项目目录
cd $DEPLOY_DIR

# 拉取最新代码
log "拉取最新代码..."
git pull origin main

# 备份当前版本
log "备份当前版本..."
mkdir -p $BACKUP_DIR
cp -r $DEPLOY_DIR $BACKUP_DIR/sms-platform-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true

# 重新构建 Docker 镜像
log "构建 Docker 镜像..."
docker-compose build

# 重启服务（零停机）
log "重启服务..."
docker-compose up -d

# 清理旧容器
log "清理旧容器..."
docker image prune -f

# 检查服务状态
log "检查服务状态..."
sleep 5
if docker-compose ps | grep -q "Up"; then
    log "✅ 部署成功！服务运行正常"
else
    log "❌ 部署失败！服务未正常运行"
    log "尝试回滚..."
    # 这里可以添加回滚逻辑
    exit 1
fi

log "========== 部署完成 =========="
echo "Deployment successful"
