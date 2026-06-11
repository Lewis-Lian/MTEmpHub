import os
import re

frontend_dir = "/Users/lewis/Lewis/code/git/MTEmpHub/frontend"
legacy_ui_path = os.path.join(frontend_dir, "src/styles/legacy-ui.css")
dashboard_css_path = os.path.join(frontend_dir, "src/pages/query/EmployeeDashboardPage.css")

# 1. 修改 legacy-ui.css
with open(legacy_ui_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 移除悬浮放大动效
content = re.sub(r'\s*transform:\s*(?:translateY\([^)]+\)|scale\([^)]+\))[^;]*;?', '', content)

# 账套刷新按钮外观调整
content = re.sub(r'\.settings-toolbar \.btn-refresh-set\s*\{[^}]+\}', 
                 '.settings-toolbar .btn-refresh-set {\n  background: #ffffff !important;\n  color: #0284c7 !important;\n  border: 1px solid #0284c7 !important;\n  box-shadow: 0 1px 2px rgba(2,132,199,0.1) !important;\n}', 
                 content)
content = re.sub(r'\.settings-toolbar \.btn-refresh-set:hover:not\(:disabled\)\s*\{[^}]+\}', 
                 '.settings-toolbar .btn-refresh-set:hover:not(:disabled) {\n  background: #f0f9ff !important;\n  color: #0369a1 !important;\n  border-color: #0369a1 !important;\n}', 
                 content)

# 解决账套关闭按钮重叠
content = content.replace(
    "  flex-direction: column !important;\n  gap: 16px !important;\n}",
    "  flex-direction: column !important;\n  gap: 16px !important;\n  padding-top: 24px !important;\n}"
)

# 解决 master-filter-panel 下拉框遮挡 (z-index 提高到 30)
content = content.replace(
    ".master-filter-panel {\n  display: grid;\n  gap: 12px;\n  padding: 14px 18px;\n  border-bottom: 1px solid #dce6ef;\n  background: #fbfdff;\n}",
    ".master-filter-panel {\n  display: grid;\n  gap: 12px;\n  padding: 14px 18px;\n  border-bottom: 1px solid #dce6ef;\n  background: #fbfdff;\n  position: relative;\n  z-index: 30;\n}"
)

# 追加 legacy-table-panel 自适应伸缩支持
content += """
.employee-dashboard-page .query-result-panel,
.employee-dashboard-page .legacy-table-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.employee-dashboard-page .legacy-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
"""
with open(legacy_ui_path, 'w', encoding='utf-8') as f:
    f.write(content)


# 2. 修改 EmployeeDashboardPage.css
with open(dashboard_css_path, 'r', encoding='utf-8') as f:
    dashboard_content = f.read()

# 移除动效
dashboard_content = re.sub(r'\s*transform:\s*(?:translateY\([^)]+\)|scale\([^)]+\))[^;]*;?', '', dashboard_content)

# 去除多重包裹感
workspace_pattern = r'\.employee-dashboard-page \.query-workspace\s*\{[^}]+\}'
workspace_replacement = """.employee-dashboard-page .query-workspace {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
  box-sizing: border-box;
  transition: all 0.3s ease;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
}"""
dashboard_content = re.sub(workspace_pattern, workspace_replacement, dashboard_content)

hover_pattern = r'\.employee-dashboard-page \.query-workspace:hover\s*\{[^}]+\}'
hover_replacement = """.employee-dashboard-page .query-workspace:hover {
  box-shadow: none;
  border-color: transparent;
}"""
dashboard_content = re.sub(hover_pattern, hover_replacement, dashboard_content)

# 去除复写透明代码
table_override_pattern = r'\.employee-dashboard-page \.query-workspace \.query-result-panel,\s*\.employee-dashboard-page \.query-workspace \.legacy-table-panel\s*\{[^}]+\}'
dashboard_content = re.sub(table_override_pattern, '', dashboard_content)

# 修复下拉框遮挡 (z-index -> 30)
dashboard_content = dashboard_content.replace(
    ".employee-dashboard-page .query-filter-rail {\n  position: relative;\n  z-index: 15;\n}",
    ".employee-dashboard-page .query-filter-rail {\n  position: relative;\n  z-index: 30;\n}"
)

# 改为 Flexbox 布局实现一屏自适应滚动
dashboard_content = re.sub(
    r'  display: grid;\n  grid-template-rows: auto minmax\(0, 1fr\);\n  gap: 20px;\n  align-items: start;',
    '  display: flex;\n  flex-direction: column;\n  gap: 16px;\n  height: calc(100vh - 64px);\n  overflow: hidden;',
    dashboard_content
)

dashboard_content = dashboard_content.replace(
    "/* 保证内容在上层",
    ".employee-dashboard-page > .query-result-panel,\n.employee-dashboard-page > .query-workspace {\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n}\n\n/* 保证内容在上层"
)

with open(dashboard_css_path, 'w', encoding='utf-8') as f:
    f.write(dashboard_content)

print("Fixes successfully applied.")
