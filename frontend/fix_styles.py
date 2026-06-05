import os
import re

legacy_ui_path = "/Users/lewis/Lewis/code/git/MtEmployeeAttendance-System/frontend/src/styles/legacy-ui.css"
dashboard_css_path = "/Users/lewis/Lewis/code/git/MtEmployeeAttendance-System/frontend/src/pages/query/EmployeeDashboardPage.css"

with open(legacy_ui_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 移除 translateY 和 scale (用于解决所有按钮移上去变大)
content = re.sub(r'\s*transform:\s*(?:translateY\([^)]+\)|scale\([^)]+\))[^;]*;?', '', content)

# 2. 账套刷新按钮样式
content = re.sub(r'\.settings-toolbar \.btn-refresh-set\s*\{[^}]+\}', 
                 '.settings-toolbar .btn-refresh-set {\n  background: #ffffff !important;\n  color: #0284c7 !important;\n  border: 1px solid #0284c7 !important;\n  box-shadow: 0 1px 2px rgba(2,132,199,0.1) !important;\n}', 
                 content)
content = re.sub(r'\.settings-toolbar \.btn-refresh-set:hover:not\(:disabled\)\s*\{[^}]+\}', 
                 '.settings-toolbar .btn-refresh-set:hover:not(:disabled) {\n  background: #f0f9ff !important;\n  color: #0369a1 !important;\n  border-color: #0369a1 !important;\n}', 
                 content)

# 3. 解决关闭按钮重叠
content = content.replace(
    "  flex-direction: column !important;\n  gap: 16px !important;\n}",
    "  flex-direction: column !important;\n  gap: 16px !important;\n  padding-top: 24px !important;\n}"
)

with open(legacy_ui_path, 'w', encoding='utf-8') as f:
    f.write(content)

# 4. 修改查询中心的外层包裹感及 transform
with open(dashboard_css_path, 'r', encoding='utf-8') as f:
    dashboard_content = f.read()

dashboard_content = re.sub(r'\s*transform:\s*(?:translateY\([^)]+\)|scale\([^)]+\))[^;]*;?', '', dashboard_content)

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

table_override_pattern = r'\.employee-dashboard-page \.query-workspace \.query-result-panel,\s*\.employee-dashboard-page \.query-workspace \.legacy-table-panel\s*\{[^}]+\}'
dashboard_content = re.sub(table_override_pattern, '', dashboard_content)

with open(dashboard_css_path, 'w', encoding='utf-8') as f:
    f.write(dashboard_content)

print("Styles fixed successfully.")
