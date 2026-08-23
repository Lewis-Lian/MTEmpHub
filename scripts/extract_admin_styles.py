#!/usr/bin/env python3
"""把 admin 页面中重复的静态内联 style 抽取为 admin-ui.css 公共类。

只处理纯静态 style={{...}}（无嵌套对象/三元/展开/函数调用），
且标签的 className 必须是静态字符串或不存在；动态 className 标签跳过。
用法：python3 extract_admin_styles.py [--apply]
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "frontend/src"

FILES = [
    "pages/admin/EmployeesPage.tsx",
    "pages/admin/AccountsPage.tsx",
    "pages/admin/DepartmentsPage.tsx",
    "pages/admin/ShiftsPage.tsx",
    "pages/admin/AdminDashboardPage.tsx",
    "pages/admin/DatabaseSettingsPage.tsx",
    "pages/query/SummaryDownloadPage.tsx",
]

PX_PROPS = {
    "width", "height", "margin", "padding", "paddingTop", "paddingBottom",
    "paddingLeft", "paddingRight", "gap", "fontSize", "top", "right", "bottom",
    "left", "minWidth", "maxWidth", "minHeight", "borderRadius",
}

# 归一化组合 -> 类名（属性按键排序后分号连接）
MAPPING = {
    "alignItems:center; display:flex; gap:8px": "admin-row",
    "alignItems:center; display:flex; gap:12px": "admin-row-gap12",
    "display:flex; flexDirection:column; gap:16px": "admin-stack",
    "display:flex; flexDirection:column; gap:24px": "admin-stack-lg",
    "display:flex; flexDirection:column; gap:4px": "admin-stack-sm",
    "display:flex; flexDirection:column; margin:0px; minWidth:0px; width:100%": "admin-fill",
    "display:grid; gap:16px; gridTemplateColumns:1fr 1fr": "admin-form-grid",
    "gridColumn:1 / -1; margin:0px": "admin-form-grid-wide",
    "borderBottom:1px solid #e2e8f0; color:#1e293b; fontSize:15px; fontWeight:600; margin:0px; paddingBottom:8px": "admin-modal-title",
    "color:#334155; fontSize:14px": "admin-text",
    "fontSize:13px; fontWeight:500": "admin-text-sm",
    "accentColor:#2563eb; cursor:pointer; height:16px; margin:0px; width:16px": "admin-checkbox",
    "background:transparent; border:none; color:#64748b; cursor:pointer; fontSize:20px; position:absolute; right:16px; top:16px": "admin-modal-close",
    "background:transparent; border:none; color:#64748b; cursor:pointer; fontSize:20px; lineHeight:1; padding:0px": "admin-icon-btn",
}

TAG_RE = re.compile(r"<([A-Za-z][\w.]*)((?:\"[^\"]*\"|'[^']*'|[^<>\"'])*)>")
STYLE_RE = re.compile(r'style=\{\{([^{}]+)\}\}')


def normalize(raw: str):
    props = []
    for part in raw.split(","):
        part = part.strip()
        if not part or ":" not in part:
            return None
        if any(t in part for t in ("?", "&&", "...", "(", ";", "`")):
            return None
        key, _, val = part.partition(":")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if not key.isidentifier():
            return None
        if val.lstrip("-").isdigit() and key in PX_PROPS:
            val = f"{val}px"
        props.append(f"{key}:{val}")
    return "; ".join(sorted(props))


def process_tag(attrs: str):
    """返回 (新attrs, 类名或None)。"""
    m = STYLE_RE.search(attrs)
    if not m:
        return attrs, None
    norm = normalize(m.group(1))
    if norm is None:
        return attrs, None
    cls = MAPPING.get(norm)
    if not cls:
        return attrs, None
    # 动态 className 则跳过
    if re.search(r"className=\{", attrs):
        return attrs, None
    rest = attrs[: m.start()] + attrs[m.end():]
    cm = re.search(r'className="([^"]*)"', rest)
    if cm:
        new_attrs = rest[: cm.start()] + f'className="{cm.group(1)} {cls}"' + rest[cm.end():]
    else:
        new_attrs = rest[: m.start()] + f'className="{cls}"' + rest[m.start():]
    return re.sub(r"  +", " ", new_attrs), cls


def main():
    apply = "--apply" in sys.argv
    total = 0
    for rel in FILES:
        path = ROOT / rel
        text = path.read_text()
        out = []
        last = 0
        count = 0
        for m in TAG_RE.finditer(text):
            new_attrs, cls = process_tag(m.group(2))
            if cls is None:
                continue
            out.append(text[last: m.start(2)])
            out.append(new_attrs)
            last = m.end(2)
            count += 1
            line = text.count("\n", 0, m.start()) + 1
            print(f"{rel}:{line}  -> {cls}")
        out.append(text[last:])
        total += count
        if apply and count:
            path.write_text("".join(out))
    print(f"\n共替换 {total} 处" + ("（已写入）" if apply else "（dry-run）"))


if __name__ == "__main__":
    main()
