#!/bin/bash

# ==========================================
# MTEmpHub Ubuntu 服务器一键更新脚本
# ==========================================

echo "=========================================="
echo "1. 拉取最新代码..."
echo "=========================================="
# 假设项目目录在当前执行路径下，如果是固定绝对路径可改为 cd /var/www/attendance_system 等
git pull origin master
if [ $? -ne 0 ]; then
    echo "❌ git pull 失败，请检查网络或冲突！"
    exit 1
fi

echo ""
echo "=========================================="
echo "2. 更新后端依赖..."
echo "=========================================="
# 检查是否存在虚拟环境
if [ -d ".venv" ]; then
    source .venv/bin/activate
    pip install --default-timeout=1000 -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
else
    echo "⚠️ 未找到 .venv 虚拟环境，请确保已初始化后端环境！"
fi

echo ""
echo "=========================================="
echo "3. 编译前端..."
echo "=========================================="
if [ -d "frontend" ]; then
    cd frontend
    npm install
    npm run build
    cd ..
else
    echo "⚠️ 未找到 frontend 目录，跳过前端构建！"
fi

echo ""
echo "=========================================="
echo "4. 重启后端服务..."
echo "=========================================="
# 重启 systemd 服务，会提示输入当前用户的 sudo 密码
sudo systemctl restart attendance_api
if [ $? -eq 0 ]; then
    echo "✅ 后端服务 (attendance_api) 重启成功！"
else
    echo "❌ 后端服务重启失败，请检查 service 状态！"
fi

echo ""
echo "=========================================="
echo "🎉 系统更新完毕！"
echo "=========================================="
