import re

path = "/Users/lewis/Lewis/code/git/MtEmployeeAttendance-System/frontend/src/pages/query/EmployeeDashboardPage.css"

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 追加必要的 flex 样式使得所有的卡片内部都能自适应撑满，超出时滚动。
append_css = """

/* 统一解决包含 legacy-table-panel 时的自适应高度问题 */
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

if "/* 统一解决包含 legacy-table-panel 时的自适应高度问题 */" not in content:
    content += append_css
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Flex styles appended.")
else:
    print("Styles already present.")
