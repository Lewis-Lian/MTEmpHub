const managerOvertimeMonthKeys = ["prev_dec", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"];
const managerOvertimeMonthLabels = {
  prev_dec: "前年累积天数",
  m1: "1月",
  m2: "2月",
  m3: "3月",
  m4: "4月",
  m5: "5月",
  m6: "6月",
  m7: "7月",
  m8: "8月",
  m9: "9月",
  m10: "10月",
  m11: "11月",
  m12: "12月",
};

let overtimeColumnStates = {};

function showOvertimeMessage(title, message) {
  const titleEl = document.getElementById("managerOvertimeMessageModalTitle");
  const bodyEl = document.getElementById("managerOvertimeMessageModalBody");
  const modalEl = document.getElementById("managerOvertimeMessageModal");
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
  if (key === "prev_dec") return `${Number(year) - 1}-12`;
  return `${year}-${String(Number(key.slice(1))).padStart(2, "0")}`;
}

async function monthStateMapForYear(year, includePrevDec = false) {
  const res = await fetch("/admin/account-sets");
  const rows = await res.json();
  const map = {};
  const keys = includePrevDec ? managerOvertimeMonthKeys : managerOvertimeMonthKeys.filter((key) => key !== "prev_dec");
  keys.forEach((key) => {
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

function applyOvertimeLockState(columnStates, year) {
  overtimeColumnStates = columnStates || {};
  const lockedMonths = [];
  const missingMonths = [];
  Object.entries(overtimeColumnStates).forEach(([key, state]) => {
    const month = monthKeyValue(year, key);
    if (state === "locked") lockedMonths.push(month);
    if (state === "missing_account_set") missingMonths.push(month);
  });
  const notice = document.getElementById("managerOvertimeLockNotice");
  const parts = [];
  if (lockedMonths.length) parts.push(`已锁定：${lockedMonths.join("、")}`);
  if (missingMonths.length) parts.push(`暂无账套：${missingMonths.join("、")}（仍可编辑）`);
  notice.textContent = parts.join("；") || "当前年度相关账套未锁定，可导入并通过弹窗保存";
}

function yearTotal(row) {
  return managerOvertimeMonthKeys.reduce((sum, key) => sum + Number(row[key] || 0), 0);
}

function renderEditInputs(row) {
  return managerOvertimeMonthKeys
    .map((key) => {
      const state = overtimeColumnStates[key] || "editable";
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
  const yearInput = document.getElementById("managerOvertimeYear");
  const fileInput = document.getElementById("managerOvertimeImportFile");
  const listBody = document.getElementById("managerOvertimeListBody");
  const editModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("managerOvertimeEditModal"));
  const editForm = document.getElementById("managerOvertimeEditForm");
  const editBody = document.getElementById("managerOvertimeEditBody");
  const editRemark = document.getElementById("managerOvertimeEditRemark");
  const editMeta = document.getElementById("managerOvertimeEditMeta");
  const editSaveBtn = document.getElementById("managerOvertimeEditSaveBtn");

  let rows = [];
  let activeEmpId = null;

  function renderList() {
    if (!rows.length) {
      listBody.innerHTML = '<tr><td class="text-muted" colspan="7">当前条件无数据</td></tr>';
      return;
    }
    listBody.innerHTML = rows
      .map((row) => `
        <tr${Number(activeEmpId) === Number(row.emp_id) ? ' class="table-primary"' : ""}>
          <td>${row.dept_name || ""}</td>
          <td>${row.name || ""}</td>
          <td>${monthValue(row.prev_dec) || 0}</td>
          <td>${yearTotal(row)}</td>
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
      showOvertimeMessage("未找到记录", "未找到待编辑的管理人员记录");
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
      showOvertimeMessage("查询条件不足", "请选择年份和管理人员");
      return null;
    }
    return { year, ids };
  }

  async function loadManagerOvertime() {
    const selected = selectedListQuery();
    if (!selected) return;
    const query = new URLSearchParams({ year: selected.year, emp_ids: selected.ids.join(",") });
    await window.AppQueryProgress.with(listBody, {
      label: "查询中",
      detail: "正在加载管理人员加班列表",
    }, async () => {
      const [res, columnStates] = await Promise.all([
        fetch(`/admin/manager-overtime/records?${query.toString()}`),
        monthStateMapForYear(selected.year, true),
      ]);
      const data = await res.json();
      if (!res.ok) {
        showOvertimeMessage("查询失败", data.error || "查询失败");
        return;
      }
      rows = Array.isArray(data) ? data : [];
      activeEmpId = null;
      applyOvertimeLockState(columnStates, selected.year);
      renderList();
    });
  }

  async function saveManagerOvertime() {
    const empId = Number(editForm.elements.emp_id.value || 0);
    const year = yearInput.value || String(new Date().getFullYear());
    if (!empId) {
      showOvertimeMessage("无法保存", "请先选择要编辑的管理人员");
      return;
    }
    const payload = { emp_id: empId, year, remark: editRemark.value };
    editBody.querySelectorAll("[data-field]").forEach((input) => {
      payload[input.dataset.field] = input.value;
    });
    const res = await fetch("/admin/manager-overtime/records", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showOvertimeMessage("保存失败", data.error || "保存失败");
      return;
    }
    if (data.warning) {
      showOvertimeMessage("部分月份未保存", data.warning);
    }
    await loadManagerOvertime();
    openEditModal(empId);
    window.AppToast.success("加班修正已保存", "保存成功");
  }

  async function importManagerOvertime() {
    const year = yearInput.value || String(new Date().getFullYear());
    if (!fileInput.files.length) {
      showOvertimeMessage("请选择文件", "请选择要导入的Excel文件");
      return;
    }
    const form = new FormData();
    form.append("year", year);
    form.append("file", fileInput.files[0]);
    const res = await fetch("/admin/manager-overtime/import", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      showOvertimeMessage("导入失败", data.error || "导入失败");
      return;
    }
    fileInput.value = "";
    await loadManagerOvertime();
    const warnings = data.warning ? `\n${data.warning}` : "";
    const errorText = data.error_count ? `\n失败 ${data.error_count} 条：\n${data.errors.join("\n")}` : "";
    if (warnings || errorText) {
      showOvertimeMessage("导入结果", `已导入 ${data.imported} 人${warnings}${errorText}`);
    }
  }

  await employeeSelector.init();
  if (!yearInput.value) {
    yearInput.value = String(new Date().getFullYear());
  }
  applyOvertimeLockState({}, yearInput.value);

  document.getElementById("managerOvertimeQueryBtn").addEventListener("click", loadManagerOvertime);
  document.getElementById("managerOvertimeImportBtn").addEventListener("click", importManagerOvertime);
  document.getElementById("managerOvertimeExportBtn").addEventListener("click", () => {
    const year = yearInput.value || String(new Date().getFullYear());
    window.location.href = `/admin/manager-overtime/export?year=${encodeURIComponent(year)}`;
  });
  listBody.addEventListener("click", (event) => {
    const target = event.target.closest(".edit-btn");
    if (!target) return;
    openEditModal(target.dataset.id);
  });
  editSaveBtn.addEventListener("click", saveManagerOvertime);
});
