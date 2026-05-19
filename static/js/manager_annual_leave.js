const managerAnnualLeaveMonthKeys = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"];
let annualLeaveColumnStates = {};

function showAnnualLeaveMessage(title, message) {
  const titleEl = document.getElementById("managerAnnualLeaveMessageModalTitle");
  const bodyEl = document.getElementById("managerAnnualLeaveMessageModalBody");
  const modalEl = document.getElementById("managerAnnualLeaveMessageModal");
  if (!titleEl || !bodyEl || !modalEl) return;
  titleEl.textContent = title || "提示";
  bodyEl.textContent = message || "";
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function monthValue(value) {
  return value === null || value === undefined ? "" : value;
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

function monthKeyValue(year, key) {
  return `${year}-${String(Number(key.slice(1))).padStart(2, "0")}`;
}

async function monthStateMapForYear(year) {
  const res = await fetch("/admin/account-sets");
  const rows = await res.json();
  const map = {};
  managerAnnualLeaveMonthKeys.forEach((key) => {
    const month = monthKeyValue(year, key);
    const row = Array.isArray(rows) ? rows.find((item) => item.month === month) : null;
    if (!row) {
      map[key] = "missing_account_set";
    } else {
      map[key] = row.is_locked ? "locked" : "editable";
    }
  });
  return map;
}

function applyAnnualLeaveLockState(columnStates, year) {
  annualLeaveColumnStates = columnStates || {};
  const lockedMonths = [];
  const missingMonths = [];
  Object.entries(annualLeaveColumnStates).forEach(([key, state]) => {
    const month = monthKeyValue(year, key);
    if (state === "locked") lockedMonths.push(month);
    if (state === "missing_account_set") missingMonths.push(month);
  });
  const notice = document.getElementById("managerAnnualLeaveLockNotice");
  const parts = [];
  if (lockedMonths.length) parts.push(`已锁定：${lockedMonths.join("、")}`);
  if (missingMonths.length) parts.push(`暂无账套：${missingMonths.join("、")}（仍可编辑）`);
  notice.textContent = parts.join("；") || "当前年度相关账套未锁定，可导入并通过弹窗保存";
}

function usedTotal(row) {
  return managerAnnualLeaveMonthKeys.reduce((sum, key) => sum + Number(row[key] || 0), 0);
}

function renderEditInputs(row) {
  return managerAnnualLeaveMonthKeys
    .map((key) => {
      const state = annualLeaveColumnStates[key] || "editable";
      const disabled = state === "locked" ? "disabled" : "";
      const title = state === "locked"
        ? 'title="该月份账套已锁定"'
        : (state === "missing_account_set" ? 'title="该月份暂无账套，不受封账控制"' : "");
      return `<td><input class="form-control form-control-sm" data-field="${key}" type="text" inputmode="decimal" value="${monthValue(row[key])}" ${disabled} ${title}></td>`;
    })
    .join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  const employeeSelector = window.SelectorComponent.createEmployeeSelector();
  const yearInput = document.getElementById("managerAnnualLeaveYear");
  const fileInput = document.getElementById("managerAnnualLeaveImportFile");
  const listBody = document.getElementById("managerAnnualLeaveListBody");
  const editModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("managerAnnualLeaveEditModal"));
  const editForm = document.getElementById("managerAnnualLeaveEditForm");
  const editBody = document.getElementById("managerAnnualLeaveEditBody");
  const editRemark = document.getElementById("managerAnnualLeaveEditRemark");
  const editMeta = document.getElementById("managerAnnualLeaveEditMeta");
  const editSaveBtn = document.getElementById("managerAnnualLeaveEditSaveBtn");

  let rows = [];
  let activeEmpId = null;

  function renderList() {
    if (!rows.length) {
      listBody.innerHTML = '<tr><td class="text-muted" colspan="6">当前条件无数据</td></tr>';
      return;
    }
    listBody.innerHTML = rows
      .map((row) => `
        <tr${Number(activeEmpId) === Number(row.emp_id) ? ' class="table-primary"' : ""}>
          <td>${row.dept_name || ""}</td>
          <td>${row.name || ""}</td>
          <td>${usedTotal(row)}</td>
          <td>${monthValue(row.remaining) || 0}</td>
          <td>${row.remark || ""}</td>
          <td><button class="btn btn-sm btn-outline-primary edit-btn" data-id="${row.emp_id}" type="button">编辑</button></td>
        </tr>
      `)
      .join("");
  }

  function currentRow(empId) {
    return rows.find((row) => Number(row.emp_id) === Number(empId)) || null;
  }

  function openEditModal(empId) {
    const row = currentRow(empId);
    if (!row) {
      showAnnualLeaveMessage("未找到记录", "未找到待编辑的管理人员记录");
      return;
    }
    activeEmpId = row.emp_id;
    editForm.elements.emp_id.value = row.emp_id;
    editMeta.textContent = `${row.name || ""} / ${yearInput.value || ""}`;
    editBody.innerHTML = `
      <tr>
        ${renderEditInputs(row)}
        <td>${monthValue(row.remaining) || 0}</td>
      </tr>
    `;
    editRemark.value = row.remark || "";
    editSaveBtn.disabled = false;
    renderList();
    editModal.show();
  }

  function selectedListQuery() {
    const year = yearInput.value;
    const ids = selectedManagerIds();
    if (!year || !ids.length) {
      showAnnualLeaveMessage("查询条件不足", "请选择年份和管理人员");
      return null;
    }
    return { year, ids };
  }

  async function loadManagerAnnualLeave() {
    const selected = selectedListQuery();
    if (!selected) return;
    const query = new URLSearchParams({ year: selected.year, emp_ids: selected.ids.join(",") });
    await window.AppQueryProgress.with(listBody, {
      label: "查询中",
      detail: "正在加载管理人员年休列表",
    }, async () => {
      const [res, columnStates] = await Promise.all([
        fetch(`/admin/manager-annual-leave/records?${query.toString()}`),
        monthStateMapForYear(selected.year),
      ]);
      const data = await res.json();
      if (!res.ok) {
        showAnnualLeaveMessage("查询失败", data.error || "查询失败");
        return;
      }
      rows = Array.isArray(data) ? data : [];
      activeEmpId = null;
      applyAnnualLeaveLockState(columnStates, selected.year);
      renderList();
    });
  }

  async function saveManagerAnnualLeave() {
    const empId = Number(editForm.elements.emp_id.value || 0);
    const year = yearInput.value || String(new Date().getFullYear());
    if (!empId) {
      showAnnualLeaveMessage("无法保存", "请先选择要编辑的管理人员");
      return;
    }
    const payload = { emp_id: empId, year, remark: editRemark.value };
    editBody.querySelectorAll("[data-field]").forEach((input) => {
      payload[input.dataset.field] = input.value;
    });
    const res = await fetch("/admin/manager-annual-leave/records", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showAnnualLeaveMessage("保存失败", data.error || "保存失败");
      return;
    }
    if (data.warning) {
      showAnnualLeaveMessage("部分月份未保存", data.warning);
    }
    await loadManagerAnnualLeave();
    openEditModal(empId);
    window.AppToast.success("年休修正已保存", "保存成功");
  }

  async function importManagerAnnualLeave() {
    const year = yearInput.value || String(new Date().getFullYear());
    if (!fileInput.files.length) {
      showAnnualLeaveMessage("请选择文件", "请选择要导入的Excel文件");
      return;
    }
    const form = new FormData();
    form.append("year", year);
    form.append("file", fileInput.files[0]);
    const res = await fetch("/admin/manager-annual-leave/import", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      showAnnualLeaveMessage("导入失败", data.error || "导入失败");
      return;
    }
    fileInput.value = "";
    await loadManagerAnnualLeave();
    const warnings = data.warning ? `\n${data.warning}` : "";
    const errorText = data.error_count ? `\n失败 ${data.error_count} 条：\n${data.errors.join("\n")}` : "";
    if (warnings || errorText) {
      showAnnualLeaveMessage("导入结果", `已导入 ${data.imported} 人${warnings}${errorText}`);
    }
  }

  await employeeSelector.init();
  if (!yearInput.value) {
    yearInput.value = String(new Date().getFullYear());
  }
  applyAnnualLeaveLockState({}, yearInput.value);

  document.getElementById("managerAnnualLeaveQueryBtn").addEventListener("click", loadManagerAnnualLeave);
  document.getElementById("managerAnnualLeaveImportBtn").addEventListener("click", importManagerAnnualLeave);
  document.getElementById("managerAnnualLeaveExportBtn").addEventListener("click", () => {
    const year = yearInput.value || String(new Date().getFullYear());
    window.location.href = `/admin/manager-annual-leave/export?year=${encodeURIComponent(year)}`;
  });
  listBody.addEventListener("click", (event) => {
    const target = event.target.closest(".edit-btn");
    if (!target) return;
    openEditModal(target.dataset.id);
  });
  editSaveBtn.addEventListener("click", saveManagerAnnualLeave);
});
