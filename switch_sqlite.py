"""安全网脚本：切回 SQLite 数据库。

当 MySQL 连接失败导致应用无法启动时，直接运行此脚本：
    python switch_sqlite.py
"""

import os

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
key = "DATABASE_URL"
value = "sqlite:///attendance.db"

lines = []
if os.path.exists(env_path):
    with open(env_path, encoding="utf-8") as f:
        lines = f.readlines()

found = False
new_lines = []
for line in lines:
    stripped = line.strip()
    if stripped.startswith("#") or "=" not in stripped:
        new_lines.append(line)
        continue
    k, _, _ = stripped.partition("=")
    if k.strip() == key:
        new_lines.append(f"{key}={value}\n")
        found = True
    else:
        new_lines.append(line)
if not found:
    new_lines.append(f"{key}={value}\n")

with open(env_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print(f"✅ 已切换回 SQLite，请重启应用。")
