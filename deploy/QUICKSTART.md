# 快速部署指南

## 一键初始化（在服务器上执行）

```bash
# 1. 进入项目目录
cd /path/to/sms-platform

# 2. 运行初始化脚本（需要 root 权限）
sudo bash deploy/setup.sh <你的仓库地址>
```

例如：
```bash
sudo bash deploy/setup.sh https://github.com/yourname/sms-platform.git
```

## 配置 GitHub/GitLab Webhook

### GitHub
1. 仓库 → Settings → Webhooks → Add webhook
2. Payload URL: `http://你的服务器IP:9000/hooks/deploy-sms-platform`
3. Content type: `application/json`
4. Events: Just the push event
5. Active: ✅

### GitLab
1. 项目 → Settings → Webhooks
2. URL: `http://你的服务器IP:9000/hooks/deploy-sms-platform`
3. Trigger: Push events, Branch: main

## 测试部署

推送代码到 main 分支：
```bash
git add .
git commit -m "test deploy"
git push origin main
```

查看部署日志：
```bash
tail -f /var/log/sms-platform/deploy.log
```

## 手动部署

```bash
cd /opt/sms-platform
git pull
docker-compose build
docker-compose up -d
```

## 常用命令

```bash
# 查看 webhook 服务状态
sudo systemctl status webhook

# 重启 webhook 服务
sudo systemctl restart webhook

# 查看部署日志
tail -f /var/log/sms-platform/deploy.log

# 查看应用日志
docker-compose logs -f

# 手动触发部署
bash /opt/sms-platform/deploy/deploy.sh "手动部署"
```
