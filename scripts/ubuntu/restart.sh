#!/bin/bash

echo "=========================================="
echo "🔄 正在重启 MTEmpHub 服务..."
echo "=========================================="

echo "[1/2] 重启后端 API 服务 (attendance_api)..."
sudo systemctl restart attendance_api
if [ $? -eq 0 ]; then
    echo "✅ 后端服务重启成功！"
else
    echo "❌ 后端服务重启失败，请检查日志: sudo journalctl -u attendance_api -n 20"
fi

echo ""
echo "[2/2] 重新加载 Nginx 代理..."
sudo systemctl reload nginx
if [ $? -eq 0 ]; then
    echo "✅ Nginx 重新加载成功！"
else
    echo "❌ Nginx 重新加载失败！"
fi

echo ""
echo "=========================================="
echo "🎉 应用重启完毕！"
echo "=========================================="
