# SMS Platform 自动部署方案

本目录包含 Webhook 自动部署所需的所有配置文件。

## 文件说明

| 文件 | 说明 |
|------|------|
| `setup.sh` | 服务器初始化脚本（一键配置） |
| `deploy.sh` | 部署脚本（由 webhook 自动触发） |
| `webhook.json` | Webhook 配置文件 |
| `webhook.service` | Systemd 服务配置 |
| `WEBHOOK_SETUP.md` | 详细配置说明 |
| `QUICKSTART.md` | 快速部署指南 |

## 快速开始

### 1. 服务器初始化

```bash
sudo bash deploy/setup.sh <仓库地址>
```

### 2. 配置 Webhook

参考 `WEBHOOK_SETUP.md` 在 GitHub/GitLab 配置 webhook。

### 3. 测试

推送代码到 main 分支，自动触发部署。

## 工作流程

```
代码推送到 main
    ↓
GitHub/GitLab 发送 webhook
    ↓
服务器 webhook 服务接收请求
    ↓
执行 deploy.sh
    ↓
git pull → docker-compose build → docker-compose up -d
    ↓
部署完成
```

## 安全建议

1. 使用 Secret 验证 webhook 请求
2. 限制 webhook 端口只允许 GitHub/GitLab IP 访问
3. 定期更新服务器和依赖

## 故障排查

查看日志：
```bash
sudo journalctl -u webhook -f
tail -f /var/log/sms-platform/deploy.log
```

详细文档：`WEBHOOK_SETUP.md`
