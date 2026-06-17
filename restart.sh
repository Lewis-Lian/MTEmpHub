#!/bin/bash
# ==========================================
# MTEmpHub Ubuntu 服务器一键重启脚本
#
# 任意目录执行均可（脚本内部使用绝对路径）：
#   bash /var/www/mtemphub/restart.sh
# ==========================================
set -euo pipefail

SERVICE_NAME="attendance_api"

echo "=========================================="
echo "🔄 正在重启 MTEmpHub 服务..."
echo "=========================================="

echo ""
echo "[1/2] 重启后端 API 服务 ($SERVICE_NAME)..."
sudo systemctl restart "$SERVICE_NAME"
# systemctl restart 返回 0 仅代表"启动指令已发出"，不代表服务真的起来了
# 等待几秒后检查 active 状态，避免静默失败
sleep 3
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "❌ 后端服务启动失败，查看日志: sudo journalctl -u $SERVICE_NAME -n 30"
    exit 1
fi
echo "✅ 后端服务 ($SERVICE_NAME) 重启成功"

echo ""
echo "[2/2] 重新加载 Nginx 代理..."
if sudo systemctl reload nginx; then
    echo "✅ Nginx 重新加载成功"
else
    echo "❌ Nginx 重新加载失败"
    exit 1
fi

echo ""
echo "=========================================="
echo "🎉 应用重启完毕！"
echo "=========================================="
