import { Fragment, useEffect, useRef, useState } from "react";
import { fetchAdminDepartments } from "../api/admin";
import type { AdminDepartment } from "../types/admin";
import DepartmentPicker from "../components/query/DepartmentPicker";
import { apiRequest } from "../api/client";
import { businessMonth, fetchAnnual, fetchLedger, fetchGuestCards, money, saveLedger, voidLedger,
  type AnnualLedger, type DepartmentLedger, type LedgerKind, type LedgerRecord, type GuestCard } from "../api/mealLedgers";
import { GuestCardRegistry, GuestRechargeDialog } from "../components/meal/GuestCardTools";
import MealClearanceImport, { type ClearanceStage } from "../components/meal/MealClearanceImport";
import QueryTable from "../components/query/QueryTable";
import MonthPicker from "../components/common/MonthPicker";
import LoadingState from "../components/feedback/LoadingState";
import { LedgerBookIcon, AlertTriangleIcon } from "../components/icons";
import "./meal-ticket.css";
import "./meal-ledger.css";
import "./meal-external.css";

type View = "department" | "external" | "clearance" | "annual";

const titles = {
  department: "部门菜票发放汇总",
  external: "外来人员领用",
  clearance: "月末取款记录",
  annual: "全年菜票汇总",
};

const descriptions = {
  department: "部门发放合计包含员工净实际发放、客人卡充值和纸质菜票，外来领用自动计入承担费用的部门。",
  external: "选择客人卡登记本次领用，再查询数据库核对充值；已核对到账计入承担部门。纸质金额填写票面总额。",
  clearance: "查询真实取款流水，确认月末余额清零后自动入账；手工登记作为补充，不影响菜票发放结清。",
  annual: "按实际业务月份汇总。纸质领用单列，收回取实际清零记录，消费未录入保持空值。",
};

const initialForm = () => ({
  guest_card_key: "", name: "", emp_no: "", dept_name: "", card_no: "", amount: "", category: "card",
  unit: "", period: "", days: "", registrar: "", remark: "", floor2: "", floor3: "", date: ""
});

const externalDate = (month: string) => {
  const now = new Date();
  return month === businessMonth() ? `${month}-${String(now.getDate()).padStart(2, "0")}` : "";
};

const actualAmount = (record: LedgerRecord) => record.actual_amount ?? record.amount;
const rechargeLabel = {manual:"手工登记", pending:"未充值", partial:"部分到账", complete:"已到账"};

export default function MealLedgerPage({ kind }: { kind: View }) {
  const recordKind: LedgerKind = kind === "annual" ? "consumption" : kind;
  const [month, setMonth] = useState(businessMonth);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [serviceRange, setServiceRange] = useState({start:"", end:""});
  const [cards, setCards] = useState<GuestCard[]>([]);
  const [clearanceStage, setClearanceStage] = useState<ClearanceStage>("query");
  const [externalStep, setExternalStep] = useState<"register" | "recharge" | "ledger">("register");
  const [rechargeTarget, setRechargeTarget] = useState<LedgerRecord | null>(null);
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [department, setDepartment] = useState<DepartmentLedger | null>(null);
  const [annual, setAnnual] = useState<AnnualLedger | null>(null);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [voidTarget, setVoidTarget] = useState<LedgerRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<LedgerRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const detailDialog = useRef<HTMLElement>(null);
  const ledgerRevision = useRef(0);
  const request = useRef({ signature: "", key: "" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setDepartment(null); setAnnual(null); setRecords([]);
    const data = kind === "annual" ? fetchAnnual(year) : kind === "department" ? fetchLedger<DepartmentLedger>(kind, month) : fetchLedger<LedgerRecord[]>(kind, month);
    Promise.all([apiRequest<{ role: string }>("/api/auth/me"), data, kind === "external" ? fetchGuestCards() : Promise.resolve([])]).then(async ([user, result, guestCards]) => {
      const availableDepartments = kind === "external" && user.role === "admin" ? await fetchAdminDepartments() : [];
      if (cancelled) return;
      setDepartments(availableDepartments);
      setCards(guestCards);
      setAdmin(user.role === "admin");
      if (kind === "annual") setAnnual(result as AnnualLedger);
      else if (kind === "department") setDepartment(result as DepartmentLedger);
      else setRecords(result as LedgerRecord[]);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "台账加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, month, year, refresh]);

  useEffect(() => {
    setServiceRange({start:"", end:""});
    setForm({ ...initialForm(), date: kind === "external" ? externalDate(month) : "" });
    setMessage("");
  }, [kind]);

  useEffect(() => {
    ledgerRevision.current += 1; setBusy(false);
    setClearanceStage("query"); setExternalStep("register"); setDetailTarget(null); setRechargeTarget(null);
    if (kind === "external") { setSearch(""); setCategory(""); }
  }, [kind, month]);

  useEffect(() => {
    if (!detailTarget) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = detailDialog.current;
    dialog?.querySelector<HTMLElement>("[tabindex='0']")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailTarget(null);
      if (event.key === "Tab") {
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>("[tabindex='0'], button") ?? []);
        const target = event.shiftKey && document.activeElement === controls[0] ? controls[controls.length - 1]
          : !event.shiftKey && document.activeElement === controls[controls.length - 1] ? controls[0] : null;
        if (target) { event.preventDefault(); target.focus(); }
      }
    };
    dialog?.addEventListener("keydown", onKey);
    return () => { dialog?.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [detailTarget]);

  const field = (key: keyof ReturnType<typeof initialForm>, label: string, type = "text", className?: string) => (
    <label className={className}>
      {label}
      <input
        type={type}
        step={type === "number" ? "0.01" : undefined}
        disabled={kind === "external" && !!form.guest_card_key && (key === "emp_no" || key === "card_no")}
        required={type === "date" || (kind === "external" && key === "dept_name")}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );

  const incompleteServiceRange = Boolean((serviceRange.start || serviceRange.end)
    && (!serviceRange.start || !serviceRange.end || serviceRange.end < serviceRange.start));

  function changeServiceRange(start: string, end: string) {
    setServiceRange({start, end});
    const valid = start && end && end >= start;
    const days = valid ? String(Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1) : "";
    setForm(f => ({...f, period:valid ? `${start} 至 ${end}` : "", days}));
  }

  async function operate(task: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function save() {
    if (kind === "external" && (!form.dept_name || incompleteServiceRange)) {
      setError(!form.dept_name ? "请选择承担费用的部门" : "请选择有效、完整的服务起止日期");
      return;
    }
    await operate(async () => {
      const body = { ...form, month, date: form.date || (kind === "annual" || kind === "department" ? `${month}-01` : "") };
      const signature = JSON.stringify(body);
      if (request.current.signature !== signature) request.current = { signature,
        key: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("") };
      await saveLedger(recordKind, { ...body, request_key: request.current.key });
      if (kind === "external") {
        setExternalStep(form.category === "card" && form.guest_card_key ? "recharge" : "ledger");
        setSearch(""); setCategory("");
      }
      if (kind === "clearance") setClearanceStage("ledger");
      request.current = { signature: "", key: "" };
      setServiceRange({start:"", end:""});
      setForm(kind === "external" ? { ...initialForm(), date: form.date, dept_name: form.dept_name, category: form.category, guest_card_key: form.guest_card_key, card_no: form.card_no, emp_no: form.emp_no } : initialForm()); setRefresh(n => n + 1); setMessage("记录已保存");
    });
  }

  const externalStage = admin ? externalStep : "ledger";
  const pendingRecharges = records.filter(record => record.guest_card_key && !record.voided && record.recharge_status !== "complete");
  const listedRecords = kind === "external" && externalStage === "recharge" ? pendingRecharges : records;
  function changeExternalStep(step: typeof externalStep) {
    setExternalStep(step); setSearch(""); setCategory("");
  }
  const visible = listedRecords.filter(r => (!search || `${r.emp_no}${r.name}${r.dept_name}${r.card_no}${kind === "external" ? r.unit : ""}`.includes(search)) && (!category || r.category === category));

  const validRecords = visible.filter(r => !r.voided);
  const voidedRecords = visible.filter(r => r.voided);
  const validTotalAmount = validRecords.reduce((sum, r) => sum + (kind === "external" ? actualAmount(r) : r.amount), 0);

  const showClearanceLedger = kind !== "clearance" || !admin || clearanceStage === "ledger";
  const ManualContainer = kind === "clearance" ? "details" : Fragment;

  return (
    <section className={`meal-ticket-page meal-ledger-page${kind === "external" ? " is-external" : ""}`}>
      <header className="meal-ticket-heading meal-ticket-header-combined meal-ticket-panel">
        <div className="meal-ticket-header-title-group">
          <h1>{titles[kind]}</h1>
          <div className="meal-ticket-header-period-capsule" role="group" aria-label="台账时间范围">
            {kind === "annual" ? <label className="meal-ledger-year-field">汇总年份
              <input type="number" min="1" max="9999" value={year} onChange={e => setYear(e.target.value)} />
            </label> : <div className="meal-ticket-month-picker-field">
              <span className="meal-ticket-month-picker-label">{kind === "department" ? "充值月份" : "业务月份"}</span>
              <MonthPicker ariaLabel={kind === "department" ? "充值月份" : "业务月份"} value={month}
                disabled={busy} format="YYYY-MM" className="meal-ticket-month-picker"
                onChange={value => { if (value !== month) { setMonth(value); setForm(f => ({...f, date: kind === "external" ? externalDate(value) : ""})); } }} />
            </div>}
          </div>
        </div>
      </header>
      <p className="meal-ledger-description">{descriptions[kind]}</p>

      {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
      {message && <p role="status" className="meal-ticket-alert" style={{ borderColor: "#059669", background: "rgba(5, 150, 105, 0.08)", color: "#047857" }}>{message}</p>}

      {loading ? (
        <LoadingState message="正在读取台账…" />
      ) : (
        <>
          {kind === "external" && <div className="meal-ticket-flow">
            <ol className="meal-ticket-workflow" aria-label="外来人员领用流程">
              {[
                {id:"register", title:"登记领用", text:"选择领用类别、客人卡和承担部门，填写本次金额。"},
                {id:"recharge", title:"核对充值", text:"在菜票软件实际充值后，查询并确认对应流水；纸质及手工领用跳过。"},
                {id:"ledger", title:"查看台账", text:"核对实际发放金额、承担部门和领用明细。"},
              ].map(step => <li key={step.id} className={externalStage === step.id ? "is-current" : ""}
                aria-current={externalStage === step.id ? "step" : undefined}>
                <div className="meal-ticket-step-heading"><span className="meal-ticket-step-number">{step.id === "register" ? 1 : step.id === "recharge" ? 2 : 3}</span><h2>{step.title}</h2></div>
                <p className="meal-ticket-step-description">{step.text}</p>
              </li>)}
            </ol>
            {admin && <div className="meal-ticket-actions" aria-label="领用步骤切换">
              {externalStage !== "register" && <button className="meal-ticket-button" disabled={busy} onClick={() => changeExternalStep("register")}>继续登记领用</button>}
              {externalStage !== "recharge" && pendingRecharges.length > 0 && <button className="meal-ticket-button" disabled={busy} onClick={() => changeExternalStep("recharge")}>查看待核对充值（{pendingRecharges.length} 条）</button>}
              {externalStage !== "ledger" && <button className="meal-ticket-button" disabled={busy} onClick={() => changeExternalStep("ledger")}>
                {externalStage === "recharge" ? pendingRecharges.length ? "稍后核对，查看台账" : "下一步：查看台账" : "查看已有台账"}
              </button>}
            </div>}
          </div>}
          {kind === "clearance" && admin && <MealClearanceImport key={month} month={month} stage={clearanceStage}
            onStageChange={setClearanceStage} busy={busy} onBusyChange={setBusy}
            onImported={async () => {
              const revision = ledgerRevision.current;
              const rows = await fetchLedger<LedgerRecord[]>("clearance", month);
              if (revision === ledgerRevision.current) setRecords(rows);
            }} />}
          {/* KPI 指标概览卡片 */}
          {kind === "department" && department && (
            <section className="meal-ledger-stats" aria-label="部门发放统计">
              <div className="meal-ledger-stat-card is-blue">
                <span className="meal-ledger-stat-label">部门数</span>
                <strong className="meal-ledger-stat-value">{department.items.length}<small>个</small></strong>
                <p className="meal-ledger-stat-sub">当前核算月份登记部门</p>
              </div>
              <div className="meal-ledger-stat-card is-blue">
                <span className="meal-ledger-stat-label">员工人数</span>
                <strong className="meal-ledger-stat-value">{department.items.reduce((s, r) => s + r.count, 0)}<small>人</small></strong>
                <p className="meal-ledger-stat-sub">不含客人领用记录</p>
              </div>
              <div className="meal-ledger-stat-card is-amber">
                <span className="meal-ledger-stat-label">员工应发合计</span>
                <strong className="meal-ledger-stat-value">¥{money(department.items.reduce((s, r) => s + r.due_amount, 0))}</strong>
                <p className="meal-ledger-stat-sub">应发金额总计</p>
              </div>
              <div className="meal-ledger-stat-card is-green">
                <span className="meal-ledger-stat-label">部门发放合计</span>
                <strong className="meal-ledger-stat-value">¥{money(department.items.reduce((s, r) => s + r.total_paid_amount, 0))}</strong>
                <p className="meal-ledger-stat-sub">员工净发放＋客人充卡＋纸质菜票</p>
              </div>
            </section>
          )}

          {kind === "annual" && annual && (
            <section className="meal-ledger-stats" aria-label="全年汇总统计">
              <div className="meal-ledger-stat-card is-blue">
                <span className="meal-ledger-stat-label">消费录入进度</span>
                <strong className="meal-ledger-stat-value">{annual.consumption_months}<small>/ 12 月</small></strong>
                <p className="meal-ledger-stat-sub">已录入消费月份数</p>
              </div>
              <div className="meal-ledger-stat-card is-green">
                <span className="meal-ledger-stat-label">全年充值总额</span>
                <strong className="meal-ledger-stat-value">¥{money(annual.totals.recharge_amount)}</strong>
                <p className="meal-ledger-stat-sub">含员工、管理与外来充卡</p>
              </div>
              <div className="meal-ledger-stat-card is-amber">
                <span className="meal-ledger-stat-label">全年消费总额</span>
                <strong className="meal-ledger-stat-value">¥{money(annual.totals.consumption_amount)}</strong>
                <p className="meal-ledger-stat-sub">二楼与三楼消费合计</p>
              </div>
              <div className="meal-ledger-stat-card is-rose">
                <span className="meal-ledger-stat-label">全年收回总额</span>
                <strong className="meal-ledger-stat-value">¥{money(annual.totals.recovered_amount)}</strong>
                <p className="meal-ledger-stat-sub">月末清零实际收回合计</p>
              </div>
            </section>
          )}

          {kind === "external" && (
            <>
              {externalStage === "ledger" && <section className="meal-ledger-stats meal-ledger-external-summary" aria-label="记录概览统计">
                <div className="meal-ledger-stat-card is-green">
                  <span className="meal-ledger-stat-label">发放总额合计</span>
                  <strong className="meal-ledger-stat-value">¥{money(validTotalAmount)}</strong>
                  <p className="meal-ledger-stat-sub">有效领用实际发放/到账总额</p>
                </div>
                <div className="meal-ledger-stat-card is-blue">
                  <span className="meal-ledger-stat-label">客人充卡发放</span>
                  <strong className="meal-ledger-stat-value">¥{money(validRecords.filter(r => r.category === "card").reduce((s, r) => s + actualAmount(r), 0))}</strong>
                  <p className="meal-ledger-stat-sub">固定客人卡已到账金额</p>
                </div>
                <div className="meal-ledger-stat-card is-amber">
                  <span className="meal-ledger-stat-label">纸质菜票发放</span>
                  <strong className="meal-ledger-stat-value">¥{money(validRecords.filter(r => r.category === "paper").reduce((s, r) => s + actualAmount(r), 0))}</strong>
                  <p className="meal-ledger-stat-sub">领用纸质菜票票面合计</p>
                </div>
                <div className="meal-ledger-stat-card">
                  <span className="meal-ledger-stat-label">记录概览</span>
                  <strong className="meal-ledger-stat-value">{validRecords.length}<small>条有效</small></strong>
                  <p className="meal-ledger-stat-sub">{voidedRecords.length > 0 ? `另有 ${voidedRecords.length} 条已作废记录` : "本月所有记录均正常有效"}</p>
                </div>
              </section>}
              {admin && externalStage === "register" && <div className="meal-ticket-panel meal-ledger-guest-manager">
                <GuestCardRegistry cards={cards} onChanged={async () => { setCards(await fetchGuestCards()); }} />
              </div>}
              {admin && externalStage === "register" && <div className="meal-ticket-panel meal-ledger-form-card meal-ledger-quick-entry">
                <div className="meal-ledger-card-header"><div>
                  <h2><span className="meal-external-section-icon"><LedgerBookIcon /></span>快速登记</h2>
                  <p>填写本次领用；客人卡保存后核对充值，纸质及手工领用保存后查看台账。</p>
                </div></div>
                <form onSubmit={e => { e.preventDefault(); void save(); }}>
                  <fieldset disabled={busy} className="meal-ledger-quick-fields">
                    <div className={`meal-ledger-grid meal-ledger-quick-grid meal-external-form-grid is-${form.category}`}>
                      {field("name", "姓名")}
                      {field("unit", "外来单位（部门）")}
                      <div className="meal-ledger-department-field">
                        <label htmlFor="meal-ledger-cost-department">承担费用的部门</label>
                        <DepartmentPicker departments={departments} value={form.dept_name} valueMode="name" required
                          inputId="meal-ledger-cost-department" placeholder="搜索或选择部门" title="选择承担费用的部门"
                          pickerTitle="选择承担费用的部门" modalClassName="department-picker-modal meal-external-department-modal" rootOptionLabel="未选择部门" quickEmptyValueLabel="未选择部门" selectedEmptyLabel="未选择部门"
                          onChange={dept_name => setForm(f => ({...f, dept_name}))} />
                      </div>
                      {field("date", "处理日期", "date")}
                      <label className="meal-external-field-narrow">类别<select value={form.category} onChange={e => setForm(f => ({...f, category:e.target.value, guest_card_key:"", card_no:"", emp_no:""}))}>
                        <option value="card">充卡</option><option value="paper">纸质</option>
                      </select></label>
                      {field("amount", form.guest_card_key ? "应充值金额" : "发放金额", "number", "meal-external-field-narrow")}
                      {form.category === "card" && <label>客人卡
                        <select value={form.guest_card_key} onChange={e => {
                          const card = cards.find(card => card.key === e.target.value);
                          setForm(f => ({...f, guest_card_key:card?.key || "", card_no:card?.card_no || "", emp_no:card?.emp_no || ""}));
                        }}><option value="">手工登记（不核对数据库）</option>
                          {cards.filter(card => card.is_active).map(card => <option key={card.key} value={card.key}>{card.name} · {card.card_no} · {card.emp_no}</option>)}
                        </select>
                      </label>}
                      <div className="meal-ledger-service-period">
                        <span>服务期间</span>
                        <div className="meal-ledger-period-inputs">
                          <label>开始日期<input aria-label="服务开始日期" type="date" value={serviceRange.start}
                            max={serviceRange.end || undefined} required={!!serviceRange.end}
                            onChange={e => changeServiceRange(e.target.value, serviceRange.end)} /></label>
                          <span aria-hidden="true">至</span>
                          <label>结束日期<input aria-label="服务结束日期" type="date" value={serviceRange.end}
                            min={serviceRange.start || undefined} required={!!serviceRange.start}
                            onChange={e => changeServiceRange(serviceRange.start, e.target.value)} /></label>
                        </div>
                        <small>包含首尾日期，天数可手动调整。</small>
                        {serviceRange.start && serviceRange.end && serviceRange.end < serviceRange.start && <small role="alert">结束日期不能早于开始日期</small>}
                      </div>
                      {field("days", "天数", "text", "meal-external-days-field")}
                    </div>
                    <details className="meal-ledger-extra-fields">
                      <summary><span>补充信息</span><small>卡号、人员编号、填表人、备注（选填）</small></summary>
                      <div className="meal-ledger-grid">
                        {field("card_no", "卡号")}{field("emp_no", "人员编号")}{field("registrar", "填表人")}
                        <div className="meal-ledger-grid-full">{field("remark", "备注")}</div>
                      </div>
                    </details>
                  </fieldset>
                  <div className="meal-ledger-form-footer">
                    <p>金额单位：元；纸质菜票填写票面总额。</p>
                    <button className="meal-ticket-button is-primary" disabled={busy || incompleteServiceRange}>保存记录</button>
                  </div>
                </form>
              </div>}
            </>
          )}

          {kind === "clearance" && showClearanceLedger && (
            <section className="meal-ledger-stats" aria-label="记录概览统计">
              <div className="meal-ledger-stat-card is-green">
                <span className="meal-ledger-stat-label">有效清零总额</span>
                <strong className="meal-ledger-stat-value">¥{money(validTotalAmount)}</strong>
                <p className="meal-ledger-stat-sub">月末实际清零取款金额</p>
              </div>
              <div className="meal-ledger-stat-card is-blue">
                <span className="meal-ledger-stat-label">有效记录数</span>
                <strong className="meal-ledger-stat-value">{validRecords.length}<small>条</small></strong>
                <p className="meal-ledger-stat-sub">正常入账记录</p>
              </div>
              {voidedRecords.length > 0 && (
                <div className="meal-ledger-stat-card is-rose">
                  <span className="meal-ledger-stat-label">已作废记录</span>
                  <strong className="meal-ledger-stat-value">{voidedRecords.length}<small>条</small></strong>
                  <p className="meal-ledger-stat-sub">保留作废审计历史</p>
                </div>
              )}
            </section>
          )}

          {/* 表格数据展示区域 */}
          {showClearanceLedger && (kind !== "external" || externalStage !== "register") && <div className={`meal-ticket-panel meal-ledger-list is-${kind}`}>
            {kind === "department" && department && (
              <>
                <div className="meal-ticket-section-heading">
                  <div>
                    <h2>部门发放汇总列表</h2>
                    <p>{department.status === "draft" ? "员工核算为草稿；客人金额取已登记有效领用" : department.status === "no_batch" ? "本月没有员工核算；客人有效领用仍计入部门统计" : "员工核算已确认；客人金额取已登记有效领用"}</p>
                  </div>
                  <span className={`meal-ledger-status-tag ${department.status === "draft" ? "is-draft" : "is-active"}`}>
                    {department.status === "draft" ? "草稿" : department.status === "no_batch" ? "未建立批次" : "已确认"}
                  </span>
                </div>
                <QueryTable
                  headers={["部门", "员工人数", "员工应发合计", "员工净实际发放", "客人卡充值", "客人纸质菜票", "部门发放合计", "登记人", "备注", "历史原账金额"]}
                  rows={department.items.map(r => [
                    r.dept_name,
                    r.count,
                    money(r.due_amount),
                    money(r.paid_amount),
                    money(r.external_card_amount),
                    money(r.external_paper_amount),
                    money(r.total_paid_amount),
                    r.registrar || "—",
                    r.remark || "—",
                    r.historical_amount == null ? "—" : money(r.historical_amount)
                  ])}
                />
              </>
            )}

            {kind === "annual" && annual && (
              <>
                <div className="meal-ticket-section-heading">
                  <div>
                    <h2>全年按月汇总</h2>
                    <p>消费已录入 {annual.consumption_months}/12 月 · 全年充值 {money(annual.totals.recharge_amount)} 元 · 收回 {money(annual.totals.recovered_amount)} 元</p>
                  </div>
                </div>
                <QueryTable
                  headers={["月份", "员工/管理人员充值", "外来充卡", "充值合计", "纸质领用", "二楼消费", "三楼消费", "消费合计", "收回金额", "历史充值原额", "历史收回原额"]}
                  rows={annual.months.map(r => [
                    r.month,
                    money(r.employee_amount),
                    money(r.external_card_amount),
                    money(r.recharge_amount),
                    money(r.paper_amount),
                    money(r.floor2_amount),
                    money(r.floor3_amount),
                    money(r.consumption_amount),
                    money(r.recovered_amount),
                    r.historical_recharge_amount == null ? "—" : money(r.historical_recharge_amount),
                    r.historical_recovered_amount == null ? "—" : money(r.historical_recovered_amount)
                  ])}
                />
              </>
            )}

            {(kind === "external" || kind === "clearance") && (
              <>
                <div className="meal-ticket-section-heading">
                  <div>
                    <h2>{kind === "external" ? externalStage === "recharge" ? "待核对充值" : "领用明细列表" : "取款记录列表"}</h2>
                    <p>当前筛选有效金额 {money(validTotalAmount)} 元 · {visible.length} 条（包含作废历史）</p>
                  </div>
                </div>
                <div className="meal-ticket-toolbar meal-ticket-filters meal-ledger-filters">
                  <label className="meal-ledger-search">搜索记录<input placeholder={kind === "external" ? "姓名、单位、部门或卡号" : "工号、姓名、部门或卡号"} value={search} onChange={e => setSearch(e.target.value)} /></label>
                  {kind === "external" && <label>领用类别<select value={category} onChange={e => setCategory(e.target.value)}>
                    <option value="">全部类别</option><option value="card">充卡</option><option value="paper">纸质</option>
                  </select></label>}
                </div>
                {kind === "external" ? <QueryTable
                  headers={["日期", "领用人 / 单位", "承担部门", "类别", "金额（元）", {label:"操作", sortable:false}]}
                  sortRows={visible.map(r => [r.date, r.name || r.unit, r.dept_name, r.category === "card" ? "充卡" : "纸质", r.amount, null])}
                  rows={visible.map(r => [
                    r.date,
                    <div className="meal-ledger-recipient"><strong>{r.name || r.unit || "—"}</strong>
                      {r.name && r.unit && <small>{r.unit}</small>}
                      {r.voided && <span className="meal-ledger-status-tag is-voided">已作废</span>}
                    </div>,
                    r.dept_name,
                    <span className={`meal-ledger-status-tag ${r.category === "card" ? "is-info" : "is-draft"}`}>{r.category === "card" ? "充卡" : "纸质"}</span>,
                    <div className="meal-ledger-recipient meal-external-amount"><strong>{money(r.amount)}</strong>
                      {r.guest_card_key && <><small>已到账 {money(actualAmount(r))}</small><span className={`meal-external-state is-${r.recharge_status ?? "pending"}`}>{rechargeLabel[r.recharge_status ?? "pending"]}</span></>}
                    </div>,
                    <div className="meal-ledger-row-actions">
                      <button className="meal-ticket-button meal-external-text-button" onClick={() => setDetailTarget(r)}>详情</button>
                      {admin && r.guest_card_key && !r.voided && <button className="meal-ticket-button meal-external-check-button" disabled={busy} onClick={() => setRechargeTarget(r)}>核对充值</button>}
                      {admin && !r.voided && <button className="meal-ticket-button meal-external-text-button is-danger-text" disabled={busy} onClick={() => { setVoidTarget(r); setVoidReason(""); }}>作废</button>}
                    </div>
                  ])}
                /> : <QueryTable
                  headers={[
                    "日期", "工号", "姓名", "部门",
                    "卡号", "金额", "备注", "状态", "操作"
                  ]}
                  rows={visible.map(r => [
                    r.date,
                    r.emp_no,
                    r.name,
                    r.dept_name,
                    r.card_no,
                    money(r.amount),
                    r.remark || "—",
                    r.voided ? <span className="meal-ledger-status-tag is-voided">已作废：{r.void_reason}</span> : <span className="meal-ledger-status-tag is-active">有效</span>,
                    admin && !r.voided ? (
                      <button className="meal-ticket-button" disabled={busy} onClick={() => { setVoidTarget(r); setVoidReason(""); }}>
                        作废
                      </button>
                    ) : "—"
                  ])}
                />}
              </>
            )}
          </div>}

          {/* 管理员登记表单 */}
          {admin && kind !== "department" && kind !== "external" && (
            <ManualContainer>
            {kind === "clearance" && <summary className="meal-ticket-button">手工补充登记</summary>}
            <div className="meal-ticket-panel meal-ledger-form-card">
              <div className="meal-ledger-card-header">
                <div>
                  <h2>
                    <LedgerBookIcon />
                    {kind === "annual" ? "录入月度消费" : "登记月末取款"}
                  </h2>
                  <p>已保存记录保留历史。月度消费再次保存时，会替代本月有效登记并保留旧版本。</p>
                </div>
              </div>
              <form onSubmit={e => { e.preventDefault(); void save(); }}>
                {kind !== "annual" && <fieldset className="meal-ledger-fieldset">
                  <legend>人员信息</legend>
                  <div className="meal-ledger-grid">
                    {field("name", "姓名")}{field("emp_no", "人员编号")}
                    {field("dept_name", "部门")}
                    {field("card_no", "卡号")}
                  </div>
                </fieldset>}
                <fieldset className="meal-ledger-fieldset">
                  <legend>{kind === "annual" ? "月度消费" : kind === "clearance" ? "取款信息" : "领用信息"}</legend>
                  <div className="meal-ledger-grid">
                    {kind === "annual" ? <>
                      <div className="meal-ticket-month-picker-field meal-ledger-consumption-month">
                        <span className="meal-ticket-month-picker-label">消费录入月份</span>
                        <MonthPicker ariaLabel="消费录入月份" value={month} disabled={busy} format="YYYY-MM"
                          onChange={setMonth} />
                      </div>
                      {field("floor2", "二楼消费金额", "number")}{field("floor3", "三楼消费金额", "number")}
                    </> : <>
                      {field("date", "处理日期", "date")}
                      {field("amount", kind === "clearance" ? "清零取款金额" : "发放金额", "number")}
                    </>}
                  </div>
                </fieldset>
                <fieldset className="meal-ledger-fieldset">
                  <legend>补充说明</legend><div className="meal-ledger-grid">{field("remark", "备注")}</div>
                </fieldset>
                <div className="meal-ledger-form-footer">
                  <p>请核实填写的数据信息，确认无误后点击保存。</p>
                  <button className="meal-ticket-button is-primary" disabled={busy || loading}>
                    保存记录
                  </button>
                </div>
              </form>
            </div>
            </ManualContainer>
          )}
        </>
      )}

      {detailTarget && <div className="meal-ticket-modal">
        <section ref={detailDialog} className="meal-ledger-detail-dialog meal-external-dialog" role="dialog" aria-modal="true" aria-label="领用记录详情">
          <header className="meal-external-dialog-header"><div><h2>领用记录详情</h2><p>{detailTarget.name || detailTarget.unit} · {detailTarget.date}</p></div><span className={`meal-external-state is-${detailTarget.voided ? "voided" : "complete"}`}>{detailTarget.voided ? "已作废" : "有效记录"}</span></header>
          <div className="meal-external-dialog-body" role="region" aria-label="领用记录内容" tabIndex={0}>
          <dl className="meal-ledger-detail-grid">
            {[
              ["日期", detailTarget.date], ["姓名", detailTarget.name], ["外来单位（部门）", detailTarget.unit],
              ["承担费用的部门", detailTarget.dept_name], ["类别", detailTarget.category === "card" ? "充卡" : "纸质"],
              [detailTarget.guest_card_key ? "应充值金额（元）" : "发放金额（元）", money(detailTarget.amount)], ["人员编号", detailTarget.emp_no], ["卡号", detailTarget.card_no],
              ["服务期间", detailTarget.period], ["天数", detailTarget.days], ["填表人", detailTarget.registrar],
              ["操作人", detailTarget.operator], ["备注", detailTarget.remark],
              ...(detailTarget.guest_card_key ? [["已到账金额（元）", money(actualAmount(detailTarget))], ["充值状态", rechargeLabel[detailTarget.recharge_status ?? "pending"]]] : []),
              ["状态", detailTarget.voided ? "已作废" : "有效"],
              ...(detailTarget.voided ? [["作废原因", detailTarget.void_reason]] : [])
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
          </dl>
          {!!detailTarget.recharges?.length && <section className="meal-ledger-recharge-evidence" aria-label="已匹配充值流水">
            <h3>已匹配充值流水</h3>
            <ul>{detailTarget.recharges.map(row => <li key={row.source_key}>
              <span>{row.date.replace("T", " ")} · {money(row.amount)} 元</span><small>{row.source_key}</small>
            </li>)}</ul>
          </section>}
          </div>
          <footer className="meal-external-dialog-footer"><button className="meal-ticket-button" onClick={() => setDetailTarget(null)}>关闭</button></footer>
        </section>
      </div>}

      {rechargeTarget && <GuestRechargeDialog record={rechargeTarget} onClose={() => setRechargeTarget(null)}
        onUpdated={record => { setRecords(rows => rows.map(row => row.id === record.id ? record : row)); }} />}

      {/* 作废确认弹窗 */}
      {voidTarget && (
        <div className="meal-ticket-modal">
          <section className={`meal-ledger-void-dialog${kind === "external" ? " meal-external-void-dialog" : ""}`} role="dialog" aria-modal="true" aria-label="作废台账记录">
            <div className="meal-ledger-void-header">
              <AlertTriangleIcon />
              <h2>作废 {voidTarget.name} 的记录</h2>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              void operate(async () => {
                await voidLedger(voidTarget.id, voidReason);
                setVoidTarget(null);
                setRefresh(n => n + 1);
              });
            }}>
              <div className={kind === "external" ? "meal-external-void-body" : undefined}>
                {kind === "external" && <p className="meal-external-void-hint">请核对本次领用并填写作废原因，原记录和充值依据会保留。</p>}
                <div className="meal-ledger-void-details">
                  <div>人员：<strong>{voidTarget.name} ({voidTarget.emp_no})</strong> · 部门：<strong>{voidTarget.dept_name}</strong></div>
                  <div>金额：<strong>¥{money(voidTarget.amount)}</strong> · 卡号：<strong>{voidTarget.card_no}</strong> · 日期：<strong>{voidTarget.date}</strong></div>
                </div>
                <label>
                  作废原因
                  <input
                    required
                    placeholder="请输入作废原因（例如：误登重复记录）"
                    value={voidReason}
                    onChange={e => setVoidReason(e.target.value)}
                  />
                </label>
              </div>
              <div className="meal-ticket-actions" style={{ marginTop: "16px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="meal-ticket-button"
                  disabled={busy}
                  onClick={() => setVoidTarget(null)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="meal-ticket-button is-danger"
                  disabled={busy || !voidReason.trim()}
                >
                  确认作废
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
