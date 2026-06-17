"""安全网脚本：切回 SQLite 数据库。

当 MySQL 连接失败导致应用无法启动时，运行此脚本切回 SQLite：
    python switch_sqlite.py            # 交互确认（默认）
    python switch_sqlite.py --force    # 跳过确认（用于自动化/无人值守）

注意：此脚本会改写 .env 中的 DATABASE_URL。生产环境误执行会导致写入分流到本地
SQLite 文件、MySQL 数据不再更新。执行前会自动备份原 .env 到 .env.bak。
"""

import os
import shutil
import sys

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
key = "DATABASE_URL"
value = "sqlite:///attendance.db"

# 默认要求二次确认；--force 跳过（兼容自动化调用）。
force = "--force" in sys.argv
if not force:
    print("⚠️  即将把 .env 的 DATABASE_URL 切换为 SQLite（会自动备份原 .env 为 .env.bak）。")
    print("    生产环境误执行会导致写入分流到本地 SQLite、MySQL 数据不再更新。")
    answer = input("确认切换？(yes/N): ").strip().lower()
    if answer not in ("yes", "y"):
        print("已取消，未做任何修改。")
        sys.exit(0)

lines = []
if os.path.exists(env_path):
    # 备份原 .env，避免误操作后无法回滚。
    shutil.copy2(env_path, env_path + ".bak")
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

print(f"✅ 已切换回 SQLite，请重启应用。（原 .env 已备份为 .env.bak）")
