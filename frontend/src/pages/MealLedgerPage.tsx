import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { businessMonth, fetchAnnual, fetchLedger, money, saveLedger, voidLedger,
  type AnnualLedger, type DepartmentLedger, type LedgerKind, type LedgerRecord } from "../api/mealLedgers";
import QueryTable from "../components/query/QueryTable";
import LoadingState from "../components/feedback/LoadingState";
import { LedgerBookIcon, AlertTriangleIcon } from "../components/icons";
import "./meal-ticket.css";
import "./meal-ledger.css";

type View = "department" | "external" | "clearance" | "annual";

const titles = {
  department: "部门菜票发放汇总",
  external: "外来人员领用",
  clearance: "月末取款记录",
  annual: "全年菜票汇总",
};

const descriptions = {
  department: "部门发放合计包含员工净实际发放、客人卡充值和纸质菜票，外来领用自动计入承担费用的部门。",
  external: "完成客人卡充值或发放纸质菜票后登记，按实际发放月份计入承担费用的部门；纸质金额填写票面总额。",
  clearance: "在菜票软件完成余额清零后登记，卡余额即当次取款金额，不影响菜票发放结清。",
  annual: "按实际业务月份汇总。纸质领用单列，收回取实际清零记录，消费未录入保持空值。",
};

const initialForm = () => ({
  name: "", emp_no: "", dept_name: "", card_no: "", amount: "", category: "card",
  unit: "", period: "", days: "", registrar: "", remark: "", floor2: "", floor3: "", date: ""
});

export default function MealLedgerPage({ kind }: { kind: View }) {
  const recordKind: LedgerKind = kind === "annual" ? "consumption" : kind;
  const [month, setMonth] = useState(businessMonth);
  const [year, setYear] = useState(String(new Date().getFullYear()));
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
  const [voidReason, setVoidReason] = useState("");
  const request = useRef({ signature: "", key: "" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setDepartment(null); setAnnual(null); setRecords([]);
    const data = kind === "annual" ? fetchAnnual(year) : kind === "department" ? fetchLedger<DepartmentLedger>(kind, month) : fetchLedger<LedgerRecord[]>(kind, month);
    Promise.all([apiRequest<{ role: string }>("/api/auth/me"), data]).then(([user, result]) => {
      if (cancelled) return;
      setAdmin(user.role === "admin");
      if (kind === "annual") setAnnual(result as AnnualLedger);
      else if (kind === "department") setDepartment(result as DepartmentLedger);
      else setRecords(result as LedgerRecord[]);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "台账加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, month, year, refresh]);

  useEffect(() => { setForm(initialForm()); setMessage(""); }, [kind]);

  const field = (key: keyof ReturnType<typeof initialForm>, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        step={type === "number" ? "0.01" : undefined}
        required={type === "date" || (kind === "external" && key === "dept_name")}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );

  async function operate(task: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function save() {
    await operate(async () => {
      const body = { ...form, month, date: form.date || (kind === "annual" || kind === "department" ? `${month}-01` : "") };
      const signature = JSON.stringify(body);
      if (request.current.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
      await saveLedger(recordKind, { ...body, request_key: request.current.key });
      request.current = { signature: "", key: "" };
      setForm(initialForm()); setRefresh(n => n + 1); setMessage("记录已保存");
    });
  }

  const visible = records.filter(r => (!search || `${r.emp_no}${r.name}${r.dept_name}${r.card_no}`.includes(search)) && (!category || r.category === category));

  const validRecords = visible.filter(r => !r.voided);
  const voidedRecords = visible.filter(r => r.voided);
  const validTotalAmount = validRecords.reduce((sum, r) => sum + r.amount, 0);

  return (
    <section className="meal-ticket-page meal-ledger-page">
      <header className="meal-ticket-heading">
        <div>
          <p className="meal-ticket-eyebrow">菜票中心 · 台账登记</p>
          <h1>{titles[kind]}</h1>
          <p>{descriptions[kind]}</p>
        </div>
      </header>

      {/* 检索与时间工具栏 */}
      <div className="meal-ticket-panel meal-ledger-filter-panel">
        <div className="meal-ledger-form">
          {kind === "annual" && (
            <label>
              汇总年份
              <input type="number" min="1" max="9999" value={year} onChange={e => setYear(e.target.value)} />
            </label>
          )}
          <label>
            {kind === "department" ? "充值月份" : kind === "annual" ? "消费录入月份" : "业务月份"}
            <input type="month" value={month} onChange={e => { setMonth(e.target.value); setForm(f => ({ ...f, date: "" })); }} />
          </label>
          {(kind === "external" || kind === "clearance") && (
            <label>
              搜索记录
              <input placeholder="工号、姓名、部门或卡号" value={search} onChange={e => setSearch(e.target.value)} />
            </label>
          )}
          {kind === "external" && (
            <label>
              领用类别
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">全部类别</option>
                <option value="card">充卡</option>
                <option value="paper">纸质</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}
      {message && <p role="status" className="meal-ticket-alert" style={{ borderColor: "#059669", background: "rgba(5, 150, 105, 0.08)", color: "#047857" }}>{message}</p>}

      {loading ? (
        <LoadingState message="正在读取台账…" />
      ) : (
        <>
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

          {(kind === "external" || kind === "clearance") && (
            <section className="meal-ledger-stats" aria-label="记录概览统计">
              <div className="meal-ledger-stat-card is-green">
                <span className="meal-ledger-stat-label">{kind === "clearance" ? "有效清零总额" : "有效发放总额"}</span>
                <strong className="meal-ledger-stat-value">¥{money(validTotalAmount)}</strong>
                <p className="meal-ledger-stat-sub">{kind === "clearance" ? "月末实际清零取款金额" : "有效登记总金额"}</p>
              </div>
              <div className="meal-ledger-stat-card is-blue">
                <span className="meal-ledger-stat-label">有效记录数</span>
                <strong className="meal-ledger-stat-value">{validRecords.length}<small>条</small></strong>
                <p className="meal-ledger-stat-sub">正常入账记录</p>
              </div>
              {kind === "external" && (
                <>
                  <div className="meal-ledger-stat-card is-blue">
                    <span className="meal-ledger-stat-label">充卡金额</span>
                    <strong className="meal-ledger-stat-value">¥{money(validRecords.filter(r => r.category === "card").reduce((s, r) => s + r.amount, 0))}</strong>
                    <p className="meal-ledger-stat-sub">充卡领用记录</p>
                  </div>
                  <div className="meal-ledger-stat-card is-amber">
                    <span className="meal-ledger-stat-label">纸质领用金额</span>
                    <strong className="meal-ledger-stat-value">¥{money(validRecords.filter(r => r.category === "paper").reduce((s, r) => s + r.amount, 0))}</strong>
                    <p className="meal-ledger-stat-sub">纸质票据发放</p>
                  </div>
                </>
              )}
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
          <div className="meal-ticket-panel">
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
                    <h2>{kind === "external" ? "领用明细列表" : "取款记录列表"}</h2>
                    <p>有效金额 {money(validTotalAmount)} 元 · {visible.length} 条（包含作废历史）</p>
                  </div>
                </div>
                <QueryTable
                  headers={[
                    "日期", "工号", "姓名", "部门",
                    ...(kind === "external" ? ["类别", "外来单位", "期间", "天数"] : []),
                    "卡号", "金额", "备注", "状态", "操作"
                  ]}
                  rows={visible.map(r => [
                    r.date,
                    r.emp_no,
                    r.name,
                    r.dept_name,
                    ...(kind === "external" ? [r.category === "card" ? "充卡" : "纸质", r.unit || "—", r.period || "—", r.days || "—"] : []),
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
                />
              </>
            )}
          </div>

          {/* 管理员登记表单 */}
          {admin && kind !== "department" && (
            <div className="meal-ticket-panel meal-ledger-form-card">
              <div className="meal-ledger-card-header">
                <div>
                  <h2>
                    <LedgerBookIcon />
                    {kind === "annual" ? "录入月度消费" : "登记记录"}
                  </h2>
                  <p>已保存记录保留历史。月度消费再次保存时，会替代本月有效登记并保留旧版本。</p>
                </div>
              </div>
              <form onSubmit={e => { e.preventDefault(); void save(); }}>
                <div className="meal-ledger-grid">
                  {(kind === "external" || kind === "clearance") && (
                    <>
                      {field("name", "姓名")}
                      {field("emp_no", "人员编号")}
                      {field("date", "处理日期", "date")}
                      {field("card_no", "卡号")}
                      {field("amount", kind === "clearance" ? "清零取款金额" : "发放金额", "number")}
                    </>
                  )}
                  {kind !== "annual" && field("dept_name", kind === "external" ? "承担费用的部门" : "部门")}
                  {kind === "external" && (
                    <>
                      <label>
                        类别
                        <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                          <option value="card">充卡</option>
                          <option value="paper">纸质</option>
                        </select>
                      </label>
                      {field("unit", "外来单位/人员")}
                      {field("period", "服务期间")}
                      {field("days", "天数")}
                    </>
                  )}
                  {kind === "external" && field("registrar", "填表人")}
                  {kind === "annual" && (
                    <>
                      {field("floor2", "二楼消费金额", "number")}
                      {field("floor3", "三楼消费金额", "number")}
                    </>
                  )}
                  {field("remark", "备注")}
                </div>
                <div className="meal-ledger-form-footer">
                  <p>请核实填写的数据信息，确认无误后点击保存。</p>
                  <button className="meal-ticket-button is-primary" disabled={busy || loading}>
                    保存记录
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}

      {/* 作废确认弹窗 */}
      {voidTarget && (
        <div className="meal-ticket-modal">
          <section className="meal-ledger-void-dialog" role="dialog" aria-modal="true" aria-label="作废台账记录">
            <div className="meal-ledger-void-header">
              <AlertTriangleIcon />
              <h2>作废 {voidTarget.name} 的记录</h2>
            </div>
            <div className="meal-ledger-void-details">
              <div>人员：<strong>{voidTarget.name} ({voidTarget.emp_no})</strong> · 部门：<strong>{voidTarget.dept_name}</strong></div>
              <div>金额：<strong>¥{money(voidTarget.amount)}</strong> · 卡号：<strong>{voidTarget.card_no}</strong> · 日期：<strong>{voidTarget.date}</strong></div>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              void operate(async () => {
                await voidLedger(voidTarget.id, voidReason);
                setVoidTarget(null);
                setRefresh(n => n + 1);
              });
            }}>
              <label>
                作废原因
                <input
                  required
                  placeholder="请输入作废原因（例如：误登重复记录）"
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                />
              </label>
              <div className="meal-ticket-actions" style={{ marginTop: "16px", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  className="meal-ticket-button is-danger"
                  disabled={busy || !voidReason.trim()}
                >
                  确认作废
                </button>
                <button
                  type="button"
                  className="meal-ticket-button"
                  disabled={busy}
                  onClick={() => setVoidTarget(null)}
                >
                  取消
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
