const managerAttendanceOverrideFields = [
  ["attendance_days", "出勤天数"],
  ["injury_days", "工伤"],
  ["business_trip_days", "出差"],
  ["marriage_days", "婚假"],
  ["funeral_days", "丧假"],
  ["late_early_minutes", "迟到\\早退"],
];

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function formatDateTime(value) {
  return value ? value.replace("T", " ").slice(0, 19) : "-";
}

async function accountSetLockState(month) {
  const query = new URLSearchParams();
  if (month) query.set("month", month);
  const res = await fetch(`/admin/account-sets?${query.toString()}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => row.month === month) || null;
}

function selectedManagerIds() {
  const value = document.getElementById("selectedEmpIds").value.trim();
  if (!value) return [];
  const seen = new Set();
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

document.addEventListener("DOMContentLoaded", async () => {
  const employeeSelector = window.SelectorComponent.createEmployeeSelector();
  const monthInput = document.getElementById("managerAttendanceOverrideMonth");
  const fileInput = document.getElementById("managerAttendanceOverrideFileInput");
  const listBody = document.getElementById("managerAttendanceOverrideListBody");
  const lockNotice = document.getElementById("managerAttendanceOverrideLockNotice");
  const editModal = new bootstrap.Modal(document.getElementById("managerAttendanceOverrideEditModal"));
  const editForm = document.getElementById("managerAttendanceOverrideEditForm");
  const editBody = document.getElementById("managerAttendanceOverrideEditBody");
  const editMeta = document.getElementById("managerAttendanceOverrideEditMeta");
  const editRemark = document.getElementById("managerAttendanceOverrideEditRemark");
  const editSaveBtn = document.getElementById("managerAttendanceOverrideEditSaveBtn");
  const updatedAtLabel = document.getElementById("managerAttendanceOverrideUpdatedAt");

  let overrideRows = [];
  let activeEditEmpId = null;
  let currentAccountSet = null;

  function currentLockState() {
    return Boolean(currentAccountSet?.is_locked);
  }

  function updateAttendanceOverrideMetrics(status = null, activeRow = null) {
    const month = monthInput.value || "-";
    const selectedIds = selectedManagerIds();
    document.getElementById("managerAttendanceOverrideMetricMonth").textContent = month || "-";
    document.getElementById("managerAttendanceOverrideMetricEmployee").textContent = activeRow
      ? `${activeRow.employee.emp_no} - ${activeRow.employee.name}`
      : (selectedIds.length ? `已选 ${selectedIds.length} 人` : "未选择");
    if (status !== null) {
      document.getElementById("managerAttendanceOverrideMetricStatus").textContent = status;
    }
  }

  function updateLockNotice() {
    const locked = currentLockState();
    lockNotice.className = `small mt-2 ${locked ? "text-danger" : "text-muted"}`;
    lockNotice.textContent = locked
      ? `${currentAccountSet.month} 账套已锁定，当前仅可查看列表和修正详情`
      : "当前为列表模式，请在下方逐行点击编辑";
    document.getElementById("managerAttendanceOverrideImportBtn").disabled = locked;
  }

  function summaryText(values) {
    const parts = managerAttendanceOverrideFields
      .map(([key, label]) => {
        const value = values?.[key];
        if (value === null || value === undefined || value === "") return null;
        return `${label}：${displayValue(value)}`;
      })
      .filter(Boolean);
    return parts.join("；") || "-";
  }

  function renderListRows() {
    if (!overrideRows.length) {
      listBody.innerHTML = `
        <tr id="managerAttendanceOverrideTableEmpty">
          <td class="text-muted" colspan="9">当前条件下暂无管理人员修正数据</td>
        </tr>
      `;
      return;
    }

    listBody.innerHTML = overrideRows
      .map((row) => {
        const isActive = Number(activeEditEmpId) === Number(row.employee.id);
        return `
          <tr${isActive ? ' class="table-primary"' : ""}>
            <td>${row.employee.emp_no || "-"}</td>
            <td>${row.employee.name || "-"}</td>
            <td>${row.employee.dept_name || "-"}</td>
            <td>${summaryText(row.automatic)}</td>
            <td>${summaryText(row.override)}</td>
            <td>${summaryText(row.applied)}</td>
            <td>${row.override?.remark || "-"}</td>
            <td>${formatDateTime(row.override?.updated_at)}</td>
            <td>
              <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${row.employee.id}" type="button">编辑</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderEditForm(row) {
    const locked = currentLockState();
    activeEditEmpId = row.employee.id;
    editForm.elements.emp_id.value = row.employee.id;
    editMeta.textContent = `${row.employee.emp_no} - ${row.employee.name} / ${monthInput.value || "-"}`;
    editBody.innerHTML = managerAttendanceOverrideFields
      .map(([key, label]) => {
        const automaticValue = row.automatic?.[key];
        const overrideValue = row.override?.[key];
        const appliedValue = row.applied?.[key];
        const inputMode = key === "late_early_minutes" ? "numeric" : "decimal";
        return `
          <tr>
            <td>${label}</td>
            <td>${displayValue(automaticValue) || "-"}</td>
            <td><input class="form-control form-control-sm" data-field="${key}" inputmode="${inputMode}" value="${displayValue(overrideValue)}" placeholder="自动" ${locked ? "disabled" : ""}></td>
            <td>${displayValue(appliedValue) || "-"}</td>
          </tr>
        `;
      })
      .join("");
    editRemark.value = row.override?.remark || "";
    editRemark.disabled = locked;
    editSaveBtn.disabled = locked;
    updatedAtLabel.textContent = row.override?.updated_at
      ? `最近保存 ${(row.override.updated_by_name || "").trim()} ${formatDateTime(row.override.updated_at)}`.trim()
      : "未保存";
    renderListRows();
    updateAttendanceOverrideMetrics("编辑中", row);
  }

  function openEditModalById(empId) {
    const row = overrideRows.find((item) => Number(item.employee.id) === Number(empId));
    if (!row) {
      window.AppDialog.alert("未找到待编辑管理人员");
      return;
    }
    renderEditForm(row);
    editModal.show();
  }

  function selectedListQuery() {
    const month = monthInput.value;
    const ids = selectedManagerIds();
    if (!month || !ids.length) {
      window.AppDialog.alert("请选择月份和管理人员");
      return null;
    }
    return { month, ids };
  }

  async function loadManagerAttendanceOverrideList() {
    const selected = selectedListQuery();
    if (!selected) return;
    const query = new URLSearchParams({ month: selected.month, emp_ids: selected.ids.join(",") });
    await window.AppQueryProgress.with(listBody, {
      label: "查询中",
      detail: "正在加载管理人员修正列表",
    }, async () => {
      const [res, accountSet] = await Promise.all([
        fetch(`/admin/manager-attendance-overrides/list?${query.toString()}`),
        accountSetLockState(selected.month),
      ]);
      const data = await res.json();
      if (!res.ok) {
        window.AppDialog.alert(data.error || "查询失败", "查询失败");
        return;
      }
      currentAccountSet = accountSet;
      activeEditEmpId = null;
      overrideRows = Array.isArray(data.rows) ? data.rows : [];
      renderListRows();
      updateLockNotice();
      updateAttendanceOverrideMetrics(`已查询 ${overrideRows.length} 人`);
    });
  }

  async function saveManagerAttendanceOverride() {
    const empId = Number(editForm.elements.emp_id.value || 0);
    const month = monthInput.value;
    if (!empId || !month) {
      window.AppDialog.alert("请先从修正列表选择需要编辑的管理人员");
      return;
    }
    const payload = {
      month,
      emp_id: empId,
      remark: editRemark.value,
    };
    editBody.querySelectorAll("[data-field]").forEach((input) => {
      payload[input.dataset.field] = input.value;
    });
    const res = await fetch("/admin/manager-attendance-overrides/record", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      window.AppDialog.alert(data.error || "保存失败", "保存失败");
      return;
    }

    const nextRow = {
      employee: data.employee,
      automatic: data.automatic,
      override: data.override,
      applied: data.applied,
    };
    const targetIndex = overrideRows.findIndex((row) => Number(row.employee.id) === empId);
    if (targetIndex >= 0) {
      overrideRows.splice(targetIndex, 1, nextRow);
    } else {
      overrideRows.push(nextRow);
    }
    renderEditForm(nextRow);
    renderListRows();
    updateAttendanceOverrideMetrics("已保存", nextRow);
    window.AppDialog.toast("修正已保存");
  }

  function selectedMonthOnly() {
    const month = monthInput.value;
    if (!month) {
      window.AppDialog.alert("请选择月份");
      return null;
    }
    return month;
  }

  function downloadManagerOverrideFile(type) {
    const month = selectedMonthOnly();
    if (!month) return;
    window.location.href = `/admin/manager-attendance-overrides/${type}?month=${encodeURIComponent(month)}`;
  }

  async function importManagerAttendanceOverride(file) {
    const month = selectedMonthOnly();
    if (!month || !file) return;
    const form = new FormData();
    form.append("month", month);
    form.append("file", file);
    const res = await fetch("/admin/manager-attendance-overrides/import", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      window.AppDialog.alert(data.error || "导入失败", "导入失败");
      return;
    }
    const summary = [
      `成功 ${data.success_count} 条`,
      `跳过 ${data.skipped_count} 条`,
      `失败 ${data.failed_count} 条`,
      `实际变更 ${data.changed_count} 条`,
    ];
    if (Array.isArray(data.errors) && data.errors.length) {
      summary.push("", data.errors.join("\n"));
    }
    window.AppDialog.alert(summary.join("\n"), "导入结果");
    if (selectedManagerIds().length) {
      await loadManagerAttendanceOverrideList();
    }
  }

  if (!monthInput.value) {
    monthInput.value = currentMonthValue();
  }
  await employeeSelector.init();
  updateAttendanceOverrideMetrics("等待查询");
  updateLockNotice();

  monthInput.addEventListener("input", () => updateAttendanceOverrideMetrics("等待查询"));
  document.getElementById("selectedEmpIds").addEventListener("change", () => updateAttendanceOverrideMetrics("等待查询"));
  document
    .getElementById("managerAttendanceOverrideQueryBtn")
    .addEventListener("click", loadManagerAttendanceOverrideList);
  document
    .getElementById("managerAttendanceOverrideExportBtn")
    .addEventListener("click", () => downloadManagerOverrideFile("export"));
  document
    .getElementById("managerAttendanceOverrideTemplateBtn")
    .addEventListener("click", () => downloadManagerOverrideFile("template"));
  document
    .getElementById("managerAttendanceOverrideImportBtn")
    .addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    await importManagerAttendanceOverride(file);
    fileInput.value = "";
  });
  listBody.addEventListener("click", (event) => {
    const target = event.target.closest(".edit-btn");
    if (!target) return;
    openEditModalById(target.dataset.id);
  });
  editSaveBtn.addEventListener("click", saveManagerAttendanceOverride);
});
