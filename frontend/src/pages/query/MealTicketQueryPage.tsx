import { useEffect, useRef, useState } from "react";
import { fetchMealQueryOptions, queryMealTickets, type MealBatch, type MealItem, type MealQueryOptions } from "../../api/mealTickets";
import { businessMonth, money } from "../../api/mealLedgers";
import QueryTable from "../../components/query/QueryTable";
import EmployeePicker from "../../components/query/EmployeePicker";
import DepartmentMultiPicker from "../../components/query/DepartmentMultiPicker";
import LoadingState from "../../components/feedback/LoadingState";
import { SearchIcon } from "../../components/icons";
import "../meal-ticket.css";
import "../meal-ledger.css";

export default function MealTicketQueryPage() {
  const [month, setMonth] = useState(businessMonth);
  const [batch, setBatch] = useState<MealBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [optionsBusy, setOptionsBusy] = useState(true);
  const [options, setOptions] = useState<MealQueryOptions | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const queryVersion = useRef(0);
  const [error, setError] = useState("");
  const [employeeIds, setEmployeeIds] = useState<number[]>([]);
  const [departmentNames, setDepartmentNames] = useState<string[]>([]);
  const [personType, setPersonType] = useState("");
  const [state, setState] = useState("");
  const [detail, setDetail] = useState<MealItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    resetResults();
    setOptions(null); setOptionsBusy(true); setEmployeeIds([]); setDepartmentNames([]);
    if (!month) {
      setOptionsBusy(false);
      return;
    }
    fetchMealQueryOptions(month).then(data => { if (!cancelled) setOptions(data); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "选择器选项加载失败"); })
      .finally(() => { if (!cancelled) setOptionsBusy(false); });
    return () => { cancelled = true; queryVersion.current += 1; };
  }, [month]);

  function resetResults() {
    queryVersion.current += 1;
    setBusy(false); setError(""); setBatch(null); setDetail(null); setHasQueried(false);
  }

  async function handleQuery() {
    const version = ++queryVersion.current;
    setBusy(true); setError(""); setBatch(null); setDetail(null); setHasQueried(false);
    try {
      const data = await queryMealTickets(month, { employeeIds, departmentNames, personType, state });
      if (version !== queryVersion.current) return;
      setBatch(data); setHasQueried(true);
    } catch (e) {
      if (version === queryVersion.current) setError(e instanceof Error ? e.message : "查询失败");
    } finally {
      if (version === queryVersion.current) setBusy(false);
    }
  }

  const pickerDepartments = options?.departments ?? [];
  const rows = batch?.items ?? [];

  const totalDue = rows.reduce((s, r) => s + r.due_amount, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid_amount, 0);
  const totalDiff = rows.reduce((s, r) => s + r.difference, 0);

  return (
    <section className="meal-ticket-page meal-ledger-page">
      <header className="meal-ticket-heading">
        <div>
          <p className="meal-ticket-eyebrow"><SearchIcon /> 查询中心 · 菜票数据</p>
          <h1>菜票查询</h1>
          <p>独立查看菜票核算、补扣与实际发放。月底余额清零单独记账，不改变发放结清状态。</p>
        </div>
      </header>

      {/* 筛选工具栏 */}
      <div className="meal-ticket-panel meal-ledger-filter-panel">
        <div className="meal-ledger-form">
          <label>充值月份<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
          <div className="meal-ticket-picker-field">
            <span>搜索人员</span>
            <EmployeePicker departments={pickerDepartments} employees={options?.employees ?? []} selectedIds={employeeIds}
              onChange={ids => { setEmployeeIds(ids); resetResults(); }} label="搜索人员" showFieldChrome={false} emptyHint="未选择时查询本月全部人员。" />
          </div>
          <div className="meal-ticket-picker-field">
            <span>核算部门</span>
            <DepartmentMultiPicker departments={pickerDepartments}
              selectedIds={pickerDepartments.filter(dept => departmentNames.includes(dept.dept_name)).map(dept => dept.id)}
              onChange={ids => { setDepartmentNames(pickerDepartments.filter(dept => ids.includes(dept.id)).map(dept => dept.dept_name)); resetResults(); }}
              label="核算部门" showFieldChrome={false} />
          </div>
          <label>
            人员类型
            <select value={personType} onChange={e => { setPersonType(e.target.value); resetResults(); }}>
              <option value="">全部人员</option>
              <option value="employee">员工</option>
              <option value="manager">管理人员</option>
            </select>
          </label>
          <label>
            核对状态
            <select value={state} onChange={e => { setState(e.target.value); resetResults(); }}>
              <option value="">全部状态</option>
              <option value="settled">结清</option>
              <option value="unpaid">待发放</option>
              <option value="refund">待扣回</option>
              <option value="error">待核对</option>
            </select>
          </label>
          <button className="meal-ticket-button is-primary" type="button" disabled={optionsBusy || !options || busy || !month} onClick={handleQuery}>
            {busy ? "查询中…" : "查询"}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="meal-ticket-alert is-error">{error}</p>}

      {busy || optionsBusy ? (
        <LoadingState message={optionsBusy ? "正在加载人员与部门选项…" : "正在读取菜票账目…"} />
      ) : !hasQueried ? (
        <div className="meal-ticket-empty meal-ticket-panel">
          <h2>请选择条件后点击查询</h2>
          <p>按充值月份、人员和核算部门查询菜票数据；不选人员和部门时查询本月全部可见人员。</p>
        </div>
      ) : batch ? (
        <>
          {/* KPI 指标卡片 */}
          <section className="meal-ledger-stats" aria-label="菜票汇总统计">
            <div className="meal-ledger-stat-card is-blue">
              <span className="meal-ledger-stat-label">筛选人数</span>
              <strong className="meal-ledger-stat-value">{rows.length}<small>人</small></strong>
              <p className="meal-ledger-stat-sub">当前筛选范围内人员</p>
            </div>
            <div className="meal-ledger-stat-card is-blue">
              <span className="meal-ledger-stat-label">应发合计</span>
              <strong className="meal-ledger-stat-value">¥{money(totalDue)}</strong>
              <p className="meal-ledger-stat-sub">应发金额总和</p>
            </div>
            <div className="meal-ledger-stat-card is-green">
              <span className="meal-ledger-stat-label">净已发合计</span>
              <strong className="meal-ledger-stat-value">¥{money(totalPaid)}</strong>
              <p className="meal-ledger-stat-sub">实际已充值扣除退回</p>
            </div>
            <div className={`meal-ledger-stat-card ${totalDiff === 0 ? "is-green" : "is-amber"}`}>
              <span className="meal-ledger-stat-label">差额合计</span>
              <strong className="meal-ledger-stat-value">¥{money(totalDiff)}</strong>
              <p className="meal-ledger-stat-sub">{totalDiff === 0 ? "账目已平衡结清" : "待处理差额"}</p>
            </div>
          </section>

          <div className="meal-ticket-panel">
            <div className="meal-ticket-section-heading">
              <div>
                <h2>菜票人员明细</h2>
                <p>考勤月份 {batch.month} · 充值月份 {batch.recharge_month} · {batch.status === "draft" ? "草稿" : "已确认"} · 当前范围 {rows.length} 人</p>
                <p style={{ marginTop: "4px" }}>应发 {money(totalDue)} 元 · 净已发 {money(totalPaid)} 元</p>
              </div>
              <span className="meal-ticket-count">{rows.length} 人</span>
            </div>

            <QueryTable
              headers={["工号", "姓名", "核算部门", "人员类型", "实际打卡天数", "基础金额", "额外补扣", "应发", "净已发", "差额", "核对说明", "明细"]}
              rows={rows.map(i => [
                i.emp_no,
                i.name,
                i.dept_name,
                i.is_manager ? "管理人员" : "员工",
                i.days,
                money(i.base_amount),
                money(i.adjustment_amount),
                money(i.due_amount),
                money(i.paid_amount),
                money(i.difference),
                i.excluded ? `本月不发：${i.participation_history?.slice(-1)[0]?.reason ?? ""}` : i.error || (i.difference === 0 ? "结清" : i.difference > 0 ? "待发放" : "待扣回"),
                <button className="meal-ticket-button is-link" onClick={() => setDetail(i)}>
                  查看明细
                </button>
              ])}
            />
          </div>
        </>
      ) : (
        <div className="meal-ticket-empty meal-ticket-panel">
          <h2>本充值月份没有核算数据</h2>
          <p>当前月份暂未建立菜票核算批次，请核对充值月份或前往菜票中心生成核算。</p>
        </div>
      )}

      {/* 明细模态框 */}
      {detail && (
        <div className="meal-ticket-modal">
          <section className="meal-ticket-operation-dialog" role="dialog" aria-modal="true" aria-label="菜票查询明细">
            <header className="meal-ticket-operation-heading">
              <span className="meal-ticket-operation-eyebrow">菜票明细详情</span>
              <h2>{detail.emp_no} {detail.name}</h2>
              <p>实际打卡天数 {detail.days} · 应发 {money(detail.due_amount)} · 净已发 {money(detail.paid_amount)}</p>
            </header>

            {Boolean(detail.participation_history?.length) && (
              <div style={{ marginBottom: "16px" }}>
                <h3 style={{ margin: "0 0 8px", fontSize: "14px" }}>核算处理历史</h3>
                {detail.participation_history.map((r, i) => (
                  <p key={i} style={{ margin: "4px 0" }}>{r.created_at} · {r.excluded ? "本月不发" : "恢复核算"} · {r.reason}</p>
                ))}
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "14px" }}>补扣记录</h3>
              {detail.adjustments.length ? detail.adjustments.map(a => (
                <p key={a.id} style={{ margin: "4px 0" }}>{a.created_at} · {money(a.amount)} 元 · {a.reason}</p>
              )) : <p style={{ margin: "4px 0" }}>无补扣记录</p>}
            </div>

            <div style={{ marginBottom: "16px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "14px" }}>实际发放</h3>
              {detail.payments.length ? detail.payments.map(p => (
                <p key={p.id} style={{ margin: "4px 0" }}>{p.date} · {money(p.amount)} 元 · {p.reference}{p.reversed ? "（已冲正）" : ""}</p>
              )) : <p style={{ margin: "4px 0" }}>无实际发放记录</p>}
            </div>

            <div style={{ marginBottom: "16px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "14px" }}>月末清零记录</h3>
              {detail.clearances?.length ? detail.clearances.map((r, i) => (
                <p key={i} style={{ margin: "4px 0" }}>{r.date} · {money(r.amount)} 元 · {r.remark}{r.voided ? "（已作废）" : ""}</p>
              )) : <p style={{ margin: "4px 0" }}>无月末清零记录</p>}
            </div>

            <p style={{ margin: "12px 0", color: "var(--ent-text-tertiary)", fontSize: "12px" }}>
              {detail.source?.remark || "按核算时的最终打卡字段取值"}
            </p>

            <div className="meal-ticket-actions" style={{ justifyContent: "flex-end", marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--ent-border-strong)" }}>
              <button className="meal-ticket-button" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
