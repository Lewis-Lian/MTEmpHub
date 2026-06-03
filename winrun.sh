#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-5000}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"
VENV_DIR="${VENV_DIR:-.venv-win-prod}"

export APP_ENV="${APP_ENV:-production}"
export FLASK_ENV="${FLASK_ENV:-production}"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_CACHE_DIR=1
export VITE_BACKEND_TARGET="${VITE_BACKEND_TARGET:-http://127.0.0.1:${BACKEND_PORT}}"
export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://${FRONTEND_HOST}:${FRONTEND_PORT}}"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    local exit_code="$?"

    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
        kill "$BACKEND_PID" >/dev/null 2>&1 || true
    fi

    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
        kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    fi

    wait >/dev/null 2>&1 || true
    exit "$exit_code"
}

trap cleanup INT TERM EXIT

# 检查 Python
if ! command -v python &>/dev/null; then
    echo "错误：未找到 python，请确认 Python 已安装并加入 PATH。" >&2
    exit 1
fi

# 创建虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo "正在创建虚拟环境..."
    python -m venv "$VENV_DIR"
fi

# 激活虚拟环境
if [ -f "$VENV_DIR/Scripts/activate" ]; then
    source "$VENV_DIR/Scripts/activate"
elif [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
else
    echo "错误：找不到虚拟环境激活脚本。" >&2
    exit 1
fi

# 安装 Python 依赖
echo "正在安装 Python 依赖..."
python -m pip install --upgrade pip -q
python -m pip install -r requirements.txt waitress -q

# 初始化 .env
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    echo "正在从 .env.example 创建 .env..."
    cp .env.example .env
fi

# 创建运行时目录
mkdir -p instance static/uploads logs

# 初始化数据库
echo "正在初始化数据库..."
python -m flask --app manage.py init-db

# 初始化默认管理员
echo "正在初始化默认管理员..."
python -m flask --app manage.py init-admin

# 安装前端依赖
if [ ! -d "frontend/node_modules" ]; then
    echo "正在安装前端依赖..."
    (
        cd frontend
        npm install
    )
fi

# 构建前端生产版本
echo "正在构建前端..."
(
    cd frontend
    npm run build
)

echo ""
echo "============================================"
echo "  后端 API:  http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "  前端页面:  http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "  健康检查:  http://127.0.0.1:${BACKEND_PORT}/health"
echo "  按 Ctrl+C 同时停止前后端"
echo "============================================"
echo ""

python -m waitress --host="$BACKEND_HOST" --port="$BACKEND_PORT" --threads=8 --channel-timeout=120 wsgi:app &
BACKEND_PID=$!

(
    cd frontend
    npx vite preview --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

while true; do
    if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
        wait "$BACKEND_PID"
        break
    fi

    if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
        wait "$FRONTEND_PID"
        break
    fi

    sleep 1
done
