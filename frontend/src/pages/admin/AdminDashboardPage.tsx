import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import {
  activateAccountSet,
  calculateAccountSet,
  createAccountSet,
  deleteAccountSet,
  fetchAccountSetImports,
  fetchAccountSets,
  lockAccountSet,
  unlockAccountSet,
  updateAccountSet,
  uploadAccountSetRawFiles,
} from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import type { AdminAccountSet, AdminAccountSetFactoryRestEntry, AdminAccountSetImport } from "../../types/admin";

const FILE_INPUT_LABELS = [
  "1. 请假单",
  "2. 加班单",
  "3. 员工基础数据月报",
  "4. 员工基础数据",
  "5. 管理人员基础数据月报",
  "6. 管理人员基础数据",
];

type FactoryRestPeriod = "none" | "full" | "am" | "pm";

export default function AdminDashboardPage() {
  const [accountSets, setAccountSets] = useState<AdminAccountSet[]>([]);
  const [imports, setImports] = useState<AdminAccountSetImport[]>([]);
  const [selectedAccountSetId, setSelectedAccountSetId] = useState<number | null>(null);
  const [createMonth, setCreateMonth] = useState("");
  const [monthlyBenefitDays, setMonthlyBenefitDays] = useState("0");
  const [factoryRestEntries, setFactoryRestEntries] = useState<AdminAccountSetFactoryRestEntry[]>([]);
  const [isFactoryRestDirty, setIsFactoryRestDirty] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<Array<File | null>>(() => Array.from({ length: 6 }, () => null));
  const [resultMessage, setResultMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);

  const selectedAccountSet = useMemo(
    () => accountSets.find((row) => row.id === selectedAccountSetId) ?? null,
    [accountSets, selectedAccountSetId],
  );
  const factoryRestSummary = useMemo(
    () => factoryRestEntries.reduce((sum, entry) => sum + Number(entry.unit || 0), 0),
    [factoryRestEntries],
  );
  const factoryRestCalendar = useMemo(
    () => buildFactoryRestCalendar(selectedAccountSet?.month ?? "", factoryRestEntries),
    [factoryRestEntries, selectedAccountSet?.month],
  );

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const rows = await fetchAccountSets();
        if (!mounted) {
          return;
        }
        setAccountSets(rows);
        const preferredAccountSet = rows.find((row) => row.is_active) ?? rows[0] ?? null;
        setSelectedAccountSetId(preferredAccountSet?.id ?? null);
        setResultMessage("");
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "账套中心初始化失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedAccountSet) {
      setMonthlyBenefitDays("0");
      setFactoryRestEntries([]);
      setIsFactoryRestDirty(false);
      setImports([]);
      return;
    }

    setMonthlyBenefitDays(String(selectedAccountSet.monthly_benefit_days ?? 0));
    setFactoryRestEntries(selectedAccountSet.factory_rest_entries ?? []);
    setIsFactoryRestDirty(false);
  }, [selectedAccountSet]);

  useEffect(() => {
    if (!selectedAccountSetId) {
      setImports([]);
      return;
    }

    const accountSetId = selectedAccountSetId;
    let mounted = true;

    async function loadImports() {
      try {
        const rows = await fetchAccountSetImports(accountSetId);
        if (mounted) {
          setImports(rows);
        }
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "账套导入记录加载失败");
      }
    }

    loadImports();
    return () => {
      mounted = false;
    };
  }, [selectedAccountSetId]);

  async function reloadAccountSets(preferredId?: number | null) {
    const rows = await fetchAccountSets();
    setAccountSets(rows);
    const fallbackAccountSet =
      rows.find((row) => row.id === preferredId) ??
      rows.find((row) => row.id === selectedAccountSetId) ??
      rows.find((row) => row.is_active) ??
      rows[0] ??
      null;
    setSelectedAccountSetId(fallbackAccountSet?.id ?? null);
  }

  async function runAction(action: () => Promise<void>) {
    setIsWorking(true);
    setError("");
    try {
      await action();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "操作失败，请稍后重试");
    } finally {
      setIsWorking(false);
    }
  }

  function currentFactoryRestState(date: string): FactoryRestPeriod {
    const currentEntry = factoryRestEntries.find((entry) => entry.date === date);
    if (!currentEntry) {
      return "none";
    }
    if (currentEntry.period === "full" || currentEntry.period === "am" || currentEntry.period === "pm") {
      return currentEntry.period;
    }
    return "none";
  }

  function toggleFactoryRestDay(date: string) {
    if (!selectedAccountSet || selectedAccountSet.is_locked) {
      return;
    }

    const nextPeriod = nextFactoryRestPeriod(currentFactoryRestState(date));
    const nextEntries = factoryRestEntries.filter((entry) => entry.date !== date);
    if (nextPeriod !== "none") {
      nextEntries.push({
        date,
        period: nextPeriod,
        unit: factoryRestUnit(nextPeriod),
      });
    }
    setFactoryRestEntries(sortFactoryRestEntries(nextEntries));
    setIsFactoryRestDirty(true);
  }

  if (isLoading) {
    return <LoadingState message="正在加载账套中心..." />;
  }

  if (error && !accountSets.length && !selectedAccountSet) {
    return <ErrorState description={error} title="账套中心加载失败" />;
  }

  return (
    <section className="account-center-page">
      <div className="account-workflow">
        <div className="account-workflow-side">
          <div className="account-card account-status-card">
            <div className="account-card-header">
              <span>月度账套</span>
              <span className="page-tag">月度结算模式</span>
            </div>
            <div className="account-card-body">
              <form
                className="account-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!createMonth) {
                    setError("请选择账套月份");
                    return;
                  }
                  void runAction(async () => {
                    const payload = await createAccountSet(createMonth);
                    setCreateMonth("");
                    setResultMessage(`创建成功：${payload.account_set.name}`);
                    await reloadAccountSets(payload.account_set.id);
                  });
                }}
              >
                <label className="account-field">
                  <span className="account-field-label">账套月份</span>
                  <input
                    className="account-input"
                    onChange={(event) => setCreateMonth(event.target.value)}
                    type="month"
                    value={createMonth}
                  />
                </label>
                <button className="legacy-btn-primary account-primary-button" disabled={isWorking} type="submit">
                  创建
                </button>
              </form>

              <label className="account-field">
                <span className="account-field-label">当前账套</span>
                <select
                  className="account-select"
                  onChange={(event) => setSelectedAccountSetId(Number(event.target.value || 0) || null)}
                  value={selectedAccountSetId ?? ""}
                >
                  {accountSets.length ? (
                    accountSets.map((accountSet) => (
                      <option key={accountSet.id} value={accountSet.id}>
                        {accountSet.name}
                        {accountSet.is_active ? "（当前）" : ""}
                      </option>
                    ))
                  ) : (
                    <option value="">暂无账套，请先创建</option>
                  )}
                </select>
              </label>

              <div className="account-lock-notice">
                {!selectedAccountSet
                  ? "请选择账套"
                  : selectedAccountSet.is_locked
                    ? "该账套已锁定，仅允许查看、设为当前和解锁。"
                    : "该账套未锁定，可继续上传、计算和修改。"}
              </div>

              <div className="account-params-grid">
                <label className="account-field">
                  <span className="account-field-label">本月厂休天数</span>
                  <input className="account-input" readOnly type="number" value={factoryRestSummary} />
                </label>
                <label className="account-field">
                  <span className="account-field-label">本月可用福利天数</span>
                  <input
                    className="account-input"
                    disabled={!selectedAccountSet || selectedAccountSet.is_locked}
                    min={0}
                    onChange={(event) => setMonthlyBenefitDays(event.target.value)}
                    step={0.5}
                    type="number"
                    value={monthlyBenefitDays}
                  />
                </label>
              </div>

              <div className="factory-rest-panel">
                <div className="factory-rest-panel-head">
                  <div>
                    <div className="factory-rest-panel-kicker">厂休配置</div>
                    <div className="factory-rest-panel-title">厂休日期明细</div>
                  </div>
                  <span
                    className={`factory-rest-state-badge${
                      selectedAccountSet?.is_locked ? " factory-rest-state-badge--locked" : " factory-rest-state-badge--editable"
                    }`}
                  >
                    {!selectedAccountSet ? "请选择账套" : selectedAccountSet.is_locked ? "已锁定" : "可编辑"}
                  </span>
                </div>

                <div className="factory-rest-summary-card">
                  <div>
                    <div className="factory-rest-summary-label">本月汇总</div>
                    <div className="factory-rest-summary-value">
                      <span>{factoryRestSummary}</span>
                      <span className="factory-rest-summary-unit">天</span>
                    </div>
                  </div>
                  <div className="factory-rest-summary-meta">
                    <div>
                      <span className="factory-rest-summary-meta-label">已选日期</span>
                      <span>{factoryRestEntries.length} 天</span>
                    </div>
                    <div>
                      <span className="factory-rest-summary-meta-label">切换方式</span>
                      <span>上班 / 全天 / 上午 / 下午</span>
                    </div>
                  </div>
                </div>

                <div className="factory-rest-panel-note">
                  点击日期卡片按“上班 → 全天 → 上午 → 下午 → 上班”循环切换，系统会自动汇总厂休天数。
                </div>

                <div className="factory-rest-legend" aria-hidden="true">
                  <span className="factory-rest-legend-item">
                    <span className="factory-rest-legend-dot factory-rest-legend-dot--none" />
                    上班
                  </span>
                  <span className="factory-rest-legend-item">
                    <span className="factory-rest-legend-dot factory-rest-legend-dot--am" />
                    上午
                  </span>
                  <span className="factory-rest-legend-item">
                    <span className="factory-rest-legend-dot factory-rest-legend-dot--pm" />
                    下午
                  </span>
                  <span className="factory-rest-legend-item">
                    <span className="factory-rest-legend-dot factory-rest-legend-dot--full" />
                    全天
                  </span>
                </div>

                {factoryRestCalendar ? (
                  <div className="factory-rest-grid">
                    {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                      <div key={day} className="factory-rest-weekday">
                        周{day}
                      </div>
                    ))}
                    {factoryRestCalendar.leadingEmptySlots.map((slot) => (
                      <div key={`spacer-${slot}`} className="factory-rest-spacer" />
                    ))}
                    {factoryRestCalendar.days.map((day) => {
                      const state = currentFactoryRestState(day.date);
                      return (
                        <button
                          className={`factory-rest-day factory-rest-day--${state}`}
                          disabled={!selectedAccountSet || selectedAccountSet.is_locked}
                          key={day.date}
                          onClick={() => toggleFactoryRestDay(day.date)}
                          type="button"
                        >
                          <span className="factory-rest-day-number">{day.dayOfMonth}</span>
                          <span className="factory-rest-day-state">{factoryRestStateLabel(state)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="factory-rest-empty">请选择账套后设置厂休明细</div>
                )}
              </div>

              <div className="toolbar">
                <button
                  className="account-action-button account-action-button--primary"
                  disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet) {
                        return;
                      }
                      const payload: { monthly_benefit_days: string; factory_rest_entries?: AdminAccountSetFactoryRestEntry[] } = {
                        monthly_benefit_days: monthlyBenefitDays,
                      };
                      if (isFactoryRestDirty) {
                        payload.factory_rest_entries = factoryRestEntries;
                      }
                      await updateAccountSet(selectedAccountSet.id, payload);
                      setResultMessage("账套参数已保存");
                      await reloadAccountSets(selectedAccountSet.id);
                    })
                  }
                  type="button"
                >
                  保存参数
                </button>
                <button
                  className="account-action-button"
                  disabled={!selectedAccountSet || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet) {
                        return;
                      }
                      await activateAccountSet(selectedAccountSet.id);
                      setResultMessage(`已切换当前账套：${selectedAccountSet.name}`);
                      await reloadAccountSets(selectedAccountSet.id);
                    })
                  }
                  type="button"
                >
                  设为当前
                </button>
                <button
                  className="account-action-button account-action-button--warning"
                  disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet || !window.confirm("确认锁定该账套吗？锁定后将不能上传、计算、修正或删除。")) {
                        return;
                      }
                      await lockAccountSet(selectedAccountSet.id);
                      setResultMessage(`账套已锁定：${selectedAccountSet.name}`);
                      await reloadAccountSets(selectedAccountSet.id);
                    })
                  }
                  type="button"
                >
                  锁定账套
                </button>
                <button
                  className="account-action-button account-action-button--success"
                  disabled={!selectedAccountSet || !selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet || !window.confirm("确认解锁该账套吗？解锁后将恢复修改能力。")) {
                        return;
                      }
                      await unlockAccountSet(selectedAccountSet.id);
                      setResultMessage(`账套已解锁：${selectedAccountSet.name}`);
                      await reloadAccountSets(selectedAccountSet.id);
                    })
                  }
                  type="button"
                >
                  解锁账套
                </button>
                <button
                  className="account-action-button account-action-button--danger"
                  disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet || !window.confirm("确认删除该账套吗？将同时删除账套下的归档文件记录。")) {
                        return;
                      }
                      await deleteAccountSet(selectedAccountSet.id);
                      setResultMessage("账套已删除");
                      await reloadAccountSets(null);
                    })
                  }
                  type="button"
                >
                  删除
                </button>
                <button
                  className="account-action-button"
                  disabled={isWorking}
                  onClick={() => void runAction(async () => reloadAccountSets(selectedAccountSetId))}
                  type="button"
                >
                  刷新
                </button>
              </div>

              {resultMessage ? <div className="account-result-message">{resultMessage}</div> : null}
              {error ? <p className="legacy-inline-error">{error}</p> : null}
            </div>
          </div>

          <div className="account-card account-import-card">
            <div className="account-card-header">导入考勤原始表</div>
            <div className="account-card-body">
              <div className="panel-note">
                可一次上传全部源文件，也可只上传需要更新的部分文件；同一类型的新文件会替换该账套里已有的归档文件。点击“开始计算”后才会生成并持久化考勤数据。
              </div>

              <div className="account-upload-group">
                <div className="account-upload-title">员工原始数据</div>
                {FILE_INPUT_LABELS.slice(0, 4).map((label, index) => (
                  <label className="account-field" key={label}>
                    <span className="account-field-label">{label}</span>
                    <input
                      className="account-file-input"
                      onChange={(event) => {
                        const nextFiles = [...uploadFiles];
                        nextFiles[index] = event.target.files?.[0] ?? null;
                        setUploadFiles(nextFiles);
                      }}
                      type="file"
                    />
                  </label>
                ))}
              </div>

              <div className="account-upload-group">
                <div className="account-upload-title">管理人员原始数据</div>
                {FILE_INPUT_LABELS.slice(4).map((label, index) => (
                  <label className="account-field" key={label}>
                    <span className="account-field-label">{label}</span>
                    <input
                      className="account-file-input"
                      onChange={(event) => {
                        const nextFiles = [...uploadFiles];
                        nextFiles[index + 4] = event.target.files?.[0] ?? null;
                        setUploadFiles(nextFiles);
                      }}
                      type="file"
                    />
                  </label>
                ))}
              </div>

              <div className="toolbar">
                <button
                  className="legacy-btn-primary account-primary-button"
                  disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet) {
                        return;
                      }
                      const files = uploadFiles.filter((file): file is File => Boolean(file));
                      if (!files.length) {
                        setError("请至少选择一个要上传的源文件");
                        return;
                      }
                      await uploadAccountSetRawFiles(selectedAccountSet.id, files);
                      setResultMessage("上传成功，已归档到账套。");
                      setUploadFiles(Array.from({ length: 6 }, () => null));
                      await reloadAccountSets(selectedAccountSet.id);
                    })
                  }
                  type="button"
                >
                  上传原始文件
                </button>
                <button
                  className="account-action-button account-action-button--success"
                  disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet) {
                        return;
                      }
                      await calculateAccountSet(selectedAccountSet.id, "employee");
                      setResultMessage("员工计算成功");
                      await reloadAccountSets(selectedAccountSet.id);
                    })
                  }
                  type="button"
                >
                  员工计算
                </button>
                <button
                  className="account-action-button account-action-button--warning"
                  disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet) {
                        return;
                      }
                      await calculateAccountSet(selectedAccountSet.id, "manager");
                      setResultMessage("管理人员计算成功");
                      await reloadAccountSets(selectedAccountSet.id);
                    })
                  }
                  type="button"
                >
                  管理人员计算
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="account-workflow-main">
          <div className="account-card account-audit-card">
            <div className="account-card-header">
              <span>账套导入记录</span>
              <span className="account-card-header-note">按当前选中账套展示</span>
            </div>
            <div className="account-table-wrap">
              <table className="account-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>文件名</th>
                    <th>类型</th>
                    <th>结果</th>
                    <th>条数</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.length ? (
                    imports.map((record) => (
                      <tr key={record.id}>
                        <td>{formatDateTime(record.created_at)}</td>
                        <td>{record.source_filename || "-"}</td>
                        <td>{record.file_type || "-"}</td>
                        <td>{record.status || "-"}</td>
                        <td>{record.imported_count ?? 0}</td>
                        <td>{record.error_message || "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="account-table-empty" colSpan={6}>
                        暂无导入记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function buildFactoryRestCalendar(month: string, entries: AdminAccountSetFactoryRestEntry[]) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return null;
  }

  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDate = new Date(year, monthIndex, 1);
  const lastDate = new Date(year, monthIndex + 1, 0);
  const leadingEmptySlots = Array.from({ length: (firstDate.getDay() + 6) % 7 }, (_, index) => index);
  const entryMap = new Map(entries.map((entry) => [entry.date, entry.period]));

  const days = Array.from({ length: lastDate.getDate() }, (_, index) => {
    const dayOfMonth = index + 1;
    const isoDate = `${month}-${String(dayOfMonth).padStart(2, "0")}`;
    return {
      date: isoDate,
      dayOfMonth,
      period: entryMap.get(isoDate) ?? "none",
    };
  });

  return { days, leadingEmptySlots };
}

function nextFactoryRestPeriod(current: FactoryRestPeriod): FactoryRestPeriod {
  switch (current) {
    case "none":
      return "full";
    case "full":
      return "am";
    case "am":
      return "pm";
    default:
      return "none";
  }
}

function factoryRestUnit(period: FactoryRestPeriod) {
  if (period === "full") {
    return 1;
  }
  if (period === "am" || period === "pm") {
    return 0.5;
  }
  return 0;
}

function factoryRestStateLabel(period: FactoryRestPeriod) {
  switch (period) {
    case "full":
      return "全天";
    case "am":
      return "上午";
    case "pm":
      return "下午";
    default:
      return "上班";
  }
}

function sortFactoryRestEntries(entries: AdminAccountSetFactoryRestEntry[]) {
  return [...entries].sort((left, right) => {
    const leftDate = left.date ?? "";
    const rightDate = right.date ?? "";
    if (leftDate === rightDate) {
      return (left.period ?? "").localeCompare(right.period ?? "");
    }
    return leftDate.localeCompare(rightDate);
  });
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 19);
}
