#!/usr/bin/env python3
"""合并 legacy-ui.css 中重复定义的裸选择器（仅限两段之间无该选择器其他引用的安全组）。

合并语义：属性集合 = 各段按出现顺序合并（值取最后定义段），输出到最后一处位置，
删除前面各段。同选择器同特异性下层叠结果严格等价。
用法：python3 merge_duplicate_rules.py [--apply]
"""
import re
import sys
import pathlib

CSS = pathlib.Path(__file__).resolve().parent.parent / "frontend/src/styles/legacy-ui.css"

# 侦查确认的 26 组安全选择器（无夹层引用）
SAFE = [
    ".account-action-button--danger", ".account-action-button--primary",
    ".account-action-button--success", ".account-action-button--warning",
    ".account-picker-summary", ".app-logout-button", ".app-page-nav",
    ".app-side-label", ".app-sidebar-caption", ".app-sidebar-error",
    ".attendance-override-edit-backdrop", ".attendance-override-edit-remark",
    ".dashboard-metric-label", ".dashboard-metric-value",
    ".daypanel-skeleton-field", ".dept-tree-label", ".legacy-table-empty-cell",
    ".master-modal-backdrop", ".master-modal-footer", ".master-static-head",
    ".panel-note", ".quick-employee-select-all", ".summary-download-checklist-head",
    ".top-nav-logout", ".top-nav-user-code", ".top-nav-user-role",
]


def parse_block(text: str, start: int):
    """start 指向 '{'，返回 (声明列表, 结束偏移'}'之后)。"""
    end = text.find("}", start)
    assert end != -1
    body = text[start + 1:end]
    decls = []
    for part in body.split(";"):
        part = part.strip()
        if part and ":" in part:
            key, _, val = part.partition(":")
            decls.append((key.strip(), val.strip()))
        elif part:
            raise ValueError(f"无法解析声明: {part!r}")
    return decls, end + 1


def main():
    apply = "--apply" in sys.argv
    text = CSS.read_text()
    edits = []  # (起, 止, 替换)
    report = []

    for sel in SAFE:
        pat = re.compile(r"(?m)^" + re.escape(sel) + r"\s*\{")
        matches = []
        for m in pat.finditer(text):
            # 跳过多行逗号组的成员行：其上一个非空行以逗号结尾时，
            # 本行不是选择器组的起点，不能当作独立定义段处理
            prev = text[:m.start()].rstrip().splitlines()[-1].rstrip() if text[:m.start()].rstrip() else ""
            if prev.endswith(","):
                continue
            matches.append(m)
        if len(matches) < 2:
            report.append(f"跳过 {sel}: 仅 {len(matches)} 处")
            continue
        blocks = [parse_block(text, m.end() - 1) for m in matches]
        merged: dict[str, str] = {}
        for decls, _ in blocks:
            for k, v in decls:
                merged[k] = v  # dict 更新保持首次插入顺序，值取最后 -> 层叠等价
        new_block = f"{sel} {{\n" + "".join(f"  {k}: {v};\n" for k, v in merged.items()) + "}"
        # 删除除最后一处外的全部，最后一处替换为合并块
        for m, (decls, e) in zip(matches[:-1], blocks[:-1]):
            edits.append((m.start(), e + (0 if text[e:e+1] != "\n" else 1), ""))
        last_m, (last_decls, last_e) = matches[-1], blocks[-1]
        edits.append((last_m.start(), last_e, new_block))
        report.append(f"{sel}: {len(matches)} 段 {sum(len(d) for d, _ in blocks)} 条声明 -> {len(merged)} 条")

    for line in report:
        print(line)
    if not apply:
        print("\n[dry-run] 未写入。加 --apply 执行。")
        return
    result, cur = [], 0
    for s, e, rep in sorted(edits, key=lambda x: x[0]):
        assert s >= cur, "编辑区间重叠"
        result.append(text[cur:s])
        result.append(rep)
        cur = e
    result.append(text[cur:])
    CSS.write_text(re.sub(r"\n{3,}", "\n\n", "".join(result)))
    print("\n已写入。")


if __name__ == "__main__":
    main()
