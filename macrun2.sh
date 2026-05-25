#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-5000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
VENV_DIR="${VENV_DIR:-.venv-mac2}"
PYTHON_BIN="$VENV_DIR/bin/python3"
PIP_BIN="$VENV_DIR/bin/pip"

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
    python3 -m venv "$VENV_DIR"
fi

if [ ! -x "$PYTHON_BIN" ]; then
    echo "Python not found in $VENV_DIR. Remove the broken venv or set VENV_DIR to a valid one." >&2
    exit 1
fi

if ! "$PYTHON_BIN" -m pip --version >/dev/null 2>&1; then
    "$PYTHON_BIN" -m ensurepip --upgrade
fi

"$PIP_BIN" install -r requirements.txt

if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    cp .env.example .env
fi

if [ ! -d "frontend/node_modules" ]; then
    (
        cd frontend
        npm install
    )
fi

echo "后端 API 将启动在: http://${BACKEND_HOST}:${BACKEND_PORT}"
echo "前端开发服务将启动在: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "前端将通过代理访问后端: ${VITE_BACKEND_TARGET}"

"$PYTHON_BIN" -m flask --app app:app run --debug --host="$BACKEND_HOST" --port="$BACKEND_PORT" &
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
