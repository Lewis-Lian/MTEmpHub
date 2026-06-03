#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

PROJECT_ROOT="${PROJECT_ROOT:-$PROJECT_DIR}"
PYTHON_CMD="${PYTHON_CMD:-python}"
PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
PIP_TRUSTED_HOST="${PIP_TRUSTED_HOST:-pypi.tuna.tsinghua.edu.cn}"
PORT="${PORT:-5000}"
VENV_DIR="${VENV_DIR:-.venv-win-prod}"
SERVICE_NAME="${SERVICE_NAME:-attendance-system}"
NSSM_PATH="${NSSM_PATH:-}"
UPGRADE_LEGACY_SCHEMA="${UPGRADE_LEGACY_SCHEMA:-0}"
INSTALL_SERVICE="${INSTALL_SERVICE:-0}"
SKIP_INIT_ADMIN="${SKIP_INIT_ADMIN:-0}"

POWERSHELL_CMD=""
if command -v powershell >/dev/null 2>&1; then
    POWERSHELL_CMD="powershell"
elif command -v pwsh >/dev/null 2>&1; then
    POWERSHELL_CMD="pwsh"
else
    echo "未找到 powershell 或 pwsh，请先安装 PowerShell。" >&2
    exit 1
fi

PS_ARGS=(
    -ExecutionPolicy Bypass
    -File "./deploy_production.ps1"
    -ProjectRoot "$PROJECT_ROOT"
    -PythonCmd "$PYTHON_CMD"
    -PipIndexUrl "$PIP_INDEX_URL"
    -PipTrustedHost "$PIP_TRUSTED_HOST"
    -Port "$PORT"
    -VenvDir "$VENV_DIR"
    -ServiceName "$SERVICE_NAME"
)

if [ -n "$NSSM_PATH" ]; then
    PS_ARGS+=(-NssmPath "$NSSM_PATH")
fi

if [ "$UPGRADE_LEGACY_SCHEMA" = "1" ]; then
    PS_ARGS+=(-UpgradeLegacySchema)
fi

if [ "$INSTALL_SERVICE" = "1" ]; then
    PS_ARGS+=(-InstallService)
fi

if [ "$SKIP_INIT_ADMIN" = "1" ]; then
    PS_ARGS+=(-SkipInitAdmin)
fi

echo "项目目录: $PROJECT_ROOT"
echo "部署端口: $PORT"
echo "生产虚拟环境: $VENV_DIR"
echo "安装服务: $INSTALL_SERVICE"
echo "旧库升级: $UPGRADE_LEGACY_SCHEMA"

"$POWERSHELL_CMD" "${PS_ARGS[@]}"
