#!/bin/bash
set -e

echo "=================================="
echo "开始在 Ubuntu (端口 80) 上部署 MTEmpHub"
echo "=================================="

# 1. 安装基础依赖和 Node.js
echo "[1/6] 安装系统依赖..."
sudo apt-update > /dev/null || true
sudo apt install -y python3-venv python3-pip nginx curl
if ! command -v node &> /dev/null
then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# 2. 构建前端
echo "[2/6] 安装前端依赖并构建..."
cd /var/www/mtemphub/frontend
npm install
npm run build

# 3. 初始化后端环境和数据库
echo "[3/6] 初始化后端虚拟环境和数据库..."
cd /var/www/mtemphub
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt gunicorn
flask --app manage.py init-db
flask --app manage.py init-admin

# 4. 配置 Systemd
echo "[4/6] 配置 Systemd 服务..."
cat << 'EOF' | sudo tee /etc/systemd/system/attendance_api.service
[Unit]
Description=Attendance System Backend API
After=network.target

[Service]
User=mt
WorkingDirectory=/var/www/mtemphub
Environment="PATH=/var/www/mtemphub/.venv/bin"
ExecStart=/var/www/mtemphub/.venv/bin/gunicorn -w 4 -b 127.0.0.1:5000 wsgi:app
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now attendance_api

# 5. 配置 Nginx 端口 80
echo "[5/6] 配置 Nginx 端口 80..."
cat << 'EOF' | sudo tee /etc/nginx/sites-available/attendance
server {
    listen 80;
    server_name _;

    # 考勤原始表上传体积较大，放开 Nginx 默认 1MB 的请求体限制，避免 413
    client_max_body_size 100m;

    root /var/www/mtemphub/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

echo "=================================="
echo "部署完成！服务已在 80 端口启动。"
echo "=================================="
