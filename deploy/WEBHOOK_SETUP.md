# Webhook 自动部署配置说明

## 一、服务器初始化

在服务器上执行以下命令（需要 root 权限）：

```bash
# 1. 创建部署目录
sudo mkdir -p /opt/sms-platform
sudo chown -R $USER:$USER /opt/sms-platform

# 2. 克隆代码仓库
cd /opt/sms-platform
git clone <你的仓库地址> .
git checkout main

# 3. 安装 webhook 工具
sudo apt update
sudo apt install -y webhook

# 4. 复制部署文件
cp deploy/webhook.json /opt/sms-platform/deploy/
cp deploy/deploy.sh /opt/sms-platform/deploy/
chmod +x /opt/sms-platform/deploy/deploy.sh

# 5. 创建日志目录
sudo mkdir -p /var/log/sms-platform
sudo chown -R www-data:www-data /var/log/sms-platform

# 6. 安装 systemd 服务
sudo cp deploy/webhook.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable webhook
sudo systemctl start webhook

# 7. 检查服务状态
sudo systemctl status webhook
```

## 二、配置 Nginx 反向代理（可选）

如果 webhook 端口 9000 没有对外开放，需要配置 Nginx：

```nginx
# /etc/nginx/conf.d/webhook.conf
server {
    listen 80;
    server_name webhook.your-domain.com;
    
    location /hooks/deploy-sms-platform {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 三、GitHub Webhook 配置

### 1. 进入仓库设置
- 打开 GitHub 仓库
- Settings → Webhooks → Add webhook

### 2. 填写配置
| 字段 | 值 |
|------|-----|
| Payload URL | `http://你的服务器IP:9000/hooks/deploy-sms-platform` |
| Content type | `application/json` |
| Secret | （留空或设置密钥） |
| Which events | `Just the push event` |
| Active | ✅ |

### 3. 测试
- 点击 "Add webhook"
- 推送代码到 main 分支
- 查看 `/var/log/sms-platform/deploy.log` 确认部署

## 四、GitLab Webhook 配置

### 1. 进入项目设置
- 打开 GitLab 项目
- Settings → Webhooks

### 2. 填写配置
| 字段 | 值 |
|------|-----|
| URL | `http://你的服务器IP:9000/hooks/deploy-sms-platform` |
| Secret Token | （留空） |
| Trigger | ✅ Push events |
| Branch filter | `main` |

### 3. 测试
- 点击 "Add webhook"
- 推送代码到 main 分支

## 五、安全建议

### 1. 使用 Secret 验证
修改 `webhook.json` 添加密钥验证：

```json
{
  "id": "deploy-sms-platform",
  "execute-command": "/opt/sms-platform/deploy.sh",
  "command-working-directory": "/opt/sms-platform",
  "response-message": "Deployment started",
  "trigger-rule": {
    "and": [
      {
        "match": {
          "type": "value",
          "value": "main",
          "parameter": {
            "source": "payload",
            "name": "ref"
          }
        }
      },
      {
        "match": {
          "type": "payload-hash-sha1",
          "secret": "your-secret-key",
          "parameter": {
            "source": "header",
            "name": "X-Hub-Signature"
          }
        }
      }
    ]
  }
}
```

### 2. 防火墙配置
只允许 GitHub/GitLab 的 IP 访问 webhook 端口：

```bash
# GitHub IPs
sudo ufw allow from 192.30.252.0/22 to any port 9000
sudo ufw allow from 185.199.108.0/22 to any port 9000

# 或限制特定 IP
sudo ufw allow from <GitHub IP> to any port 9000
```

## 六、故障排查

### 查看日志
```bash
# Webhook 服务日志
sudo journalctl -u webhook -f

# 部署日志
tail -f /var/log/sms-platform/deploy.log
```

### 常见问题

**Q: Webhook 没有触发**
- 检查服务器防火墙是否开放 9000 端口
- 检查 GitHub/GitLab webhook 配置是否正确
- 查看 webhook 服务状态：`sudo systemctl status webhook`

**Q: 部署失败**
- 查看部署日志：`tail -100 /var/log/sms-platform/deploy.log`
- 检查 git pull 是否有冲突
- 检查 Docker 服务是否正常

**Q: 服务启动失败**
- 检查端口是否被占用：`sudo lsof -i :9000`
- 检查配置文件语法：`webhook -hooks /opt/sms-platform/deploy/webhook.json -test`
