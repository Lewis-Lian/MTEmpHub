"""轻量的 .env 文件读写工具。"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse, quote


def read_env(path: str | Path) -> dict[str, str]:
    """读取 .env 文件为 dict，忽略注释行和空行。"""
    result: dict[str, str] = {}
    p = Path(path)
    if not p.exists():
        return result
    for line in p.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" in stripped:
            key, _, value = stripped.partition("=")
            result[key.strip()] = value.strip()
    return result


def write_env_value(path: str | Path, key: str, value: str) -> None:
    """更新 .env 文件中指定 key 的值，保留其他行不变。"""
    p = Path(path)
    lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
    found = False
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        k, _, _ = stripped.partition("=")
        if k.strip() == key:
            new_lines.append(f"{key}={value}")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"{key}={value}")
    p.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    # 同步到当前进程环境变量
    os.environ[key] = value


def build_mysql_url(host: str, port: int, username: str, password: str, database: str) -> str:
    """构建 MySQL 连接字符串。"""
    return f"mysql+pymysql://{quote(username, safe='')}:{quote(password, safe='')}@{host}:{port}/{database}?charset=utf8mb4"


def parse_mysql_url(url: str) -> dict[str, str | int | None]:
    """解析 MySQL 连接字符串为组件。"""
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "",
        "port": parsed.port or 3306,
        "username": parsed.username or "",
        "password": parsed.password or "",
        "database": parsed.path.lstrip("/") or "",
    }
