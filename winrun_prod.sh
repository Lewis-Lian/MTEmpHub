#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-5000}"
HEALTHCHECK_HOST="${HEALTHCHECK_HOST:-127.0.0.1}"
VENV_DIR="${VENV_DIR:-.venv-win-prod}"

export APP_ENV="${APP_ENV:-production}"
export FLASK_ENV="${FLASK_ENV:-production}"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_NO_CACHE_DIR=1

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
python -m pip install -r requirements.txt waitress

if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

mkdir -p instance static/uploads logs

python -c "from app import create_app; create_app(); print('Flask API bootstrap OK')"

echo "后端 API 生产服务将启动在: http://${HOST}:${PORT}"
echo "健康检查地址: http://${HEALTHCHECK_HOST}:${PORT}/health"

python -m waitress --host="$HOST" --port="$PORT" --threads=8 --channel-timeout=120 wsgi:app
