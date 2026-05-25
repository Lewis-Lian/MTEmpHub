#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

BACKEND_HOST="${BACKEND_HOST:-${HOST:-127.0.0.1}}"
BACKEND_PORT="${BACKEND_PORT:-${PORT:-5000}}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
VENV_DIR="${VENV_DIR:-.venv-win}"
INSTALL_FRONTEND_DEPS="${INSTALL_FRONTEND_DEPS:-1}"

export FLASK_ENV="${FLASK_ENV:-development}"
export FLASK_DEBUG="${FLASK_DEBUG:-1}"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_CACHE_DIR=1
export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://${FRONTEND_HOST}:${FRONTEND_PORT}}"
export FRONTEND_APP_URL="${FRONTEND_APP_URL:-$FRONTEND_ORIGIN}"
export VITE_BACKEND_TARGET="${VITE_BACKEND_TARGET:-http://${BACKEND_HOST}:${BACKEND_PORT}}"

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

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python -m venv "$VENV_DIR"
fi

if [ -f "$VENV_DIR/Scripts/activate" ]; then
    # shellcheck disable=SC1090
    source "$VENV_DIR/Scripts/activate"
elif [ -f "$VENV_DIR/bin/activate" ]; then
    # shellcheck disable=SC1090
    source "$VENV_DIR/bin/activate"
else
    echo "Cannot find virtualenv activation script." >&2
    exit 1
fi

echo "Installing dependencies..."
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

mkdir -p instance static/uploads logs

if [ "$INSTALL_FRONTEND_DEPS" = "1" ] && [ ! -d "frontend/node_modules" ]; then
    (
        cd frontend
        npm install
    )
fi

python -c "from app import create_app; create_app(); print('Flask API bootstrap OK')"

echo "后端 API 将启动在: http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "前端开发服务将启动在: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "前端代理后端目标: ${VITE_BACKEND_TARGET}"
echo "后端健康检查地址: http://${BACKEND_HOST}:${BACKEND_PORT}/health"

python -m flask --app app:app run --debug --host="$BACKEND_HOST" --port="$BACKEND_PORT" &
BACKEND_PID=$!

(
    cd frontend
    npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo "按 Ctrl+C 同时停止前后端服务。"

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
