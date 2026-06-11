import os
import re
import subprocess

frontend_dir = "/Users/lewis/Lewis/code/git/MTEmpHub/frontend/src"

# 1. 直接用 git checkout 还原那5个只在这步被动过的文件
files_to_restore = [
    "layouts/AppShell.tsx",
    "pages/query/AbnormalQueryPage.tsx",
    "pages/query/EmployeeDashboardPage.tsx",
    "pages/query/QueryHomePage.tsx",
    "pages/query/QueryPage.tsx"
]
for f in files_to_restore:
    subprocess.run(["git", "checkout", "--", os.path.join(frontend_dir, f)])

# 2. 还原 legacy-ui.css 中追加的内容
legacy_ui_path = os.path.join(frontend_dir, "styles", "legacy-ui.css")
with open(legacy_ui_path, "r", encoding="utf-8") as f:
    legacy_content = f.read()

idx = legacy_content.find("/* ==========================================================================\n   全局背景流光球与网点背景")
if idx != -1:
    legacy_content = legacy_content[:idx].strip() + "\n"
    with open(legacy_ui_path, "w", encoding="utf-8") as f:
        f.write(legacy_content)

# 3. 还原 EmployeeDashboardPage.css 的背景
# 我们之前删除了包含极光流光球的部分。我们可以从 HEAD 版本中提取这部分，插回当前文件，
# 或者把 HEAD 版本拿过来，重放 1. 删除 transform 2. 去包裹感 3. 改 flex 等等。
# 其实我们之前是在 .employee-dashboard-page { 里删除了 background 等属性，
# 以及整个 .employee-dashboard-page .qh-glow-sphere 的代码块。
# 由于直接从 HEAD 拿比较麻烦，我们干脆把刚才改的 EmployeeDashboardPage.css 内容里的缺漏手动加回去。
dash_css_path = os.path.join(frontend_dir, "pages", "query", "EmployeeDashboardPage.css")
with open(dash_css_path, "r", encoding="utf-8") as f:
    dash_content = f.read()

# 在 .employee-dashboard-page { 里找位置塞回 background 属性
if "background-color: #f8fafc;" not in dash_content:
    dash_content = dash_content.replace(".employee-dashboard-page {\n  padding: 24px;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  min-width: 0;",
    ".employee-dashboard-page {\n  padding: 24px;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n  min-width: 0;\n  background-color: #f8fafc;\n  background-image: radial-gradient(circle at 1px 1px, #e2e8f0 1.5px, transparent 0);\n  background-size: 28px 28px;")

# 找回流光球的 CSS，从 git 中获取
original_css = subprocess.check_output(["git", "show", "HEAD:frontend/src/pages/query/EmployeeDashboardPage.css"]).decode('utf-8')
match = re.search(r'/\* 极光动态流光背景球 \*/[\s\S]*?@keyframes floatSphere[\s\S]*?\}\s*\}', original_css)
if match and "/* 极光动态流光背景球 */" not in dash_content:
    glow_css = match.group(0)
    # 将 glow_css 插到末尾或者前面某个位置
    # 我们插到文件中间即可，比如在 .employee-dashboard-page .query-filter-rail 前面
    idx = dash_content.find("/* 保证内容在上层")
    if idx != -1:
        dash_content = dash_content[:idx] + glow_css + "\n\n" + dash_content[idx:]
    else:
        dash_content += "\n" + glow_css

with open(dash_css_path, "w", encoding="utf-8") as f:
    f.write(dash_content)

print("Rollback applied successfully.")
