#!/usr/bin/env python3
"""一次性清理脚本：清除 2026-06 账套（账套3）因 secure_filename bug 产生的脏数据。

背景
----
`routes/admin_imports.py` 曾用 werkzeug 的 `secure_filename` 生成落盘文件名，它会删除所有中文，
导致 2026-06 账套上传的 6 个文件：
  1. 落盘时被归并成 3 个残缺文件名（如 `2026_6.xlsx`、`-_.xlsx`），互相覆盖；
  2. 6 条导入记录全部被错判为 `file_type=daily`（应为 leave/overtime/monthly/manager_*）；
  3. `imported_count=0`，明细表 2026-06 数据为 0 行——未写入任何考勤数据。

清理范围（经数据核对确认安全）
----
- 仅删除 `account_set_imports` 表中 `account_set_id` 属于 2026-06 账套的记录（6 条）。
- 仅删除本地 `static/uploads/account_sets/2026-06/` 下的残缺文件（文件名不含中文关键字）。
- **不删** 2026-06 账套本身（保留，清理后可直接重新上传）。
- **不删** 2026-04 / 2026-05 账套的任何记录（5 月虽标记 error，但数据已成功写入明细表，
  error 仅因项目迁移后旧路径找不到文件，删记录会丢真实考勤数据）。
- **不删** 任何考勤明细（daily_records / overtime_records / leave_records / monthly_reports），
  2026-06 明细为 0 行，无需清理。

使用方法
----
默认「干跑」只打印将删除的内容，不实际删除。确认无误后加 `--apply` 才真正执行：

    python scripts/cleanup_2026_06_dirty_imports.py            # 干跑预览
    python scripts/cleanup_2026_06_dirty_imports.py --apply    # 实际执行

连接复用项目 `create_app()`（读 .env 的 DATABASE_URL），与正式 app 行为一致。
"""

from __future__ import annotations

import argparse
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
# 确保能 import 项目模块
sys.path.insert(0, REPO_ROOT)

# 必须在 import config 之前加载 .env，否则 Config 类属性（如 SECRET_KEY）会在 import 时
# 读到空值并定型，后续 create_app 的 load_dotenv 也来不及修正。
from dotenv import load_dotenv
load_dotenv(os.path.join(REPO_ROOT, ".env"))

# 文件名中至少含其一才算「正常中文文件名」；不含则视为 secure_filename 残缺产物
_CHINESE_KEYWORDS = ("月", "请假", "加班", "管理人员", "员工")


def _looks_dirty(filename: str) -> bool:
    """判断文件名是否为 secure_filename 删中文后的残缺产物。"""
    return not any(k in filename for k in _CHINESE_KEYWORDS)


def main() -> int:
    parser = argparse.ArgumentParser(description="清理 2026-06 账套脏数据")
    parser.add_argument(
        "--apply", action="store_true",
        help="实际执行删除（默认只预览）",
    )
    parser.add_argument(
        "--db-host", default=None,
        help="临时覆盖数据库 host（不改 .env），例如 --db-host 172.16.20.14。默认读 .env 的 DATABASE_URL",
    )
    args = parser.parse_args()

    print(f"=== 模式: {'实际删除' if args.apply else '干跑预览（加 --apply 才真删）'} ===")

    # 如指定 --db-host，在 create_app 前覆盖 Config，保证 Flask-SQLAlchemy 用新 URI 初始化。
    # 密码含 @，靠字符串拼接/正则替换 URL 会破坏解析。改用 SQLAlchemy 的 URL.set 更新 host，
    # render_as_string 会自动把密码里的 @ 编码成 %40，回环解析正确。
    if args.db_host:
        from sqlalchemy.engine import make_url
        from config import Config
        new_url = make_url(Config.SQLALCHEMY_DATABASE_URI).set(host=args.db_host)
        Config.SQLALCHEMY_DATABASE_URI = new_url.render_as_string(hide_password=False)
        print(f"[DB] 已覆盖 host -> {args.db_host}")

    from app import create_app
    from models import db
    from models.account_set import AccountSet, AccountSetImport

    app = create_app()
    # 只打印 host:port/db 部分，避免日志泄露密码
    print(f"[DB] {app.config['SQLALCHEMY_DATABASE_URI'].split('@')[-1]}")

    with app.app_context():
        june = AccountSet.query.filter_by(month="2026-06").first()
        if not june:
            print("[WARN] 未找到 month=2026-06 的账套，无可清理记录。")
            return 0
        print(f"[账套] 2026-06 账套 id={june.id}")

        records = (
            AccountSetImport.query.filter_by(account_set_id=june.id)
            .order_by(AccountSetImport.id.asc())
            .all()
        )
        print(f"\n[导入记录] 账套{june.id} 共 {len(records)} 条：")
        for rec in records:
            flag = "❌将删" if args.apply else "🔍预览"
            print(f"  {flag} id={rec.id} ft={rec.file_type:<8} st={rec.status:<6} cnt={rec.imported_count:<4} | {rec.source_filename}")

        # 收集去重后的物理文件路径，只删残缺文件名的
        files_to_delete = []  # (path, exists, is_dirty)
        seen = set()
        for rec in records:
            path = (rec.stored_path or "").strip()
            if not path or path in seen:
                continue
            seen.add(path)
            basename = os.path.basename(path)
            exists = os.path.exists(path)
            dirty = _looks_dirty(basename)
            files_to_delete.append((path, exists, dirty, basename))

        print(f"\n[物理文件] 涉及 {len(files_to_delete)} 个唯一路径：")
        for path, exists, dirty, basename in files_to_delete:
            if not exists:
                flag, note = "⏭️跳过", "(文件不存在)"
            elif not dirty:
                flag, note = "⏭️保留", "(中文文件名，非残缺产物)"
            else:
                flag = "❌将删" if args.apply else "🔍预览"
                note = ""
            print(f"  {flag} {basename} {note}")

        if not args.apply:
            print("\n=== 预览完成，未做任何更改 ===")
            print("确认无误后执行：python scripts/cleanup_2026_06_dirty_imports.py --apply")
            return 0

        # —— 实际执行 ——
        deleted_records = (
            db.session.query(AccountSetImport)
            .filter(AccountSetImport.account_set_id == june.id)
            .delete(synchronize_session=False)
        )
        db.session.commit()
        print(f"\n[导入记录] 已删除 {deleted_records} 条。")

        removed_files = 0
        for path, exists, dirty, basename in files_to_delete:
            if exists and dirty:
                try:
                    os.remove(path)
                    removed_files += 1
                    print(f"  ✓ 已删除文件: {basename}")
                except OSError as e:
                    print(f"  ✗ 删除失败 {basename}: {e}")
        print(f"[物理文件] 共删除 {removed_files} 个。")

        print("\n=== 清理完成 ===")
        print("接下来请：1)重新部署含修复的代码  2)在账套页重新上传 6 月原始文件  3)点员工计算/管理人员计算")
    return 0


if __name__ == "__main__":
    sys.exit(main())
