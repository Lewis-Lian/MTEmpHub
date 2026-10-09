import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchMe } from "../api/auth";
import { apiRequest } from "../api/client";
import { fetchMealBatch, mutateMealBatch, mealRechargeExportUrl, fetchMealImports, previewMealImport, confirmMealImport, cancelMealImport, compareMealImport } from "../api/mealTickets";
import type { MealBatch, MealItem, MealDepartment, MealImport, MealImportRow, MealComparison, MealAttendanceRecalculation } from "../api/mealTickets";
import QueryTable from "../components/query/QueryTable";
import EmployeePicker from "../components/query/EmployeePicker";
import DepartmentMultiPicker from "../components/query/DepartmentMultiPicker";
import MonthPicker from "../components/common/MonthPicker";
import { useConfirm } from "../components/feedback/ConfirmDialog";
import "./meal-ticket.css";

const money = (n: number) => n.toFixed(2);
const paymentRequestKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
const hasError = (item: MealItem) => Boolean(item.error && !item.excluded);
const hasIssue = (item: MealItem) => hasError(item) || item.due_amount < 0;
const employmentLabel = (item: MealItem) => item.employment_status === "resigned" ? `已登记离职 · ${item.resigned_at}`
  : item.employment_status === "active" ? "未登记离职" : item.employment_status === "missing" ? "员工档案不存在" : "";
function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

export default function MealTicketPage({ view = "calculation" }: { view?: "calculation" | "payments" | "history" }) {
  const confirmAction = useConfirm();
  const historical = view === "history";
  const paymentView = view === "payments";
  const location = useLocation();
  const lastLocation = useRef(location.key);
  const currentLocation = useRef(location.key);
  currentLocation.current = location.key;
  const [admin, setAdmin] = useState(false);
  const [month, setMonth] = useState(() => {
    const requested = new URLSearchParams(location.search).get("recharge_month");
    if (!historical && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? "")) return requested!;
    try { return sessionStorage.getItem(`meal-ticket-month-${view}`) || thisMonth(); } catch { return thisMonth(); }
  });
  const [batch, setBatch] = useState<MealBatch | null>(null);
  const [busy, setBusy] = useState(true);
  const [loadProgress, setLoadProgress] = useState<{ completed: number; total: number; text: string; label: string; phase?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [reconciliationFailed, setReconciliationFailed] = useState(false);
  const [refundActions, setRefundActions] = useState<Record<string, string>>({});
  const [followupStage, setFollowupStage] = useState<"adjustments" | "payments" | "settlement">("adjustments");
  const [reconcileRange, setReconcileRange] = useState({ month: "", start: "", end: "" });
  const [filterEmployeeIds, setFilterEmployeeIds] = useState<number[]>([]);
  const [resultView, setResultView] = useState<"person" | "department">("person");
  const [departmentNames, setDepartmentNames] = useState<string[]>([]);
  const [type, setType] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [target, setTarget] = useState<MealItem | null>(null);
  const [action, setAction] = useState("adjustments");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [supplementMonth, setSupplementMonth] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [reversalId, setReversalId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulk, setBulk] = useState(false);
  const [detail, setDetail] = useState<MealItem | null>(null);
  const [imports, setImports] = useState<MealImport[]>([]);
  const [preview, setPreview] = useState<MealImport | null>(null);
  const [attendancePreview, setAttendancePreview] = useState<MealAttendanceRecalculation | null>(null);
  const [supplementReasons, setSupplementReasons] = useState<Record<number, string>>({});
  const [comparison, setComparison] = useState<MealComparison[]>([]);
  const [monthKind, setMonthKind] = useState("recharge");
  const [file, setFile] = useState<File | null>(null);
  const [people, setPeople] = useState<Array<{ id: number; emp_no: string; name: string }>>([]);
  const [historyDepartments, setHistoryDepartments] = useState<string[]>([]);
  const [importIssuesOnly, setImportIssuesOnly] = useState(false);
  const [importSelected, setImportSelected] = useState<number[]>([]);
  const [importDepartment, setImportDepartment] = useState("");
  const [importCustomDepartment, setImportCustomDepartment] = useState("");
  const [importReason, setImportReason] = useState("");
  const generation = useRef(0);
  const requestKeys = useRef<Record<number, string>>({});
  const personnel = useRef<HTMLElement>(null);
  const settlement = useRef<HTMLElement>(null);
  const rechargeExport = useRef<HTMLElement>(null);
  const historyFile = useRef<HTMLInputElement>(null);
  const participationForm = action === "exclude" || action === "include";
  const participationLabel = action === "exclude" ? "本月不发" : "恢复核算";
  const reasonPresets = action === "exclude" ? ["离职", "工资算菜票"]
    : action === "adjustments" ? ["线长补卡", "补x月菜票"] : [];
  const progressPercent = loadProgress && loadProgress.total > 0
    ? Math.round(loadProgress.completed / loadProgress.total * 100) : null;
  const pickerDepartments = useMemo(() => [...new Set((batch?.items ?? []).map(item => item.dept_name))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((dept_name, index) => ({ id: index + 1, dept_name, dept_no: "", parent_id: null })), [batch]);
  const pickerEmployees = useMemo(() => (batch?.items ?? []).map(item => ({ id: item.emp_id, emp_no: item.emp_no,
    name: item.name, dept_name: item.dept_name, is_manager: item.is_manager,
    dept_id: pickerDepartments.find(dept => dept.dept_name === item.dept_name)?.id ?? null })), [batch, pickerDepartments]);

  useEffect(() => { setComparison([]); }, [preview]);
  useEffect(() => {
    setImportIssuesOnly(false); setImportSelected([]); setImportDepartment(""); setImportCustomDepartment(""); setImportReason("");
  }, [preview?.id, preview?.status]);
  useEffect(() => { setFollowupStage("adjustments"); }, [month, view]);
  useEffect(() => {
    if (paymentView && followupStage === "settlement") settlement.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [paymentView, followupStage]);
  useEffect(() => { try { sessionStorage.setItem(`meal-ticket-month-${view}`, month); } catch { /* Session storage may be disabled. */ } }, [month, view]);
  useEffect(() => {
    const id = ++generation.current;
    const controller = new AbortController();
    setBatch(null); setPreview(null); setAttendancePreview(null); setTarget(null); setDetail(null); setSelected([]); setError("");
    setSupplementReasons({});
    setFilterEmployeeIds([]); setReconciliationFailed(false);
    setBusy(true); setAdmin(false); setPeople([]); setHistoryDepartments([]);
    let completed = 0;
    let total = 2;
    let permissionsReady = false;
    let monthlyProgressReceived = false;
    const updateProgress = (text: string) => {
      if (id === generation.current && !monthlyProgressReceived) setLoadProgress({ completed: historical ? completed : 0, total: historical ? total : 0, text, label: "页面加载进度", phase: !historical });
    };
    updateProgress(historical ? "正在读取账号权限与历史台账" : "正在读取账号权限与月度核算");
    const permissions = fetchMe().then(async user => {
      if (id !== generation.current) return;
      permissionsReady = true;
      setAdmin(user.role === "admin");
      if (historical && user.role === "admin") total = 3;
      completed += 1;
      updateProgress(historical ? "正在读取历史台账与人员名单" : "正在读取月度核算数据");
      if (historical && user.role === "admin") {
        const [result, departments] = await Promise.all([
          apiRequest<Array<{ id: number; emp_no: string; name: string }>>("/api/admin/employees?status=all"),
          apiRequest<Array<{ dept_name: string }>>("/api/admin/departments"),
        ]);
        if (id !== generation.current) return;
        setPeople(result); completed += 1;
        setHistoryDepartments([...new Set(["未分配部门", ...departments.map(row => row.dept_name).filter(name => typeof name === "string")])]);
        updateProgress("人员名单已读取，正在完成历史台账加载");
      }
    });
    const data = (historical ? fetchMealImports().then(result => {
      if (id === generation.current) setImports(result);
    }) : fetchMealBatch(month, progress => {
      if (id !== generation.current || progress.status !== "running") return;
      monthlyProgressReceived = true;
      setLoadProgress({ completed: progress.completed, total: progress.total, text: progress.stage, label: "页面加载进度", phase: true });
    }, controller.signal).then(result => {
      if (id === generation.current) setBatch(result);
    })).then(() => {
      if (id !== generation.current) return;
      completed += 1;
      monthlyProgressReceived = false;
      updateProgress(permissionsReady ? "账目已读取，正在完成页面加载" : "账目已读取，正在检查账号权限");
    });
    Promise.allSettled([permissions, data]).then(results => {
      if (id !== generation.current) return;
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : "页面加载失败");
      setBusy(false); setLoadProgress(null);
    });
    return () => { controller.abort(); if (id === generation.current) generation.current += 1; };
  }, [month, historical]);

  useEffect(() => {
    if (lastLocation.current === location.key) return;
    if (!historical && location.pathname === `/meal-tickets/${view}` && busy) return;
    lastLocation.current = location.key;
    if (historical || location.pathname !== `/meal-tickets/${view}`) return;
    const requested = new URLSearchParams(location.search).get("recharge_month");
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? "") && requested !== month) {
      setMonth(requested!); return;
    }
    let cancelled = false;
    const id = generation.current;
    fetchMealBatch(month).then(next => {
      if (cancelled || id !== generation.current) return;
      setBatch(current => current && next && current.id === next.id && current.version > next.version ? current : next);
    }).catch(e => { if (!cancelled && id === generation.current) setError(e instanceof Error ? e.message : "账目刷新失败"); });
    return () => { cancelled = true; };
  }, [location.key, location.pathname, location.search, month, historical, view, busy]);

  async function operate(task: () => Promise<void>) {
    const id = generation.current;
    setBusy(true); setError(""); setLoadProgress(null);
    try { await task(); } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : "操作失败"); }
    finally { if (id === generation.current) { setBusy(false); setLoadProgress(null); } }
  }
  async function mutate(endpoint: string, values: object = {}) {
    await operate(async () => {
      const next = await mutateMealBatch(endpoint, { batch_id: batch?.id, version: batch?.version, ...values });
      setBatch(next); setTarget(null);
    });
  }
  async function returnToDraft() {
    const accepted = await confirmAction({
      title: "退回核算草稿",
      message: "退回后可以重新修改核算，已有明细、补扣和本月不发选择会保留。已导出的充值表将失效，需重新确认并导出。如已在充值系统完成发放，请先核对实际到账，不要退回。",
      confirmText: "确认退回",
      type: "warning",
    });
    if (accepted) await mutate("unconfirm");
  }
  async function previewAttendance() {
    const id = generation.current;
    const locationKey = currentLocation.current;
    await operate(async () => {
      const next = await apiRequest<MealAttendanceRecalculation>("/api/meal-tickets/attendance-recalculation/preview", {
        method: "POST", body: { batch_id: batch?.id, version: batch?.version },
      });
      if (id === generation.current && locationKey === currentLocation.current) setAttendancePreview(next);
    });
  }
  async function applyAttendance() {
    if (!attendancePreview) return;
    const id = generation.current;
    const locationKey = currentLocation.current;
    await operate(async () => {
      const next = await mutateMealBatch("attendance-recalculation", {
        batch_id: attendancePreview.batch_id, version: attendancePreview.version, source_digest: attendancePreview.source_digest,
      });
      if (id !== generation.current || locationKey !== currentLocation.current) return;
      setBatch(next);
      setAttendancePreview(null); setFollowupStage("adjustments");
    });
  }
  async function supplementPerson(empId: number) {
    if (!attendancePreview || !supplementReasons[empId]?.trim()) return;
    const id = generation.current;
    const locationKey = currentLocation.current;
    await operate(async () => {
      const next = await mutateMealBatch("supplement-person", {
        batch_id: attendancePreview.batch_id, version: attendancePreview.version,
        source_digest: attendancePreview.source_digest, emp_id: empId, reason: supplementReasons[empId],
      });
      if (id !== generation.current || locationKey !== currentLocation.current) return;
      setBatch(next); setAttendancePreview(null); setSupplementReasons({});
      const preview = await apiRequest<MealAttendanceRecalculation>("/api/meal-tickets/attendance-recalculation/preview", {
        method: "POST", body: { batch_id: next.id, version: next.version },
      });
      if (id === generation.current && locationKey === currentLocation.current) setAttendancePreview(preview);
    });
  }
  function openForm(item: MealItem, endpoint: string, reversal?: number) {
    if (paymentView && endpoint === "adjustments") setFollowupStage("adjustments");
    setBulk(false);
    setTarget(item); setAction(endpoint); setAmount(endpoint === "adjustments" ? "" : money(Math.abs(item.difference)));
    setReason(""); setSupplementMonth(null); setError(""); setReversalId(reversal ?? null); requestKeys.current = { [item.id]: paymentRequestKey() };
  }
  function bulkEligible(item: MealItem, endpoint: string) {
    if (endpoint === "exclude" || endpoint === "include") return batch?.status === "draft" && Boolean(item.excluded) === (endpoint === "include");
    if (endpoint === "adjustments") return batch?.status === "draft" ? !item.excluded : paymentView;
    return batch?.status === "confirmed" && !hasIssue(item) && item.difference > 0;
  }
  function openBulk(endpoint: string) {
    if (paymentView && endpoint === "adjustments") setFollowupStage("adjustments");
    setTarget(null); setBulk(true); setAction(endpoint); setAmount(""); setReason(""); setSupplementMonth(null); setError(""); requestKeys.current = {};
  }
  async function save() {
    if (!target || !batch) return;
    if (!reason.trim()) { setError("请填写原因或说明后再修改"); return; }
    if (participationForm) {
      await mutate("participation", { item_id: target.id, excluded: action === "exclude", reason });
      return;
    }
    const values = { item_id: target.id, amount, reason, kind: action, date, reference: reason,
      reversal_id: reversalId, request_key: requestKeys.current[target.id] };
    await mutate(action === "adjustments" ? action : "payments", values);
  }
  async function saveBulk() {
    if (!batch) return;
    if (!reason.trim()) { setError("请填写原因或说明后再修改"); return; }
    await operate(async () => {
      let current = batch;
      const pending = selected.filter(id => current.items.some(i => i.id === id && bulkEligible(i, action)));
      const progressLabel = participationForm ? "批量核算处理进度" : action === "adjustments" ? "批量补扣进度" : "批量充值进度";
      const progressText = participationForm ? `正在${participationLabel}` : action === "adjustments" ? "正在保存选中人员补扣" : "正在登记选中人员充值";
      let completed = 0;
      setLoadProgress({ completed, total: pending.length, text: progressText, label: progressLabel });
      for (const id of pending) {
        const item = current.items.find(i => i.id === id);
        if (!item || !bulkEligible(item, action)) continue;
        const values = participationForm ? { excluded: action === "exclude", reason }
          : action === "adjustments" ? { amount, reason }
          : {
          amount: money(item.difference), kind: "recharge", date, reference: reason,
          request_key: requestKeys.current[id] ?? (requestKeys.current[id] = paymentRequestKey()) };
        const next = await mutateMealBatch(participationForm ? "participation" : action === "adjustments" ? "adjustments" : "payments",
          { batch_id: current.id, version: current.version, item_id: id, ...values });
        current = next; setBatch(next); setSelected(s => s.filter(selectedId => selectedId !== id)); completed += 1;
        setLoadProgress({ completed, total: pending.length, text: progressText, label: progressLabel });
      }
      setBulk(false); setSelected([]);
    });
  }
  function editRow(id: number, values: Partial<MealImportRow>) {
    setPreview(p => p && { ...p, rows: p.rows.map(r => r.id === id ? { ...r, ...values } : r) });
  }
  function editSelectedImportRows(values: Partial<MealImportRow>) {
    setPreview(p => p && { ...p, rows: p.rows.map(row => importSelected.includes(row.id) ? { ...row, ...values } : row) });
  }
  const importIssues = useMemo(() => {
    const issues = new Map<number, string[]>();
    if (!preview || preview.status !== "preview") return issues;
    const employeeIds = new Set(people.map(person => person.id));
    const existingIds = new Set(imports.filter(record => record.id !== preview.id && record.month === preview.month && record.status === "confirmed")
      .flatMap(record => record.rows.filter(row => row.kind === "person" && !row.skip).map(row => row.emp_id)));
    const counts = new Map<number, number>();
    for (const row of preview.rows) {
      if (row.kind === "person" && !row.skip && row.emp_id !== null) counts.set(row.emp_id, (counts.get(row.emp_id) ?? 0) + 1);
    }
    for (const row of preview.rows) {
      const messages: string[] = [];
      if (!row.skip) {
        if (!row.dept_name.trim() || row.dept_name.trim().length > 100) messages.push("请填写部门名称，最多 100 字");
        if (row.kind === "person" && (row.emp_id === null || !employeeIds.has(row.emp_id))) messages.push("人员未匹配，请选择人员");
        if (row.amount === null || !Number.isFinite(row.amount) || Math.abs(row.amount) > 10000000 || Math.abs(row.amount * 100 - Math.round(row.amount * 100)) > .000001) messages.push("金额缺失或无效，最多两位小数");
        if (row.kind === "person" && row.emp_id !== null && ((counts.get(row.emp_id) ?? 0) > 1 || existingIds.has(row.emp_id))) messages.push("同月人员重复，请核对后跳过重复行");
        if (row.period_conflict && !row.period_confirmed) messages.push(row.period_conflict);
        const changed = (row.original_amount !== undefined && row.amount !== row.original_amount)
          || (row.original_dept_name !== undefined && row.dept_name !== row.original_dept_name)
          || (row.kind === "person" && row.original_emp_id !== undefined && row.emp_id !== row.original_emp_id)
          || Boolean(row.period_conflict && row.period_confirmed);
        if (changed && !row.correction_reason.trim()) messages.push("请填写更正说明");
        if (row.correction_reason.length > 500) messages.push("更正说明不能超过 500 字");
      }
      issues.set(row.id, messages);
    }
    return issues;
  }, [preview, people, imports]);
  const importRows = preview?.rows.filter(row => !importIssuesOnly || Boolean(importIssues.get(row.id)?.length)) ?? [];
  const importIssueCount = [...importIssues.values()].filter(messages => messages.length > 0).length;
  const allImportSelected = importRows.length > 0 && importRows.every(row => importSelected.includes(row.id));
  const importDepartmentValue = importDepartment === "__historical__" ? importCustomDepartment.trim() : importDepartment;
  function confirmPeriod() {
    setPreview(p => p && {
      ...p,
      rows: p.rows.map(r => r.period_conflict ? {
        ...r, period_confirmed: true,
        correction_reason: r.correction_reason || "已核对年月差异，按所选月份归档",
      } : r),
    });
  }
  const rows = (batch?.items ?? []).filter(i => (!filterEmployeeIds.length || filterEmployeeIds.includes(i.emp_id)) &&
    (!departmentNames.length || departmentNames.includes(i.dept_name)) && (!type || i.is_manager === (type === "manager")) &&
    (!paymentStatus || (paymentStatus === "issue" ? hasIssue(i) : paymentStatus === "excluded" ? i.excluded && i.due_amount === 0
      : paymentStatus === "refund" ? i.difference < 0 : paymentStatus === "settled" ? i.difference === 0 && !(i.excluded && i.due_amount === 0) : i.difference > 0)));
  const total = (field: "due_amount" | "paid_amount" | "difference") => rows.reduce((sum, i) => sum + i[field], 0);
  const departmentRows = new Map<string, MealDepartment>();
  for (const item of rows) {
    const summary = departmentRows.get(item.dept_name) ?? { dept_name: item.dept_name, count: 0,
      base_amount: 0, adjustment_amount: 0, due_amount: 0, paid_amount: 0, difference: 0 };
    summary.count += 1;
    for (const field of ["base_amount", "adjustment_amount", "due_amount", "paid_amount", "difference"] as const) summary[field] += item[field];
    departmentRows.set(item.dept_name, summary);
  }
  function changeResultView(next: "person" | "department") {
    if (next !== resultView) setSelected([]);
    setResultView(next);
  }
  const selectedItems = (batch?.items ?? []).filter(item => selected.includes(item.id));
  const bulkItems = selectedItems.filter(item => bulkEligible(item, action));
  const selectableRows = rows.filter(item => batch?.status === "draft" || !hasIssue(item));
  const allSelected = selectableRows.length > 0 && selectableRows.every(item => selected.includes(item.id));
  const confirmed = batch?.status === "confirmed";
  const databaseActive = Boolean(batch?.database?.enabled);
  const databaseEnabled = databaseActive || Boolean(batch?.items.some(item => item.payments.some(payment => payment.database_record)));
  const databaseReady = databaseActive && Boolean(batch?.database?.configured);
  const defaultEnd = `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  const rangeStart = reconcileRange.month === month ? reconcileRange.start : `${month}-01`;
  const rangeEnd = reconcileRange.month === month ? reconcileRange.end : defaultEnd;
  const report = reconciliationFailed ? undefined : batch?.reconciliation;
  const changeRange = (key: "start" | "end", value: string) => setReconcileRange({ month, start: rangeStart, end: rangeEnd, [key]: value });
  const hasPaymentHistory = batch?.items.some(item => item.payments.length > 0) ?? false;
  const hasAttendanceRecalculation = batch?.items.some(item => Boolean(item.source.attendance_recalculation)) ?? false;
  const pendingCount = batch?.items.filter(i => i.difference > 0).length ?? 0;
  const refundCount = batch?.items.filter(i => i.difference < 0).length ?? 0;
  const errorCount = batch?.items.filter(hasIssue).length ?? 0;
  const settled = confirmed && !reconciliationFailed && !report?.pending_refunds?.length && pendingCount === 0 && refundCount === 0 && errorCount === 0;
  const showBatch = batch && (!paymentView || confirmed);
  const jumpToPeople = () => { changeResultView("person"); personnel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const showIssues = () => {
    setFilterEmployeeIds([]); setDepartmentNames([]); setType(""); setPaymentStatus("issue"); setSelected([]); jumpToPeople();
    void operate(async () => { setBatch(await fetchMealBatch(month)); });
  };
  const checkSettlement = (actions?: Record<string, string>) => operate(async () => {
    setReconciliationFailed(false);
    try {
      const next = databaseEnabled && admin
        ? await mutateMealBatch("reconcile", { batch_id: batch?.id, version: batch?.version, start_date: rangeStart, end_date: rangeEnd, ...(actions && Object.keys(actions).length ? { refund_actions: actions } : {}) })
        : await fetchMealBatch(month);
      setBatch(next);
      setRefundActions({});
      settlement.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if (databaseEnabled && admin) setReconciliationFailed(true);
      throw e;
    }
  });
  const canCheckSettlement = !busy && confirmed && (!databaseEnabled || !admin || databaseReady);
  const settlementTitle = databaseEnabled ? "核对到账与结清" : "核对结清";
  const monthlyStage = !batch ? "generate" : !confirmed ? "adjustments" : settled || databaseEnabled ? "settlement" : "payments";
  const monthlySteps = [
    { id: "generate", title: "生成草稿", text: "按上月考勤生成本月应发名单。", complete: Boolean(batch), control: !confirmed && admin && <button className="meal-ticket-button" disabled={busy} onClick={() => mutate("generate", { recharge_month: month })}>生成 / 重算草稿</button> },
    { id: "adjustments", title: "补扣与确认核算", text: "核对人员、补发或扣除、登记本月不发；处理异常并锁定考勤账套后确认。", complete: confirmed, control: !confirmed && batch && admin && <button className="meal-ticket-button is-primary" disabled={busy || errorCount > 0} onClick={() => mutate("confirm")}>确认核算</button> },
    { id: "export", title: "导出充值表", text: "两列 XLS，导出待充值余额。", complete: false, control: confirmed && !settled ? <button className="meal-ticket-button" disabled={busy} onClick={() => rechargeExport.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>前往导出</button> : null },
    ...(!databaseEnabled ? [{ id: "payments", title: "登记充值", text: "实际充值成功后，登记金额与凭证。", complete: false, control: confirmed && !settled && <button className="meal-ticket-button" disabled={busy} onClick={jumpToPeople}>登记实际充值</button> }] : []),
    { id: "settlement", title: settlementTitle, text: databaseEnabled ? "发放完成后读取补贴、充值与取款流水，自动核对到账和结清。" : "按每个人的应发与已发金额检查结清。", complete: settled, control: confirmed && !settled && <button className="meal-ticket-button" disabled={!canCheckSettlement} onClick={() => checkSettlement()}>{databaseEnabled ? settlementTitle : "重新核对"}</button> },
  ];
  const followupSteps = [
    { id: "adjustments", title: "补发 / 扣除", text: "保存补扣后，在菜票软件完成实际补发或取款，再进入下一步。", complete: followupStage !== "adjustments", control: <>
      {admin && <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={previewAttendance}>重算考勤数据</button>}
      <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={() => { setFollowupStage("adjustments"); jumpToPeople(); }}>{followupStage === "adjustments" ? "查看人员补扣" : "返回补发 / 扣除"}</button>
      {followupStage === "adjustments" && <button className="meal-ticket-button is-primary" disabled={busy || !confirmed} onClick={() => setFollowupStage(databaseEnabled ? "settlement" : "payments")}>下一步：{databaseEnabled ? settlementTitle : "登记补发 / 扣回"}</button>}
    </> },
    ...(!databaseEnabled ? [{ id: "payments", title: "登记补发 / 扣回", text: "实际处理成功后，登记对应差额。", complete: followupStage === "settlement", control: followupStage === "payments" && <>
      <button className="meal-ticket-button" disabled={busy || !confirmed} onClick={jumpToPeople}>处理人员差额</button>
      <button className="meal-ticket-button is-primary" disabled={busy || !confirmed} onClick={() => setFollowupStage("settlement")}>下一步：核对结清</button>
    </> }] : []),
    { id: "settlement", title: databaseEnabled ? settlementTitle : "再次核对结清", text: databaseEnabled ? "读取充值与取款流水，核对本次补扣的到账结果和剩余差额。" : "逐人检查剩余差额，补扣后再次核对。", complete: settled && followupStage === "settlement", control: followupStage === "settlement" && !settled && <button className="meal-ticket-button" disabled={!canCheckSettlement} onClick={() => checkSettlement()}>{databaseEnabled ? settlementTitle : "重新核对"}</button> },
  ];
  const steps = paymentView ? followupSteps : monthlySteps;
  const activeStage = paymentView ? followupStage : monthlyStage;
  const settlementComplete = settled && activeStage === "settlement";
  const isError = errorCount > 0 || reconciliationFailed;
  const showReconciliation = (!paymentView || followupStage === "settlement") && (confirmed || isError);

  return <main className={`meal-ticket-page${settlementComplete ? " is-settlement-complete" : ""}`}>
    <header className="meal-ticket-heading meal-ticket-header-combined meal-ticket-panel">
      <div className="meal-ticket-header-title-group">
        <h1>{historical ? "菜票历史台账" : paymentView ? "后续补扣与对账" : "月度发放"}</h1>
        <div className="meal-ticket-header-period-capsule" role="group" aria-label="核算月份与周期">
          <div className="meal-ticket-month-picker-field">
            <span className="meal-ticket-month-picker-label">{historical ? "文件月份" : "计划充值月份"}</span>
            <MonthPicker
              ariaLabel={historical ? "文件月份" : "计划充值月份"}
              value={month}
              disabled={busy}
              onChange={setMonth}
              format="YYYY-MM"
              className="meal-ticket-month-picker"
            />
          </div>
          {batch && !historical && (
            <>
              <span className="meal-ticket-period-divider" aria-hidden="true" />
              <span className="meal-ticket-period-text">
                考勤月份：{batch.month}
              </span>
              <span className={`meal-ticket-badge ${batch.status === "draft" ? "is-warning" : "is-success"}`}>
                {batch.status === "draft" ? "草稿" : "已确认"}
              </span>
            </>
          )}
        </div>
      </div>
      {!historical && showBatch && batch && (
        <div className="meal-ticket-header-stats" aria-label="金额概览">
          <div className="meal-ticket-header-stat is-due" title="基础金额 ＋ 额外补扣">
            <span className="meal-ticket-header-stat-label">应发金额</span>
            <strong className="meal-ticket-header-stat-value"><small>¥</small>{money(total("due_amount"))}</strong>
          </div>
          <div className="meal-ticket-header-stat is-paid" title="实际充值扣除退回与冲正">
            <span className="meal-ticket-header-stat-label">净已发金额</span>
            <strong className="meal-ticket-header-stat-value"><small>¥</small>{money(total("paid_amount"))}</strong>
          </div>
          <div className="meal-ticket-header-stat is-diff" title="应发金额 − 净已发金额">
            <span className="meal-ticket-header-stat-label">差额</span>
            <strong className="meal-ticket-header-stat-value"><small>¥</small>{money(total("difference"))}</strong>
          </div>
        </div>
      )}
      {!historical && confirmed && (
        <div className="meal-ticket-header-actions">
          <Link className="meal-ticket-button meal-ticket-export" to={`/meal-tickets/${paymentView ? "calculation" : "payments"}?recharge_month=${month}`}>
            {paymentView ? "查看月度发放" : "前往后续补扣与对账"}
          </Link>
        </div>
      )}
    </header>
    {!historical && <div className="meal-ticket-flow">
      <ol className="meal-ticket-workflow" aria-label={paymentView ? "后续补扣流程" : "月度发放流程"}>
        {steps.map((step, index) => <li key={step.id} className={step.id === activeStage ? "is-current" : step.complete ? "is-complete" : ""} aria-current={step.id === activeStage ? "step" : undefined}>
          <div className="meal-ticket-step-heading"><span className="meal-ticket-step-number">{index + 1}</span><h2>{step.title}</h2></div>
          <p className="meal-ticket-step-description">{step.text}</p>
          <div className="meal-ticket-step-action">{step.id === "settlement" && settlementComplete ? <span className="meal-ticket-badge is-success">已完成</span> : step.control}</div>
        </li>)}
      </ol>
      {!paymentView && confirmed && !settlementComplete && <section ref={rechargeExport} className="meal-ticket-export-toolbar" aria-label="充值表导出">
        <div className="meal-ticket-export-summary"><strong>充值表导出</strong><div className="meal-ticket-file-info"><span>XLS</span><small>员工编号 / 充值金额 · 不受列表筛选影响</small></div></div>
        <div className="meal-ticket-actions meal-ticket-export-actions">
          <a className="meal-ticket-button is-primary" href={mealRechargeExportUrl(month)}>导出充值表（.xls）</a>
          {admin && <button className="meal-ticket-button" disabled={busy || hasPaymentHistory || hasAttendanceRecalculation} onClick={returnToDraft}>退回上一步</button>}
        </div>
        {admin && hasPaymentHistory && <p className="meal-ticket-export-hint">已登记发放流水，请通过补扣或冲正处理。</p>}
        {admin && !hasPaymentHistory && hasAttendanceRecalculation && <p className="meal-ticket-export-hint">已完成后续考勤重算或人员补入，请继续通过后续补扣处理。</p>}
      </section>}
    </div>}
    {error && <div role="alert" className="meal-ticket-alert is-error">{error}</div>}
    {busy && !target && !bulk && <section role="status" className="meal-ticket-loading meal-ticket-panel" aria-live="polite">
      <div className="meal-ticket-loading-heading"><span><i className="meal-ticket-loading-dot" aria-hidden="true" />{loadProgress?.text ?? "正在提交并等待处理结果"}</span><strong>{progressPercent === null ? "处理中" : `${loadProgress?.phase ? "当前阶段 " : ""}${progressPercent}%`}</strong></div>
      <div className={`meal-ticket-progress-track${progressPercent === null ? " is-indeterminate" : ""}`} role="progressbar" aria-label={loadProgress?.label ?? "操作进度"} aria-valuetext={loadProgress?.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent ?? undefined}>
        <span style={progressPercent === null ? undefined : { width: `${progressPercent}%` }} />
      </div>
      <p>{loadProgress?.phase ? loadProgress.total > 0 ? `当前阶段已完成 ${loadProgress.completed} / ${loadProgress.total} 人` : "正在执行当前阶段，完成后自动进入下一阶段。" : loadProgress ? `已完成 ${loadProgress.completed} / ${loadProgress.total} 项请求` : "处理完成后会自动更新账目，请稍候。"}</p>
    </section>}
    {!historical && batch?.source_changed && (paymentView || !confirmed) && <p className="meal-ticket-alert">{confirmed ? "源考勤或人员资料已变化。请在第一步重算考勤数据，核对差额后登记补扣；原核算和实际充值金额保留。" : "源考勤或人员资料已变化，草稿请重算。"}</p>}
    {!historical && !busy && (paymentView ? !confirmed : !batch) && <div className="meal-ticket-empty meal-ticket-panel"><h2>{paymentView ? "请先完成月度核算" : "本月尚无核算记录"}</h2><p>{paymentView ? "在月度发放页生成草稿、处理补扣并确认核算后，再处理后续补扣与对账。" : "该充值月尚无核算记录，请从第 1 步生成对应上月考勤的草稿。"}</p>{paymentView && <Link className="meal-ticket-button is-primary" to={`/meal-tickets/calculation?recharge_month=${month}`}>前往月度发放</Link>}</div>}
    {!historical && showBatch && batch && <>
      {showReconciliation && <>
      <section ref={settlement} className={`meal-ticket-settlement${isError ? " is-error" : settled ? " is-settled" : ""}`} aria-label="整月结清检查" aria-live="polite" title="按整月全部人员检查，不受列表筛选影响。结清结果以实际发放记录为依据。">
        <div className="meal-ticket-reconciliation-header">
        <div className="meal-ticket-settlement-message">
          <svg className="meal-ticket-notice-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle className={settled ? "meal-ticket-check-ring" : undefined} cx="12" cy="12" r="9" pathLength={settled ? 1 : undefined} />{settled ? <path className="meal-ticket-checkmark" d="m7 12 3 3 7-7" pathLength="1" /> : <><path d="M12 7v6" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></>}</svg>
          <strong>{!confirmed ? "草稿待核算" : reconciliationFailed ? "数据库核对未完成" : settled ? "本月账目已结清" : "还有差额需要处理"}</strong>
          {!settled && <span>{!confirmed ? `异常 ${errorCount} 人；完成核对并处理全部异常后，方可点击“确认核算”。` : `待充值 ${pendingCount} 人 · 待扣回 ${refundCount} 人 · 异常 ${errorCount} 人`}</span>}
        </div>
        {!settled && <div className="meal-ticket-actions"><button className={`meal-ticket-button ${isError ? "is-danger" : "is-primary"}`} disabled={busy || errorCount === 0} onClick={showIssues}>查看异常（{errorCount} 人）</button>
          {confirmed && !settled && <><button className="meal-ticket-button" onClick={() => { setFilterEmployeeIds([]); setDepartmentNames([]); setType(""); setPaymentStatus("pending"); jumpToPeople(); }}>查看待充值</button><button className="meal-ticket-button" onClick={() => { setFilterEmployeeIds([]); setDepartmentNames([]); setType(""); setPaymentStatus("refund"); jumpToPeople(); }}>查看待扣回</button></>}
        </div>}</div>
      </section>
        {databaseEnabled && activeStage === "settlement" && !settlementComplete && <section className="meal-ticket-panel meal-ticket-reconciliation" aria-label="到账核对">
          <div className="meal-ticket-section-heading"><h2>到账核对</h2></div>
          <div className="meal-ticket-reconciliation-controls">
            {admin && <><label>核对开始日期<input type="date" min={`${month}-01`} disabled={busy} value={rangeStart} onChange={e => changeRange("start", e.target.value)} /></label>
              <label>核对结束日期<input type="date" min={rangeStart} disabled={busy} value={rangeEnd} onChange={e => changeRange("end", e.target.value)} /></label>
              <button className="meal-ticket-button is-primary" disabled={busy || !confirmed || !databaseReady || !rangeStart || !rangeEnd || rangeEnd < rangeStart} onClick={() => checkSettlement()}>读取数据库并核对</button></>}
            <span className={`meal-ticket-badge ${databaseReady ? "is-success" : "is-warning"}`}>{!databaseActive ? "数据库核对已暂停" : databaseReady ? "共享数据库已启用" : "共享数据库尚未配置"}</span>
          </div>
          <p className="meal-ticket-reconciliation-note">净已发 = 补贴发放 ＋ 充值 − 发放纠错扣回。新取款须确认分类，月末余额清零单独记录。跨月补发可延长结束日期，其他月份的补贴不会计入。</p>
          {!!report?.pending_refunds?.length && <div className="meal-ticket-reconciliation-pending-refunds"><h3>取款流水待分类</h3><p>请选择实际用途，未分类流水尚未计入扣回或清零。</p>
            {report.pending_refunds.map(row => <label key={row.id}>{row.date} · {row.emp_no} {row.name} · {money(row.amount)} 元 <select aria-label={`流水 ${row.id} 分类`} value={refundActions[String(row.id)] ?? ""} disabled={busy || !admin} onChange={e => setRefundActions(current => ({ ...current, [row.id]: e.target.value }))}>
              <option value="">待确认</option><option value="refund">发放纠错扣回</option><option value="clearance">月末余额清零</option>
            </select></label>)}
            {admin && <button className="meal-ticket-button is-primary" disabled={busy || !databaseReady || !report.pending_refunds.every(row => refundActions[String(row.id)])} onClick={() => checkSettlement(refundActions)}>确认分类并重新核对</button>}
          </div>}
          {!databaseReady && admin && <p className="meal-ticket-reconciliation-note">{!databaseActive ? "请在“数据来源与同步”中重新开启菜票数据库核对。已有数据库流水的账目通过数据库继续核对。" : "请在“数据来源与同步”中配置共享数据库连接后核对。"}</p>}
          {reconciliationFailed && <p className="meal-ticket-reconciliation-note">本次核对未完成，金额保留上次登记结果，请排查后重试。</p>}
          {report ? <div className="meal-ticket-reconciliation-result" role="status"><strong>新增 {report.added} 条 · 已登记 {report.existing} 条</strong><span>核对范围 {report.start_date} 至 {report.end_date} · {report.checked_at.replace("T", " ")}</span>
            {!!(report.unmatched || report.zero_amount || report.outside_subsidy_month) && <span>未匹配本月人员 {report.unmatched} 条 · 零金额 {report.zero_amount} 条 · 其他月份补贴 {report.outside_subsidy_month} 条，均未计入。</span>}</div>
            : <p className="meal-ticket-reconciliation-note">点击核对后自动登记实际流水并更新结清状态；重复核对不会重复计入。</p>}
        </section>}
      </>}
      {!databaseEnabled && !settlementComplete && <div className="meal-ticket-subtle-tip" role="note">
        <span className="meal-ticket-tip-dot" aria-hidden="true" />
        <span>菜票数据库核对未启用，当前按已登记发放检查结清。可在“数据来源与同步”中开启共享连接的菜票核对。</span>
      </div>}
      {!settlementComplete && <section ref={personnel} className="meal-ticket-panel" aria-label={resultView === "person" ? "人员明细" : "部门汇总"}><div className="meal-ticket-section-heading"><div><h2>{resultView === "person" ? "人员明细" : "部门汇总"}</h2><p>{resultView === "department" ? "按当前筛选范围汇总，点击部门查看对应人员明细。" : !confirmed ? "第 2 步：先核对金额，补扣填正数为补发、负数为扣除。" : paymentView ? databaseEnabled ? "追加补扣并在菜票软件处理后，读取数据库核对最新差额。" : "追加补扣后，按最新差额登记实际补发或扣回。" : databaseEnabled ? "菜票软件发放后，读取数据库自动更新到账；后续调整请前往补扣与对账页。" : "第 4 步：充值成功后选择人员登记；后续调整请前往补扣与对账页。"}</p></div><div className="meal-ticket-actions"><div className="meal-ticket-view-switch" role="group" aria-label="结果表视图"><button className="meal-ticket-button" aria-pressed={resultView === "person"} onClick={() => changeResultView("person")}>人员明细</button><button className="meal-ticket-button" aria-pressed={resultView === "department"} onClick={() => changeResultView("department")}>部门汇总</button></div><span className="meal-ticket-count">{resultView === "person" ? `${rows.length} 人` : `${departmentRows.size} 个部门`}</span></div></div>
      <div className="meal-ticket-toolbar meal-ticket-filters">
        <div className="meal-ticket-picker-field"><span>人员筛选</span><EmployeePicker departments={pickerDepartments} employees={pickerEmployees} selectedIds={filterEmployeeIds} onChange={ids => { setFilterEmployeeIds(ids); setDepartmentNames([]); changeResultView("person"); }} label="人员筛选" showFieldChrome={false} emptyHint="未选择时显示本月全部人员。" /></div>
        <div className="meal-ticket-picker-field"><span>核算部门</span><DepartmentMultiPicker departments={pickerDepartments} selectedIds={pickerDepartments.filter(dept => departmentNames.includes(dept.dept_name)).map(dept => dept.id)} onChange={ids => { setDepartmentNames(pickerDepartments.filter(dept => ids.includes(dept.id)).map(dept => dept.dept_name)); setFilterEmployeeIds([]); changeResultView("department"); }} label="核算部门" showFieldChrome={false} /></div>
        <label>人员类型<select value={type} onChange={e => setType(e.target.value)}><option value="">全部人员</option><option value="employee">员工</option><option value="manager">管理人员</option></select></label>
        <label>发放 / 核算状态<select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}><option value="">全部</option><option value="issue">核算异常</option><option value="pending">待发</option><option value="settled">结清</option><option value="refund">待扣回</option><option value="excluded">本月不发</option></select></label>
      </div>
      {admin && resultView === "person" && <div className="meal-ticket-selection-bar"><span>已选 {selectedItems.length} 人</span><span>全选作用于当前筛选全部人员，可跨页选择。</span>
        <button className="meal-ticket-button is-link" disabled={busy || !selected.length} onClick={() => setSelected([])}>清空选择</button>
        {batch.status === "draft" && <><button className="meal-ticket-button" disabled={busy || !selectedItems.some(i => bulkEligible(i, "exclude"))} onClick={() => openBulk("exclude")}>批量本月不发</button><button className="meal-ticket-button" disabled={busy || !selectedItems.some(i => bulkEligible(i, "include"))} onClick={() => openBulk("include")}>批量恢复核算</button></>}
        {(batch.status === "draft" || paymentView) && <button className="meal-ticket-button" disabled={busy || !selectedItems.some(i => bulkEligible(i, "adjustments"))} onClick={() => openBulk("adjustments")}>批量补发 / 扣除</button>}
        {batch.status === "confirmed" && !databaseEnabled && <button className="meal-ticket-button is-primary" disabled={busy || !selectedItems.some(i => bulkEligible(i, "recharge"))} onClick={() => openBulk("recharge")}>登记选中人员充值</button>}
      </div>}
      {paymentStatus === "issue" && <p className="meal-ticket-alert">已自动核对员工档案的离职登记。缺少考勤来源且未登记离职时，需核对考勤或补办离职登记；已登记离职的人员仍需决定本月不发或结算，登记日期可能存在延迟。</p>}
      {resultView === "person" ? <QueryTable key="person" paginationKey={JSON.stringify([month, filterEmployeeIds, departmentNames, type, paymentStatus])} headers={[...(admin ? [{ label: <input type="checkbox" aria-label="全选筛选结果" disabled={busy || !selectableRows.length} checked={allSelected}
          ref={node => { if (node) node.indeterminate = !allSelected && selectableRows.some(item => selected.includes(item.id)); }}
          onChange={e => setSelected(s => e.target.checked ? [...new Set([...s, ...selectableRows.map(item => item.id)])] : s.filter(id => !selectableRows.some(item => item.id === id)))} />, sortable: false }] : []), "工号","姓名","核算部门","实际打卡天数","基础金额","额外补扣","应发金额","净已发金额","差额","状态 / 操作"]}
        sortRows={rows.map(i => [...(admin ? [null] : []), i.emp_no, i.name, i.dept_name, i.days, i.base_amount, i.adjustment_amount, i.due_amount, i.paid_amount, i.difference,
          hasIssue(i) ? 0 : i.difference < 0 ? 1 : i.excluded && i.due_amount === 0 ? 5 : i.difference === 0 ? 4 : i.paid_amount > 0 ? 3 : 2])}
        rows={rows.map(i => [...(admin ? [<input aria-label={`选择 ${i.emp_no}`} type="checkbox" disabled={busy || !selectableRows.some(item => item.id === i.id)} checked={selected.includes(i.id)} onChange={e => setSelected(s => e.target.checked ? [...s, i.id] : s.filter(id => id !== i.id))} />] : []), i.emp_no, i.name, i.dept_name, i.days, money(i.base_amount), money(i.adjustment_amount), money(i.due_amount), money(i.paid_amount), money(i.difference),
          <div className="meal-ticket-actions"><span className={`meal-ticket-badge ${hasError(i) || i.difference < 0 ? "is-danger" : i.difference === 0 ? "is-success" : "is-warning"}`}>{hasError(i) ? i.error : i.difference < 0 ? "待扣回" : i.excluded && i.due_amount === 0 ? "本月不发" : (i.difference === 0 ? "结清" : i.paid_amount > 0 ? "部分发放" : "未发")}</span>
            {employmentLabel(i) && (hasIssue(i) || i.employment_status !== "active") && <span className="meal-ticket-badge is-warning">{employmentLabel(i)}</span>}
            <button className="meal-ticket-button is-link" onClick={() => setDetail(i)}>明细</button>{admin && (paymentView || batch.status === "draft") && !(batch.status === "draft" && i.excluded) && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i,"adjustments")}>补扣</button>}
            {admin && batch.status === "draft" && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i, i.excluded ? "include" : "exclude")}>{i.excluded ? "恢复核算" : "本月不发"}</button>}
            {admin && batch.status === "confirmed" && !databaseEnabled && !hasError(i) && <>
              {i.difference > 0 && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i,"recharge")}>登记充值</button>}
              {i.difference < 0 && <button className="meal-ticket-button is-link" disabled={busy} onClick={() => openForm(i,"refund")}>登记扣回</button>}
            </>}
          </div>])} /> : <QueryTable key="department" headers={["部门","人数","基础金额","额外补扣","应发金额","净已发金额","差额"]}
        sortRows={[...departmentRows.values()].map(d => [d.dept_name, d.count, d.base_amount, d.adjustment_amount, d.due_amount, d.paid_amount, d.difference])}
        rows={[...departmentRows.values()].map(d => [<button className="meal-ticket-button is-link" onClick={() => { setDepartmentNames([d.dept_name]); changeResultView("person"); }}>{d.dept_name}</button>,d.count,...[d.base_amount,d.adjustment_amount,d.due_amount,d.paid_amount,d.difference].map(money)])} />}
      </section>}
    </>}
    {(target || bulk) && <div className="meal-ticket-modal"><section className="meal-ticket-operation-dialog" role="dialog" aria-modal="true" aria-busy={busy} aria-label={bulk ? participationForm ? "批量核算处理" : action === "adjustments" ? "批量补扣" : "批量充值" : participationForm ? "核算处理" : action === "adjustments" ? "额外补扣" : "实际发放登记"}>
      <header className="meal-ticket-operation-heading"><span className="meal-ticket-operation-eyebrow">{bulk ? "批量操作" : "菜票登记"}</span><h2>{bulk ? `${busy && loadProgress ? loadProgress.total : bulkItems.length} 人 · ${participationForm ? participationLabel : action === "adjustments" ? "批量补发 / 扣除" : "登记实际充值"}` : `${target?.name} · ${participationForm ? participationLabel : action === "adjustments" ? "额外补扣" : action === "reversal" ? "冲正" : "实际发放"}`}</h2><p>核对人员和操作内容后提交，完成后自动更新账目。</p></header>
      {bulk && <div className="meal-ticket-operation-selection">
        <div className="meal-ticket-operation-selection-heading"><strong>{busy ? "待处理人员" : "本次处理人员"}</strong><span>{bulkItems.length} 人</span></div>
        <ul aria-label="本次操作人员">{bulkItems.map(item => <li key={item.id}><span>{item.name}<small>{item.emp_no}</small></span>{!participationForm && action !== "adjustments" && <strong>{money(item.difference)}<small>元</small></strong>}</li>)}</ul>
        <p>仅处理符合条件的选中人员。{!participationForm && action !== "adjustments" && !busy && <strong> 合计充值 {money(bulkItems.reduce((total, item) => total + Number(item.difference), 0))} 元</strong>}</p>
      </div>}
      {bulk && !busy && action === "adjustments" && amount && Number.isFinite(Number(amount)) && <p>本次处理 {bulkItems.length} 人 · 合计调整 {money(Number(amount) * bulkItems.length)} 元</p>}
      {participationForm && <p>{action === "exclude" ? "本月应发金额按 0 元核算，原考勤和补扣记录保留，缺少考勤来源不再阻止确认。" : "恢复按实际打卡天数和原补扣核算，考勤异常需核对后才能确认。"}</p>}
      <form onSubmit={e => { e.preventDefault(); void (bulk ? saveBulk() : save()); }}>
        {!participationForm && action !== "reversal" && (!bulk || action === "adjustments") && <label>{action === "adjustments" ? bulk ? "每人调整金额（元）" : "调整金额（元）" : "金额（元）"}<input type="number" step="0.01" required disabled={busy} value={amount} onChange={e => setAmount(e.target.value)} /></label>}
        {!participationForm && action !== "adjustments" && <label>实际日期<input type="date" required disabled={busy} value={date} onChange={e => setDate(e.target.value)} /></label>}
        {reasonPresets.length > 0 && <div className="meal-ticket-reason-presets" role="group" aria-label="原因常用语"><span>常用语</span>{reasonPresets.map(phrase => <button className="meal-ticket-button" type="button" disabled={busy} key={phrase} onClick={() => {
          setSupplementMonth(phrase === "补x月菜票" ? "" : null);
          setReason(phrase === "补x月菜票" ? "" : phrase);
        }}>{phrase}</button>)}</div>}
        {supplementMonth !== null && <label>补发月份<select disabled={busy} value={supplementMonth} onChange={e => {
          setSupplementMonth(e.target.value); setReason(e.target.value ? `补${e.target.value}月菜票` : "");
        }}><option value="">请选择月份</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1} 月</option>)}</select></label>}
        <label>{participationForm ? "处理原因" : action === "adjustments" ? "调整原因" : "凭证 / 说明"}<textarea required maxLength={500} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <p className="meal-ticket-reason-hint">原因或说明必填，常用语可继续编辑。</p>
        {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
        {(bulk || busy) && <div className="meal-ticket-operation-progress" role="status" aria-live="polite">
          <div className="meal-ticket-loading-heading"><span>{busy ? loadProgress?.text ?? "正在提交并等待处理结果" : error ? "未完成人员可继续重试" : "准备就绪，等待确认"}</span><strong>{bulk ? `${progressPercent ?? 0}%` : "处理中"}</strong></div>
          <div className={`meal-ticket-progress-track${bulk ? "" : " is-indeterminate"}`} role="progressbar" aria-label={loadProgress?.label ?? (!bulk ? "操作进度" : participationForm ? "批量核算处理进度" : action === "adjustments" ? "批量补扣进度" : bulk ? "批量充值进度" : "操作进度")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bulk ? progressPercent ?? 0 : undefined}>
            <span style={bulk ? { width: `${progressPercent ?? 0}%` } : undefined} />
          </div>
          <p>{busy && loadProgress ? `已完成 ${loadProgress.completed} / ${loadProgress.total} 人，请等待处理完成。` : busy ? "处理完成后会自动更新账目。" : `待处理 ${bulkItems.length} 人，进度按实际成功人数更新。`}</p>
        </div>}
        <div className="meal-ticket-actions"><button className="meal-ticket-button is-primary" disabled={busy || !reason.trim() || (bulk && !bulkItems.length)} type="submit">{participationForm ? `确认${participationLabel}` : action === "adjustments" ? "保存补扣" : "确认登记"}</button><button className="meal-ticket-button" type="button" disabled={busy} onClick={() => { setTarget(null); setBulk(false); }}>取消</button></div>
      </form>
    </section></div>}
    {attendancePreview && <div className="meal-ticket-modal"><section className="meal-ticket-operation-dialog" role="dialog" aria-modal="true" aria-busy={busy} aria-label="考勤重算差额">
      <h2>考勤重算差额 · {batch?.month}</h2>
      <p>按最新考勤与上次核算考勤的差值登记补扣。原基础金额、手工补扣和实际充值流水保留，本月不发选择保留。</p>
      <QueryTable headers={["工号", "姓名", "上次打卡天数", "最新打卡天数", "本次补发 / 扣除（元）"]}
        rows={attendancePreview.rows.map(row => [row.emp_no, row.name, row.previous_days, row.days, row.excluded ? "本月不发 · 0.00" : money(row.amount)])} />
      <p>本次合计调整 {money(attendancePreview.total_amount)} 元；正数补发，负数扣除。确认后仍需完成实际补发或扣回并核对结清。</p>
      {attendancePreview.issues.length > 0 && <div className="meal-ticket-alert is-error"><p>以下人员需核对，暂不能登记本次重算：</p><ul>{attendancePreview.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      {!!attendancePreview.new_people?.length && <>
        <h3>新增人员核对</h3>
        <p>核对考勤和部门，填写原因后逐人补入。补入后仍需完成实际充值并核对到账。</p>
        <QueryTable headers={["工号", "姓名", "部门", "实际打卡天数", "应发金额", "核对 / 操作"]}
          rows={attendancePreview.new_people.map(person => [person.emp_no, person.name, person.dept_name,
            person.days, money(person.base_amount), <div className="meal-ticket-row-actions">
              <Link to={`/employee/individual-attendance?emp_id=${person.emp_id}&month=${batch?.month}`}>查看考勤依据</Link>
              {person.error && <span>{person.error}</span>}
              <label>补入原因<input aria-label={`${person.emp_no} 补入原因`} disabled={busy}
                value={supplementReasons[person.emp_id] ?? ""}
                onChange={e => setSupplementReasons(reasons => ({...reasons, [person.emp_id]:e.target.value}))} /></label>
              <button className="meal-ticket-button" disabled={busy || !!person.error || !supplementReasons[person.emp_id]?.trim()}
                onClick={() => supplementPerson(person.emp_id)}>核对并补入本月核算</button>
            </div>])} />
      </>}
      {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
      <div className="meal-ticket-actions">
        <button className="meal-ticket-button is-primary" disabled={busy || attendancePreview.issues.length > 0} onClick={applyAttendance}>确认登记考勤补扣</button>
        <button className="meal-ticket-button" disabled={busy} onClick={previewAttendance}>重新预览</button>
        <button className="meal-ticket-button" disabled={busy} onClick={() => { setAttendancePreview(null); setError(""); }}>取消</button>
      </div>
    </section></div>}
    {detail && <div className="meal-ticket-modal"><section role="dialog" aria-modal="true" aria-label="菜票明细"><h2>{detail.emp_no} {detail.name}</h2>
      <p>实际打卡天数：{detail.days} · 基础金额：{money(detail.base_amount)} 元</p>
      <p>考勤来源：{detail.source.configured_source} {detail.source.remark}</p>
      {detail.source.supplement_confirmation && <p>补入核算：{detail.source.supplement_confirmation.reason} · {detail.source.supplement_confirmation.operator} · {detail.source.supplement_confirmation.created_at}</p>}
      {employmentLabel(detail) && <p>员工档案核对：{employmentLabel(detail)}</p>}
      {detail.error && <p>原考勤核对提示：{detail.error}</p>}
      {detail.excluded && <p>原基础金额：{money(detail.original_base_amount)} 元；本月基础金额按 0 元核算，确认后的补发另记补扣。</p>}
      <Link to={`/employee/individual-attendance?emp_id=${detail.emp_id}&month=${batch?.month}`}>查看考勤依据</Link>
      {!!detail.participation_history?.length && <><h3>核算处理历史</h3>{detail.participation_history.map((p, index) => <p key={index}>{p.excluded ? "本月不发" : "恢复核算"} · {p.reason} · {p.operator} · {p.created_at}</p>)}</>}
      <h3>补扣历史</h3>{detail.adjustments.map(a => <p key={a.id}>{money(a.amount)} 元 · {a.reason} · {a.operator} · {a.created_at}</p>)}
      <h3>充值 / 扣回历史</h3>{detail.payments.map(p => <p key={p.id}>{p.date} · {money(p.amount)} 元 · {p.reference} · {p.operator} {p.reversed && "（已冲正）"}
        {admin && !p.database_record && p.kind !== "reversal" && !p.reversed && <button className="meal-ticket-button is-link" onClick={() => { setDetail(null); openForm(detail, "reversal", p.id); }}>冲正</button>}</p>)}
      <button className="meal-ticket-button" onClick={() => setDetail(null)}>关闭</button></section></div>}
    {historical && admin && <>
      <section className="meal-ticket-toolbar meal-ticket-panel"><label>文件月份含义<select value={monthKind} onChange={e => setMonthKind(e.target.value)}><option value="recharge">充值月份</option><option value="attendance">考勤月份</option></select></label>
        <label>历史充值表<input ref={historyFile} type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        <button className="meal-ticket-button is-primary" disabled={busy || !file} onClick={() => operate(async () => {
          const form = new FormData(); form.append("file", file!); form.append("month",month); form.append("month_kind",monthKind);
          setPreview(await previewMealImport(form));
        })}>预览导入</button></section>
      <section className="meal-ticket-panel" aria-label="导入记录"><div className="meal-ticket-section-heading"><div><h2>导入记录</h2><p>原账金额保留。部门登记用于对账，导入不会自动标记实际充值。</p></div></div>
      <QueryTable headers={["文件","考勤月","充值月","状态","人员总额","部门登记总额","操作"]}
        rows={imports.map(r => [r.filename,r.month,r.recharge_month,r.status === "preview" ? "待确认" : "已导入",money(r.person_total),money(r.department_total),<button className="meal-ticket-button is-link" onClick={() => setPreview(r)}>查看</button>])} />
      </section>
      {preview && <section className="meal-ticket-panel meal-ticket-preview"><h2>{preview.filename} · 考勤 {preview.month} / 充值 {preview.recharge_month}</h2>
        <p>人员原账 {money(preview.person_total)} 元 · 部门原账 {money(preview.department_total)} 元</p>
        {preview.status === "preview" && preview.rows.some(r => r.period_conflict && !r.period_confirmed && !r.skip) && <div className="meal-ticket-alert"><p>文件或页内年月与所选月份不一致，请核对上方考勤月和充值月。</p>
          <button className="meal-ticket-button" onClick={confirmPeriod}>已核对年月差异，按所选月份归档</button></div>}
        {preview.status === "preview" && <>
          <div className="meal-ticket-actions">
            <button className="meal-ticket-button" aria-pressed={importIssuesOnly} onClick={() => setImportIssuesOnly(true)}>仅看问题行</button>
            <button className="meal-ticket-button" aria-pressed={!importIssuesOnly} onClick={() => setImportIssuesOnly(false)}>显示全部</button>
            <span>问题 {importIssueCount} 行 · 显示 {importRows.length} / {preview.rows.length} 行</span>
          </div>
          <div className="meal-ticket-toolbar">
            <label>批量设置部门<select disabled={busy} value={importDepartment} onChange={e => setImportDepartment(e.target.value)}><option value="">请选择部门</option>{historyDepartments.map(name => <option key={name} value={name}>{name}</option>)}<option value="__historical__">填写历史部门（仅此原账）</option></select></label>
            {importDepartment === "__historical__" && <label>批量历史部门名称<input disabled={busy} maxLength={100} value={importCustomDepartment} onChange={e => setImportCustomDepartment(e.target.value)} /></label>}
            <label>批量更正说明<input disabled={busy} maxLength={500} value={importReason} onChange={e => setImportReason(e.target.value)} /></label>
          </div>
          <div className="meal-ticket-selection-bar">
            <span>已选 {importSelected.length} 行；全选作用于当前筛选全部行，可跨页选择。</span>
            <button className="meal-ticket-button" disabled={busy || !importSelected.length || !importDepartmentValue || !importReason.trim()} onClick={() => editSelectedImportRows({ dept_name: importDepartmentValue, correction_reason: importReason })}>批量设置部门</button>
            <button className="meal-ticket-button" disabled={busy || !importSelected.length || !importReason.trim()} onClick={() => editSelectedImportRows({ correction_reason: importReason })}>批量填写说明</button>
            <button className="meal-ticket-button" disabled={busy || !importSelected.length} onClick={() => editSelectedImportRows({ skip: true })}>批量跳过</button>
            <button className="meal-ticket-button" disabled={busy || !importSelected.length} onClick={() => editSelectedImportRows({ skip: false })}>批量恢复</button>
            <button className="meal-ticket-button" disabled={busy || !importSelected.length} onClick={() => setImportSelected([])}>清空选择</button>
          </div>
        </>}
        <QueryTable paginationKey={JSON.stringify([preview.id, importIssuesOnly])} emptyText={importIssuesOnly ? "当前没有需要处理的问题行" : "当前没有导入行"}
          headers={[...(preview.status === "preview" ? [{ label: <input type="checkbox" aria-label="全选导入筛选结果" disabled={busy || !importRows.length} checked={allImportSelected}
            ref={node => { if (node) node.indeterminate = !allImportSelected && importRows.some(row => importSelected.includes(row.id)); }}
            onChange={e => setImportSelected(current => e.target.checked ? [...new Set([...current, ...importRows.map(row => row.id)])] : current.filter(id => !importRows.some(row => row.id === id)))} />, sortable: false }] : []), "页 / 行","类型","原工号 / 姓名","人员映射","部门","金额","核对说明","更正说明","跳过"]}
          rows={importRows.map(r => [ ...(preview.status === "preview" ? [<input type="checkbox" aria-label={`选择导入行 ${r.id}`} disabled={busy} checked={importSelected.includes(r.id)} onChange={e => setImportSelected(current => e.target.checked ? [...current, r.id] : current.filter(id => id !== r.id))} />] : []), `${r.sheet} / ${r.row}`,r.kind === "person" ? "人员" : "部门汇总",`${r.emp_no} ${r.name}`,
            r.kind === "person" ? <select aria-label={`人员映射 ${r.id}`} disabled={busy || preview.status === "confirmed"} value={r.emp_id ?? ""} onChange={e => editRow(r.id,{emp_id:Number(e.target.value) || null})}><option value="">未匹配</option>{people.map(p => <option key={p.id} value={p.id}>{p.emp_no} {p.name}</option>)}</select> : "—",
            <div><select aria-label={`部门 ${r.id}`} disabled={busy || preview.status === "confirmed"} value={historyDepartments.includes(r.dept_name) ? r.dept_name : "__historical__"} onChange={e => editRow(r.id,{dept_name:e.target.value === "__historical__" ? "" : e.target.value})}>
              {historyDepartments.map(name => <option key={name} value={name}>{name}</option>)}
              <option value="__historical__">填写历史部门（仅此原账）</option>
            </select>{!historyDepartments.includes(r.dept_name) && <input aria-label={`历史部门名称 ${r.id}`} maxLength={100} disabled={busy || preview.status === "confirmed"} value={r.dept_name} placeholder="填写历史部门名称" onChange={e => editRow(r.id,{dept_name:e.target.value})} />}</div>,
            <input aria-label={`金额 ${r.id}`} type="number" step="0.01" disabled={busy || preview.status === "confirmed"} value={r.amount ?? ""} onChange={e => editRow(r.id,{amount:e.target.value === "" ? null : Number(e.target.value)})} />,
            preview.status === "preview" ? importIssues.get(r.id)?.join("；") || (r.skip ? "已跳过" : "核对通过") : [r.error,r.period_conflict].filter(Boolean).join("；"),<input aria-label={`更正说明 ${r.id}`} maxLength={500} disabled={busy || preview.status === "confirmed"} value={r.correction_reason} onChange={e => editRow(r.id,{correction_reason:e.target.value})} />,
            <input aria-label={`跳过 ${r.id}`} type="checkbox" disabled={busy || preview.status === "confirmed"} checked={r.skip} onChange={e => editRow(r.id,{skip:e.target.checked})} /> ])} />
        {preview.status === "preview" && <div className="meal-ticket-actions">
          <button className="meal-ticket-button is-primary" disabled={busy} onClick={() => operate(async () => { setPreview(await confirmMealImport(preview)); setImports(await fetchMealImports()); })}>确认导入原账</button>
          <button className="meal-ticket-button" disabled={busy} onClick={() => operate(async () => {
            await cancelMealImport(preview.id);
            setImports(current => current.filter(record => record.id !== preview.id));
            setPreview(null); setFile(null); setError("");
            if (historyFile.current) historyFile.current.value = "";
            setImports(await fetchMealImports());
          })}>取消</button>
        </div>}
        <h3>历史部门对账</h3><QueryTable headers={["部门","人员原账合计","部门原登记","差额"]} rows={preview.departments.map(d => [d.dept_name,money(d.person_amount),money(d.historical_amount),money(d.difference)])} />
        <h3>原账与新规则试算</h3><p>按现有考勤字段 × 8 元试算，未包含额外补扣；仅用于核对，不改变原账或生成充值记录。</p>
        <button className="meal-ticket-button is-primary" disabled={busy} onClick={() => operate(async () => setComparison(await compareMealImport(preview.id)))}>读取考勤试算对比</button>
        {comparison.length > 0 && <QueryTable headers={["工号","姓名","原账金额","实际打卡天数","基础试算金额","原账减试算","核对说明"]}
          rows={comparison.map(r => [r.emp_no,r.name,r.historical_amount === null ? "—" : money(r.historical_amount),r.days ?? "—",r.base_amount === null ? "—" : money(r.base_amount),r.difference === null ? "—" : money(r.difference),r.error])} />}
      </section>}
    </>}
  </main>;
}
