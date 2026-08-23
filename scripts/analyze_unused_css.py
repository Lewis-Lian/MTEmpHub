#!/usr/bin/env python3
"""CSS 死类名清理（多文件）+ 混合选择器精修。

对每个声明块：
- 选择器组内每个选择器的所有类名都无 TSX/HTML 出处 -> 整块删除
- 部分死 -> 从逗号组中删除死选择器，保留活选择器与声明块
- @media 内规则全部被删 -> 连 @media 壳一起删

类名在用判定：出现在任何 .ts/.tsx/.html 源码文本中，或以源码模板字符串
动态前缀（`prefix${...}` 的静态段）开头。
用法：python3 analyze_unused_css.py [--apply] [css文件...]
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src"
DEFAULT_FILES = [
    "styles/legacy-ui.css",
    "styles/admin-ui.css",
    "styles/components/app-tabs.css",
    "styles/components/employee-picker.css",
    "styles/components/query-table.css",
    "styles/components/notification.css",
    "styles/components/confirm-dialog.css",
    "styles/components/slider-captcha.css",
    "styles/components/attendance-calendar.css",
    "pages/query/QueryHome.css",
    "pages/query/dashboard-shared.css",
]


def strip_comments(text: str) -> tuple[str, list[int]]:
    """返回无注释文本及每个字符在原文本中的偏移表。"""
    out, pos = [], []
    i, n = 0, len(text)
    while i < n:
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j == -1 else j + 2
            i = j
        else:
            out.append(text[i])
            pos.append(i)
            i += 1
    return "".join(out), pos


def split_top_level(text: str, start: int, end: int):
    """在 [start, end) 内按顶层大括号切分出 (prelude, prelude_start, body_start, body_end)。"""
    items = []
    depth = 0
    prelude_start = start
    i = start
    while i < end:
        c = text[i]
        if c == "{":
            if depth == 0:
                prelude = text[prelude_start:i].strip()
                body_start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                items.append((prelude, prelude_start, body_start, i + 1))
                prelude_start = i + 1
        i += 1
    return items


def build_usage():
    src_text = []
    dynamic_prefixes = []
    for p in ROOT.rglob("*"):
        if p.suffix not in (".ts", ".tsx", ".html") or ".test." in p.name:
            continue
        t = p.read_text(errors="ignore")
        src_text.append(t)
        for m in re.finditer(r"([a-zA-Z0-9_-]+)\$\{", t):
            dynamic_prefixes.append(m.group(1))
    blob = "\n".join(src_text)
    prefixes = set(dynamic_prefixes)

    def used(cls: str) -> bool:
        if cls in blob:
            return True
        return any(cls.startswith(p) and len(cls) > len(p) for p in prefixes)

    return used


def selector_classes(selector: str) -> list[str]:
    return re.findall(r"\.([a-zA-Z0-9_-]+)", selector)


def split_selectors(group: str) -> list[str]:
    parts, buf, depth = [], [], 0
    for ch in group:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return [p.strip() for p in parts if p.strip()]


def content_start(text: str, i: int, end: int) -> int:
    while i < end and text[i] in " \t\r\n":
        i += 1
    return i


def process_css(css_path: pathlib.Path, used, apply: bool) -> None:
    original = css_path.read_text()
    clean, pos = strip_comments(original)
    edits = []  # (原偏移起, 原偏移止, 替换文本)
    stats = {"dead_rules": 0, "pruned_selectors": 0, "dead_media": 0, "mixed_kept": 0}

    def analyze_rule(sel: str, sel_start: int, body_start: int, body_end: int) -> bool:
        """对混合块登记 prelude 重组编辑；整块死返回 True。"""
        sels = split_selectors(sel)
        alive, dead = [], []
        for one in sels:
            (alive if any(used(c) for c in selector_classes(one)) or not selector_classes(one) else dead).append(one)
        if not dead:
            return False
        if not alive:
            stats["dead_rules"] += 1
            s = content_start(clean, sel_start, body_end)
            edits.append((pos[s], pos[body_end - 1] + 1, ""))
            return True
        stats["pruned_selectors"] += len(dead)
        # 只替换 prelude 区域 [选择器首字符, '{')，声明块原样保留
        s = content_start(clean, sel_start, body_end)
        edits.append((pos[s], pos[body_start], ",\n".join(alive) + " "))
        return False

    for prelude, prelude_start, bs, be in split_top_level(clean, 0, len(clean)):
        if prelude.startswith("@media"):
            inner = split_top_level(clean, bs + 1, be - 1)
            results = []
            for sel, sel_start, s, e in inner:
                if not sel or sel.startswith("@"):
                    results.append(False)
                    continue
                results.append(analyze_rule(sel, sel_start, s, e))
            if results and all(results):
                stats["dead_media"] += 1
                # 撤掉本 @media 内已登记的子规则编辑（连续追加在 edits 尾部），改为整壳删除
                media_sub_count = results.count(True)
                del edits[len(edits) - media_sub_count:]
                stats["dead_rules"] -= media_sub_count
                s = content_start(clean, prelude_start, be)
                edits.append((pos[s], pos[be - 1] + 1, ""))
        elif prelude.startswith("@"):
            continue  # @keyframes / @font-face 等
        else:
            analyze_rule(prelude, prelude_start, bs, be)

    print(f"\n== {css_path.name}: 删除整块 {stats['dead_rules']}, 精修死选择器 {stats['pruned_selectors']}, 删除空 @media {stats['dead_media']}")
    if not apply:
        return
    result = []
    cur = 0
    for s, e, rep in sorted(edits, key=lambda x: x[0]):
        result.append(original[cur:s])
        result.append(rep)
        cur = e
    result.append(original[cur:])
    new_text = re.sub(r"\n{3,}", "\n\n", "".join(result))
    css_path.write_text(new_text)


def main():
    args = sys.argv[1:]
    apply = "--apply" in args
    files = [a for a in args if not a.startswith("--")] or DEFAULT_FILES
    used = build_usage()
    for rel in files:
        process_css(ROOT / rel, used, apply)
    if not apply:
        print("\n[dry-run] 未写入。加 --apply 执行。")


if __name__ == "__main__":
    main()
