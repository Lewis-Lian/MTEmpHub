#!/bin/bash
# ==========================================
# MTEmpHub Ubuntu 服务器一键更新脚本
#
# 任意目录执行均可（脚本内部使用绝对路径）：
#   bash /var/www/mtemphub/update.sh
# ==========================================
set -euo pipefail

PROJECT_DIR="/var/www/mtemphub"
SERVICE_NAME="attendance_api"
PIP_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"

cd "$PROJECT_DIR"

echo "=========================================="
echo "1. 拉取最新代码..."
echo "=========================================="
# package-lock.json 是平台相关的：不同机器 npm install 会按本地平台补全/重写
# （如 esbuild 平台子包），差异不应入 git。上一次 npm install 产生的本地改动
# 会挡住本次 pull，这里先丢弃它（npm 会按 package.json 重新生成，无损失）。
git checkout -- frontend/package-lock.json 2>/dev/null || true
# --ff-only：仅允许快进合并，遇到本地改动冲突时会失败而非自动合并
if ! git pull --ff-only origin master; then
    echo "❌ git pull 失败，可能有本地改动冲突或网络问题"
    echo "   排查: cd $PROJECT_DIR && git status"
    exit 1
fi

echo ""
echo "=========================================="
echo "2. 更新后端依赖..."
echo "=========================================="
if [ ! -d ".venv" ]; then
    echo "❌ 未找到 .venv 虚拟环境，请先执行 scripts/ubuntu/deploy_15.sh 完成初始化部署"
    exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --default-timeout=1000 -i "$PIP_INDEX" -r requirements.txt
# gunicorn 不在 requirements.txt（deploy_15.sh 单独安装），这里显式补装保证幂等
pip install --default-timeout=1000 -i "$PIP_INDEX" gunicorn

echo ""
echo "=========================================="
echo "3. 执行数据库迁移（幂等补列）..."
echo "=========================================="
# upgrade-legacy-schema 幂等补齐旧库缺失的表/列，可安全重复执行
# 注：不跑 init-db（它会执行全部 alembic 迁移，风险较高）
flask --app manage.py upgrade-legacy-schema

echo ""
echo "=========================================="
echo "4. 构建前端..."
echo "=========================================="
if [ ! -d "frontend" ]; then
    echo "❌ 未找到 frontend 目录"
    exit 1
fi
cd frontend
npm install
npm run build
cd "$PROJECT_DIR"
# npm install 会按服务器平台重写 package-lock.json，丢弃其本地改动保持工作区干净
# （下次 update.sh 第1步也会再清理一次，双保险）
git checkout -- frontend/package-lock.json 2>/dev/null || true

echo ""
echo "=========================================="
echo "5. 重启后端服务..."
echo "=========================================="
sudo systemctl restart "$SERVICE_NAME"
# systemctl restart 返回 0 仅代表"启动指令已发出"，不代表服务真的起来了
# 等待几秒后检查 active 状态，避免静默失败
sleep 3
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "❌ 服务启动失败，查看日志: sudo journalctl -u $SERVICE_NAME -n 30"
    exit 1
fi
echo "✅ 后端服务 ($SERVICE_NAME) 重启成功"

echo ""
echo "=========================================="
echo "6. 健康检查..."
echo "=========================================="
# 健康检查失败不中断脚本（服务可能仍在初始化），仅给出告警
if curl -sf --max-time 5 http://127.0.0.1:5000/health > /dev/null; then
    echo "✅ 健康检查通过"
else
    echo "⚠️ 健康检查未通过（服务可能仍在初始化），请稍后手动复测:"
    echo "   curl http://127.0.0.1:5000/health"
fi

echo ""
echo "=========================================="
echo "🎉 系统更新完毕！"
echo "=========================================="
