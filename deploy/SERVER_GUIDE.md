# 从零开始部署 SMS 营销平台

## 第一步：购买服务器

### 推荐云服务商

| 服务商 | 推荐配置 | 价格参考 | 适合场景 |
|--------|---------|---------|---------|
| **阿里云** | 2核4G | ¥100-200/月 | 国内访问快 |
| **腾讯云** | 2核4G | ¥100-200/月 | 国内访问快 |
| **AWS** | t3.medium | $30-50/月 | 全球访问 |
| **DigitalOcean** | 2GB RAM | $12/月 | 简单便宜 |
| **Vultr** | 2GB RAM | $12/月 | 简单便宜 |

### 服务器配置要求

- **CPU**: 2核
- **内存**: 4GB（最低2GB）
- **硬盘**: 40GB SSD
- **系统**: Ubuntu 22.04 LTS（推荐）
- **网络**: 公网IP

### 购买步骤（以阿里云为例）

1. 访问 https://www.aliyun.com
2. 注册/登录账号
3. 选择"云服务器 ECS"
4. 配置选择：
   - 地域：根据你的用户群体选择（墨西哥用户选美西）
   - 实例规格：ecs.t6-c1m2.large（2核4G）
   - 操作系统：Ubuntu 22.04 64位
   - 硬盘：40GB ESSD
   - 带宽：5Mbps（或按流量计费）
5. 设置登录密码
6. 完成购买

---

## 第二步：服务器初始化

### 1. 连接到服务器

```bash
# Windows 使用 PuTTY 或 PowerShell
# Mac/Linux 使用终端
ssh root@你的服务器IP
```

### 2. 更新系统

```bash
apt update && apt upgrade -y
```

### 3. 创建部署用户

```bash
adduser deployer
usermod -aG sudo deployer
usermod -aG docker deployer
su - deployer
```

### 4. 安装必要软件

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo systemctl enable docker
sudo systemctl start docker

# 安装 Docker Compose
sudo apt install docker-compose -y

# 安装 Git
sudo apt install git -y

# 安装 Nginx（可选，用于反向代理）
sudo apt install nginx -y
```

---

## 第三步：部署应用

### 1. 克隆代码

```bash
cd /opt
sudo git clone <你的仓库地址>
sudo chown -R deployer:deployer sms-platform
cd sms-platform
```

### 2. 配置环境变量

```bash
cp .env.example .env
nano .env
```

修改以下内容：
```env
# 数据库密码（改成强密码）
POSTGRES_PASSWORD=你的强密码

# SMS API 配置
SMS_DOMAIN=sg-msg.infin8linx.com
SMS_SPID=Rileci_MXMKT
SMS_API_PWD=Rileci62
SMS_SENDER_NAME=Rileci_墨西哥MKT

# 应用密钥（随机生成）
SECRET_KEY=$(openssl rand -base64 32)
```

### 3. 启动服务

```bash
docker-compose up -d
```

### 4. 检查状态

```bash
docker-compose ps
docker-compose logs -f
```

---

## 第四步：配置域名（可选）

### 1. 购买域名

- 阿里云：https://wanwang.aliyun.com
- 腾讯云：https://cloud.tencent.com/product/domain
- Namecheap：https://www.namecheap.com

### 2. 解析域名

在域名管理面板添加 A 记录：
```
类型：A
主机：@（或 sms）
值：你的服务器IP
TTL: 600
```

### 3. 配置 Nginx

```bash
sudo nano /etc/nginx/sites-available/sms-platform
```

内容：
```nginx
server {
    listen 80;
    server_name 你的域名;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/sms-platform /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. 配置 HTTPS（Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d 你的域名
```

---

## 第五步：配置 Webhook 自动部署

### 1. 运行初始化脚本

```bash
cd /opt/sms-platform
sudo bash deploy/setup.sh <你的仓库地址>
```

### 2. 配置 GitHub/GitLab Webhook

**GitHub**:
1. 仓库 → Settings → Webhooks → Add webhook
2. Payload URL: `http://你的服务器IP:9000/hooks/deploy-sms-platform`
3. Content type: `application/json`
4. Events: Just the push event
5. Active: ✅

**GitLab**:
1. 项目 → Settings → Webhooks
2. URL: `http://你的服务器IP:9000/hooks/deploy-sms-platform`
3. Trigger: Push events, Branch: main

### 3. 测试

```bash
# 修改代码
echo "# test" >> README.md
git add .
git commit -m "test deploy"
git push origin main

# 查看部署日志
tail -f /var/log/sms-platform/deploy.log
```

---

## 第六步：日常维护

### 查看日志

```bash
# 应用日志
docker-compose logs -f

# 部署日志
tail -f /var/log/sms-platform/deploy.log

# Webhook 日志
sudo journalctl -u webhook -f
```

### 手动部署

```bash
cd /opt/sms-platform
git pull
docker-compose build
docker-compose up -d
```

### 备份数据库

```bash
# 导出数据库
docker-compose exec postgres pg_dump -U sms_user sms_platform > backup.sql

# 导入数据库
docker-compose exec -T postgres psql -U sms_user sms_platform < backup.sql
```

### 更新系统

```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

---

## 常见问题

### Q: 无法访问应用？
```bash
# 检查服务状态
docker-compose ps

# 检查端口
sudo ss -tlnp | grep 5000

# 检查防火墙
sudo ufw status
sudo ufw allow 5000
```

### Q: Webhook 不触发？
```bash
# 检查 webhook 服务
sudo systemctl status webhook

# 检查日志
sudo journalctl -u webhook -n 50

# 测试 webhook
curl -X POST http://localhost:9000/hooks/deploy-sms-platform
```

### Q: 数据库连接失败？
```bash
# 检查数据库容器
docker-compose ps postgres

# 查看数据库日志
docker-compose logs postgres

# 重启数据库
docker-compose restart postgres
```

---

## 费用估算

| 项目 | 月费用 |
|------|--------|
| 服务器（2核4G） | ¥100-200 |
| 域名 | ¥5-10 |
| SSL 证书 | 免费（Let's Encrypt） |
| **总计** | **¥105-210/月** |

---

## 下一步

完成部署后：
1. 访问 `http://你的服务器IP` 或 `https://你的域名`
2. 使用默认账号登录：`admin` / `admin123`
3. 修改默认密码
4. 配置 SMS API
5. 开始使用！

有问题随时问我！
