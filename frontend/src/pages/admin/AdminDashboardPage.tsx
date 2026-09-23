import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import {
  activateAccountSet,
  calculateAccountSet,
  createAccountSet,
  deleteAccountSet,
  fetchAccountSetCalculationProgress,
  fetchAccountSetImports,
  fetchAccountSets,
  fetchAttendanceSettings,
  lockAccountSet,
  resetAccountSetImported,
  unlockAccountSet,
  updateAccountSet,
  uploadAccountSetRawFiles,
  type AdminAttendanceSettings,
} from "../../api/admin";
import { clearQueryBootstrapCache } from "../../api/query";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import QueryProgressOverlay from "../../components/feedback/QueryProgressOverlay";
import QueryResultPanel from "../../components/query/QueryResultPanel";
import QueryTable from "../../components/query/QueryTable";
import AccountSetSelector from "../../components/query/AccountSetSelector";
import type { AdminAccountSet, AdminAccountSetFactoryRestEntry, AdminAccountSetImport } from "../../types/admin";
import MonthPicker from "../../components/common/MonthPicker";
import { useConfirm } from "../../components/feedback/ConfirmDialog";
import { useNotification } from "../../components/feedback/Notification";
import "./account-center.css";

const FILE_INPUT_LABELS = [
  "1. 请假单",
  "2. 加班单",
  "3. 员工基础数据月报",
  "4. 员工基础数据",
  "5. 管理人员基础数据月报",
  "6. 管理人员基础数据",
];

// 上传槽位对应的后端文件类型（与 FILE_INPUT_LABELS 一一对应）
const FILE_INPUT_TYPES = [
  "leave",
  "overtime",
  "monthly",
  "daily",
  "manager_monthly",
  "manager_daily",
] as const;

type FileInputType = (typeof FILE_INPUT_TYPES)[number];

// 自动获取打卡数据时后端计算会跳过对应文件（与 calculate 流程口径一致），
// 相应上传槽位应禁用并提示原因
function slotDisabledReason(
  type: FileInputType,
  settings: AdminAttendanceSettings | null,
): string | null {
  if (!settings) {
    return null;
  }
  if (type === "daily" && settings.employee_attendance_source === "card_db") {
    return "员工考勤已切换为考勤机数据库同步，无需上传";
  }
  if (
    (type === "manager_monthly" || type === "manager_daily") &&
    settings.manager_attendance_source === "dingtalk"
  ) {
    return "管理人员考勤已切换为钉钉同步，无需上传";
  }
  return null;
}

type FactoryRestPeriod = "none" | "full" | "am" | "pm";

export default function AdminDashboardPage() {
  const confirm = useConfirm();
  const notification = useNotification();
  const [accountSets, setAccountSets] = useState<AdminAccountSet[]>([]);

  const [imports, setImports] = useState<AdminAccountSetImport[]>([]);
  const [selectedAccountSetId, setSelectedAccountSetId] = useState<number | null>(null);
  const [createMonth, setCreateMonth] = useState("");
  const [monthlyBenefitDays, setMonthlyBenefitDays] = useState("0");
  const [factoryRestEntries, setFactoryRestEntries] = useState<AdminAccountSetFactoryRestEntry[]>([]);
  const [isFactoryRestDirty, setIsFactoryRestDirty] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<Array<File | null>>(() => Array.from({ length: 6 }, () => null));
  const [dragOverIndex, setDragOverIndex] = useState<Array<boolean>>(() => Array.from({ length: 6 }, () => false));
  const [attendanceSettings, setAttendanceSettings] = useState<AdminAttendanceSettings | null>(null);
  const [progressVisible, setProgressVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadingText, setLoadingText] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [showModal, setShowModal] = useState<"settings" | "upload" | null>(null);

  const handleCloseModal = () => {
    setShowModal(null);
    setUploadFiles(Array.from({ length: 6 }, () => null));
    setDragOverIndex(Array.from({ length: 6 }, () => false));
    setProgressVisible(false);
    setProgress(0);
    setLoadingText("");
  };

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

  // 槽位禁用原因：来源切为自动获取打卡数据时对应文件无需上传（获取失败时不禁用，页面照常可用）
  const slotDisabledReasons = useMemo(
    () => FILE_INPUT_TYPES.map((type) => slotDisabledReason(type, attendanceSettings)),
    [attendanceSettings],
  );

  // 已选文件落在禁用槽位时自动清除，避免提交无效文件
  useEffect(() => {
    setUploadFiles((current) =>
      current.map((file, index) => (slotDisabledReasons[index] ? null : file)),
    );
  }, [slotDisabledReasons]);

  useEffect(() => {
    let mounted = true;

    async function loadAttendanceSettings() {
      try {
        const settings = await fetchAttendanceSettings();
        if (mounted) {
          setAttendanceSettings(settings);
        }
      } catch {
        // 设置加载失败时不禁用任何槽位，不阻塞账套中心
      }
    }

    void loadAttendanceSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const tableHeaders = ["时间", "文件名", "类型", "结果", "条数", "错误"];
  const tableRows = useMemo(() => {
    return imports.map((record) => [
      formatDateTime(record.created_at),
      record.source_filename || "-",
      record.file_type || "-",
      <span
        key={record.id}
        className={`acm-table-status-tag ${
          record.status === "success" || record.status === "uploaded"
            ? "acm-table-status-tag--success"
            : record.status === "error" || record.status === "failed"
              ? "acm-table-status-tag--error"
              : "acm-table-status-tag--pending"
        }`}
      >
        {record.status || "-"}
      </span>,
      record.imported_count ?? 0,
      record.error_message || "-",
    ]);
  }, [imports]);

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
        notification.error(caughtError instanceof ApiError ? caughtError.message : "账套导入记录加载失败");
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
    try {
      await action();
    } catch (caughtError) {
      notification.error(caughtError instanceof ApiError ? caughtError.message : "操作失败，请稍后重试");
    } finally {
      setIsWorking(false);
    }
  }

  async function runCalculation(mode: "employee" | "manager") {
    if (!selectedAccountSet) {
      return;
    }

    setProgressVisible(true);
    setProgress(0);
    setLoadingText(
      mode === "employee"
        ? "正在对员工考勤进行汇总与数据结算..."
        : "正在计算管理人员考勤及年假加班额度...",
    );

    // 轮询后端真实计算进度（文件导入按行、管理人员汇总按人推进）
    const poll = setInterval(() => {
      void fetchAccountSetCalculationProgress(selectedAccountSet.id, mode)
        .then((progress) => {
          if (progress.status !== "idle") {
            setProgress(progress.percent);
            if (progress.stage) {
              setLoadingText(progress.stage);
            }
          }
        })
        .catch(() => {
          // 单次轮询失败不中断进度显示，等计算响应或下一次轮询
        });
    }, 1000);

    try {
      await calculateAccountSet(selectedAccountSet.id, mode);
      setProgress(100);
      setLoadingText(mode === "employee" ? "员工考勤结算成功！" : "管理人员考勤计算成功！");
      await reloadAccountSets(selectedAccountSet.id);
      notification.success(mode === "employee" ? "员工计算成功" : "管理人员计算成功");
    } catch (caughtError) {
      notification.error(
        caughtError instanceof ApiError
          ? caughtError.message
          : mode === "employee"
            ? "员工考勤结算失败"
            : "管理人员考勤计算失败",
      );
    } finally {
      clearInterval(poll);
      setTimeout(() => {
        setProgressVisible(false);
      }, 500);
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
    return <LoadingState headers={tableHeaders} message="正在加载账套中心..." variant="account-center" />;
  }

  if (error && !accountSets.length && !selectedAccountSet) {
    return <ErrorState description={error} title="账套中心加载失败" />;
  }

  return (
    <section className="account-center-page" aria-label="账套管理工作台">
      <QueryProgressOverlay
        active={progressVisible}
        className="query-progress-overlay-page"
        progress={progress}
        text={loadingText}
      />

      {/* 顶部标题栏 */}
      <header className="account-center-heading">
        <div>
          <span className="account-center-eyebrow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            LEDGER CONTROL CENTER
          </span>
          <h1>账套管理</h1>
          <p>维护月度账套、配置厂休福利参数、同步考勤原始文件与执行结算入库。</p>
        </div>
        <span className="account-center-count">共 {accountSets.length} 个月度账套</span>
      </header>

      {/* 账套核心控制中心 Hero Card */}
      <section className="acm-hero-card" aria-label="当前账套概览">
        <div className="acm-hero-header">
          <div className="acm-hero-title-group">
            <h2 className="acm-hero-title">{selectedAccountSet?.name ?? "请选择账套"}</h2>
            {selectedAccountSet ? (
              <>
                <span className={`acm-badge ${selectedAccountSet.is_active ? "acm-badge--active" : "acm-badge--inactive"}`}>
                  <span className="acm-badge-dot" />
                  {selectedAccountSet.is_active ? "当前激活账套" : "历史账套"}
                </span>
                <span className={`acm-badge ${selectedAccountSet.is_locked ? "acm-badge--locked" : "acm-badge--editable"}`}>
                  <span className="acm-badge-dot" />
                  {selectedAccountSet.is_locked ? "已锁定 (不可修改)" : "可编辑 (未锁定)"}
                </span>
              </>
            ) : null}
          </div>

          <div className="acm-hero-selector">
            <AccountSetSelector
              accountSets={accountSets}
              compact
              label="切换账套"
              onChange={(month) => {
                const accountSet = accountSets.find((item) => item.month === month);
                setSelectedAccountSetId(accountSet?.id ?? null);
              }}
              value={selectedAccountSet?.month ?? ""}
            />
          </div>
        </div>

        {/* 关键业务指标条 */}
        <div className="acm-metrics-strip">
          <div className="acm-metric-card">
            <div className="acm-metric-icon acm-metric-icon--amber">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className="acm-metric-content">
              <span className="acm-metric-label">本月厂休</span>
              <div className="acm-metric-value">
                {selectedAccountSet?.factory_rest_entries?.reduce((sum, entry) => sum + Number(entry.unit || 0), 0) ?? 0}
                <span className="acm-metric-unit">天</span>
              </div>
            </div>
          </div>

          <div className="acm-metric-card">
            <div className="acm-metric-icon acm-metric-icon--indigo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div className="acm-metric-content">
              <span className="acm-metric-label">可用福利额度</span>
              <div className="acm-metric-value">
                {selectedAccountSet?.monthly_benefit_days ?? 0}
                <span className="acm-metric-unit">天</span>
              </div>
            </div>
          </div>

          <div className="acm-metric-card">
            <div className="acm-metric-icon acm-metric-icon--emerald">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
            </div>
            <div className="acm-metric-content">
              <span className="acm-metric-label">导入记录流水</span>
              <div className="acm-metric-value">
                {imports.length}
                <span className="acm-metric-unit">条</span>
              </div>
            </div>
          </div>

          <div className="acm-metric-card">
            <div className="acm-metric-icon acm-metric-icon--sky">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
            </div>
            <div className="acm-metric-content">
              <span className="acm-metric-label">数据源同步</span>
              <div className="acm-metric-value" style={{ fontSize: "14px", fontWeight: "600", paddingTop: "2px" }}>
                {attendanceSettings?.employee_attendance_source === "card_db" ? "考勤机直连" : "文件上传"}
                {" · "}
                {attendanceSettings?.manager_attendance_source === "dingtalk" ? "钉钉同步" : "文件上传"}
              </div>
            </div>
          </div>
        </div>

        {/* macOS Dock 风格悬浮操作栏 */}
        <div className="acm-dock-container account-panel-selector">
          <div className="acm-dock-bar">
            {selectedAccountSet && !selectedAccountSet.is_active ? (
              <button
                className="acm-dock-item acm-dock-item--active-trigger"
                disabled={isWorking}
                onClick={() =>
                  void runAction(async () => {
                    await activateAccountSet(selectedAccountSet.id);
                    clearQueryBootstrapCache();
                    window.dispatchEvent(new CustomEvent("account-set-active-changed"));
                    notification.success(`已切换当前账套：${selectedAccountSet.name}`);
                    await reloadAccountSets(selectedAccountSet.id);
                  })
                }
                type="button"
                title="设为当前激活账套"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>设为当前</span>
              </button>
            ) : null}

            <button
              className="acm-dock-item btn-settings"
              onClick={() => setShowModal("settings")}
              type="button"
              title="配置月度账套、厂休与参数"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>账套设置</span>
            </button>

            <button
              className="acm-dock-item btn-upload"
              onClick={() => setShowModal("upload")}
              type="button"
              title="上传原始考勤文档"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>上传原始文档</span>
            </button>

            <div className="acm-dock-divider" aria-hidden="true" />

            <button
              className="acm-dock-item acm-dock-item--emp btn-calc-employee"
              disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
              onClick={() => void runAction(() => runCalculation("employee"))}
              type="button"
              title="执行员工考勤结算"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="9" x2="15" y2="15" />
                <line x1="15" y1="9" x2="9" y2="15" />
              </svg>
              <span>员工计算</span>
            </button>

            <button
              className="acm-dock-item acm-dock-item--mgr btn-calc-manager"
              disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
              onClick={() => void runAction(() => runCalculation("manager"))}
              type="button"
              title="执行管理人员考勤计算"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <polyline points="17 11 19 13 23 9" />
              </svg>
              <span>管理人员计算</span>
            </button>
          </div>
        </div>
      </section>

      {/* 中部业务看板：厂休排班与数据源准备速览 */}
      <div className="acm-dashboard-grid">
        {/* 厂休与考勤参数看板 */}
        <div className="acm-panel">
          <div className="acm-panel-head">
            <div className="acm-panel-title-wrap">
              <span className="acm-panel-kicker">SCHEDULE & PARAMETERS</span>
              <h3 className="acm-panel-title">厂休排班与福利参数</h3>
            </div>
            <button
              className="acm-panel-action-link"
              onClick={() => setShowModal("settings")}
              type="button"
            >
              配置排班
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="acm-rest-preview-box">
            <div className="acm-rest-preview-item">
              <span className="acm-rest-preview-label">本月厂休总计</span>
              <div className="acm-rest-preview-val">
                {factoryRestSummary}
                <small>天</small>
              </div>
            </div>
            <div className="acm-rest-preview-divider" />
            <div className="acm-rest-preview-item">
              <span className="acm-rest-preview-label">已排班日期</span>
              <div className="acm-rest-preview-val">
                {factoryRestEntries.length}
                <small>天</small>
              </div>
            </div>
            <div className="acm-rest-preview-divider" />
            <div className="acm-rest-preview-item">
              <span className="acm-rest-preview-label">可用福利额度</span>
              <div className="acm-rest-preview-val">
                {selectedAccountSet?.monthly_benefit_days ?? 0}
                <small>天</small>
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: "12px", color: "var(--acm-text-secondary)", marginBottom: "8px", fontWeight: "600" }}>
              已排厂休日期明细：
            </div>
            {factoryRestEntries.length > 0 ? (
              <div className="acm-rest-tag-list">
                {factoryRestEntries.map((entry) => (
                  <span
                    key={entry.date}
                    className={`acm-rest-tag acm-rest-tag--${entry.period ?? "full"}`}
                  >
                    {entry.date?.slice(5)} ({factoryRestStateLabel(entry.period as FactoryRestPeriod)})
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "12.5px", color: "var(--acm-text-muted)" }}>
                本月暂未标记厂休日期，如需厂休请点击右上角“配置排班”。
              </div>
            )}
          </div>
        </div>

        {/* 原始考勤数据源准备度 */}
        <div className="acm-panel">
          <div className="acm-panel-head">
            <div className="acm-panel-title-wrap">
              <span className="acm-panel-kicker">DATA READINESS</span>
              <h3 className="acm-panel-title">原始考勤数据准备度</h3>
            </div>
            <button
              className="acm-panel-action-link"
              onClick={() => setShowModal("upload")}
              type="button"
            >
              上传归档
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="acm-source-readiness-grid">
            {FILE_INPUT_LABELS.map((label, index) => {
              const fileType = FILE_INPUT_TYPES[index];
              const disabledReason = slotDisabledReasons[index];
              const isAutoSynced = Boolean(disabledReason);
              const importedRecord = imports.find(
                (item) => item.file_type === fileType || item.source_filename?.includes(label.split(". ")[1] ?? ""),
              );

              return (
                <div key={label} className="acm-source-card">
                  <div className="acm-source-info">
                    <span
                      className={`acm-source-dot ${
                        isAutoSynced
                          ? "acm-source-dot--synced"
                          : importedRecord
                            ? "acm-source-dot--uploaded"
                            : "acm-source-dot--empty"
                      }`}
                    />
                    <span className="acm-source-name">{label}</span>
                  </div>
                  <div>
                    {isAutoSynced ? (
                      <span className="acm-source-status-pill acm-source-status-pill--synced">自动同步</span>
                    ) : importedRecord ? (
                      <span className="acm-source-status-pill acm-source-status-pill--uploaded">已归档</span>
                    ) : (
                      <span className="acm-source-status-pill acm-source-status-pill--empty">待上传</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: "12px", color: "var(--acm-text-secondary)", lineHeight: "1.4" }}>
            提示：上传原始文档后，同一类型文件将自动替换归档；准备完毕后即可点击“员工计算”与“管理人员计算”入库。
          </div>
        </div>
      </div>

      {/* 账套导入记录流水卡片 */}
      <section className="acm-imports-section" aria-label="账套导入记录">
        <div className="acm-imports-header">
          <div>
            <h2>账套导入记录</h2>
            <div className="acm-imports-subtitle">
              {selectedAccountSet ? `${selectedAccountSet.name} · 共 ${imports.length} 条归档记录` : "请选择账套"}
            </div>
          </div>
        </div>

        <QueryResultPanel>
          <QueryTable
            emptyText="暂无导入记录"
            headers={tableHeaders}
            rows={tableRows}
          />
        </QueryResultPanel>
      </section>

      {/* ====================================================================
          账套管理与参数设置弹窗 (Settings Modal)
          ==================================================================== */}
      {showModal === "settings" && (
        <div
          className="acm-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseModal();
            }
          }}
        >
          <div className="acm-modal-card acm-modal-card--settings">
            <QueryProgressOverlay
              active={progressVisible}
              className="query-progress-overlay-modal"
              progress={progress}
              text={loadingText}
            />

            <div className="acm-modal-head">
              <div className="acm-modal-title-group">
                <h3 className="acm-modal-title">账套设置与参数配置</h3>
                {selectedAccountSet ? (
                  <span className={`acm-badge ${selectedAccountSet.is_locked ? "acm-badge--locked" : "acm-badge--editable"}`}>
                    <span className="acm-badge-dot" />
                    {selectedAccountSet.is_locked ? "已锁定" : "可编辑"}
                  </span>
                ) : null}
              </div>
              <button
                className="acm-modal-close-btn"
                onClick={handleCloseModal}
                type="button"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="acm-modal-body">
              <div className="acm-modal-split-layout">
                {/* 左列：月度账套创建与生命周期控制 */}
                <div className="acm-modal-col">
                  {/* 创建新账套 */}
                  <div className="acm-card-block">
                    <div className="acm-card-block-title">月度账套</div>
                    <form
                      style={{ display: "flex", flexDirection: "column", gap: "10px" }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!createMonth) {
                          notification.warning("请选择账套月份");
                          return;
                        }
                        void runAction(async () => {
                          setProgressVisible(true);
                          setProgress(0);
                          setLoadingText("正在创建新账套...");
                          let current = 0;
                          const interval = setInterval(() => {
                            current += Math.floor(Math.random() * 15) + 5;
                            if (current >= 95) current = 95;
                            setProgress(current);
                          }, 80);
                          try {
                            const payload = await createAccountSet(createMonth);
                            setCreateMonth("");
                            clearInterval(interval);
                            setProgress(100);
                            setLoadingText("新账套创建成功！");
                            notification.success(`创建成功：${payload.account_set.name}`);
                            await reloadAccountSets(payload.account_set.id);
                          } catch (caughtError) {
                            clearInterval(interval);
                            notification.error(caughtError instanceof ApiError ? caughtError.message : "创建账套失败");
                          } finally {
                            setTimeout(() => {
                              setProgressVisible(false);
                            }, 500);
                          }
                        });
                      }}
                    >
                      <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "12px", color: "var(--acm-text-secondary)", fontWeight: "600" }}>账套月份</span>
                        <MonthPicker
                          onChange={(val) => setCreateMonth(val)}
                          value={createMonth}
                        />
                      </label>
                      <button
                        className="acm-btn acm-btn--primary"
                        disabled={isWorking}
                        type="submit"
                        style={{ height: "36px" }}
                      >
                        创建
                      </button>
                    </form>
                  </div>

                  {/* 当前账套切换与状态 */}
                  <div className="acm-card-block">
                    <div className="acm-card-block-title">切换与查看账套</div>
                    <AccountSetSelector
                      accountSets={accountSets}
                      compact
                      label="选择账套"
                      onChange={(month) => {
                        const accountSet = accountSets.find((item) => item.month === month);
                        setSelectedAccountSetId(accountSet?.id ?? null);
                      }}
                      value={selectedAccountSet?.month ?? ""}
                    />
                    <div style={{ fontSize: "12px", color: "var(--acm-text-secondary)", lineHeight: "1.4", marginTop: "4px" }}>
                      {!selectedAccountSet
                        ? "请选择账套"
                        : selectedAccountSet.is_locked
                          ? "该账套已锁定，仅允许查看、设为当前和解锁。"
                          : "该账套未锁定，可继续上传、计算和修改。"}
                    </div>
                  </div>

                  {/* 账套运维动作按钮组 */}
                  <div className="acm-card-block">
                    <div className="acm-card-block-title">账套生命周期操作</div>
                    <div className="acm-button-stack">
                      <button
                        className="acm-btn acm-btn--outline"
                        disabled={!selectedAccountSet || isWorking}
                        onClick={() =>
                          void runAction(async () => {
                            if (!selectedAccountSet) return;
                            setProgressVisible(true);
                            setProgress(0);
                            setLoadingText("正在设置当前激活账套...");
                            try {
                              await activateAccountSet(selectedAccountSet.id);
                              setProgress(100);
                              setLoadingText("当前账套设置成功！");
                              notification.success(`已切换当前账套：${selectedAccountSet.name}`);
                              clearQueryBootstrapCache();
                              window.dispatchEvent(new CustomEvent("account-set-active-changed"));
                              await reloadAccountSets(selectedAccountSet.id);
                            } catch (caughtError) {
                              notification.error(caughtError instanceof ApiError ? caughtError.message : "设置当前账套失败");
                            } finally {
                              setTimeout(() => {
                                setProgressVisible(false);
                              }, 500);
                            }
                          })
                        }
                        type="button"
                      >
                        设为当前
                      </button>

                      {selectedAccountSet?.is_locked ? (
                        <button
                          className="acm-btn acm-btn--outline"
                          disabled={!selectedAccountSet || isWorking}
                          onClick={() =>
                            void runAction(async () => {
                              if (!selectedAccountSet) return;
                              const isConfirmed = await confirm({
                                message: "确认解锁该账套吗？解锁后将恢复修改能力。",
                                type: "info",
                              });
                              if (!isConfirmed) return;
                              setProgressVisible(true);
                              setProgress(0);
                              setLoadingText("正在解锁当前账套...");
                              try {
                                await unlockAccountSet(selectedAccountSet.id);
                                setProgress(100);
                                notification.success(`账套已解锁：${selectedAccountSet.name}`);
                                await reloadAccountSets(selectedAccountSet.id);
                              } catch (caughtError) {
                                notification.error(caughtError instanceof ApiError ? caughtError.message : "解锁账套失败");
                              } finally {
                                setTimeout(() => setProgressVisible(false), 500);
                              }
                            })
                          }
                          type="button"
                        >
                          解锁账套
                        </button>
                      ) : (
                        <button
                          className="acm-btn acm-btn--outline"
                          disabled={!selectedAccountSet || isWorking}
                          onClick={() =>
                            void runAction(async () => {
                              if (!selectedAccountSet) return;
                              const isConfirmed = await confirm({
                                message: "确认锁定该账套吗？锁定后将不能上传、计算、修正或删除。",
                                type: "warning",
                              });
                              if (!isConfirmed) return;
                              setProgressVisible(true);
                              setProgress(0);
                              setLoadingText("正在锁定当前账套...");
                              try {
                                await lockAccountSet(selectedAccountSet.id);
                                setProgress(100);
                                notification.success(`账套已锁定：${selectedAccountSet.name}`);
                                await reloadAccountSets(selectedAccountSet.id);
                              } catch (caughtError) {
                                notification.error(caughtError instanceof ApiError ? caughtError.message : "锁定账套失败");
                              } finally {
                                setTimeout(() => setProgressVisible(false), 500);
                              }
                            })
                          }
                          type="button"
                        >
                          锁定账套
                        </button>
                      )}

                      <button
                        className="acm-btn acm-btn--outline"
                        disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                        onClick={() =>
                          void runAction(async () => {
                            if (!selectedAccountSet) return;
                            const isConfirmed = await confirm({
                              message:
                                `确认清空 ${selectedAccountSet.month} 账套的已导入数据吗？` +
                                "将删除该月的月报、日报、请假单、加班单数据及全部归档文件，" +
                                "清空后需要重新上传源文件并重新计算，且不影响其他月份。",
                              type: "danger",
                            });
                            if (!isConfirmed) return;
                            setProgressVisible(true);
                            setProgress(0);
                            setLoadingText("正在清空已导入数据...");
                            try {
                              const result = await resetAccountSetImported(selectedAccountSet.id);
                              setProgress(100);
                              const deletedTotal = Object.values(result.deleted ?? {}).reduce((sum, count) => sum + count, 0);
                              notification.success(`已清空 ${selectedAccountSet.month} 已导入数据（共 ${deletedTotal} 条记录），请重新上传源文件。`);
                              await reloadAccountSets(selectedAccountSet.id);
                            } catch (caughtError) {
                              notification.error(caughtError instanceof ApiError ? caughtError.message : "清空已导入数据失败");
                            } finally {
                              setTimeout(() => setProgressVisible(false), 500);
                            }
                          })
                        }
                        type="button"
                      >
                        清空已导入数据
                      </button>

                      <button
                        className="acm-btn acm-btn--danger-text"
                        disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                        onClick={() =>
                          void runAction(async () => {
                            if (!selectedAccountSet) return;
                            const isConfirmed = await confirm({
                              message: "确认删除该账套吗？将同时删除账套下的归档文件记录。",
                              type: "danger",
                            });
                            if (!isConfirmed) return;
                            setProgressVisible(true);
                            setProgress(0);
                            setLoadingText("正在删除该账套...");
                            try {
                              await deleteAccountSet(selectedAccountSet.id);
                              setProgress(100);
                              notification.success("账套已删除");
                              await reloadAccountSets(null);
                            } catch (caughtError) {
                              notification.error(caughtError instanceof ApiError ? caughtError.message : "删除账套失败");
                            } finally {
                              setTimeout(() => setProgressVisible(false), 500);
                            }
                          })
                        }
                        type="button"
                      >
                        删除
                      </button>

                      <button
                        className="acm-btn acm-btn--outline"
                        disabled={isWorking}
                        onClick={() => void runAction(async () => reloadAccountSets(selectedAccountSetId))}
                        type="button"
                      >
                        刷新
                      </button>
                    </div>
                  </div>
                </div>

                {/* 右列：参数设置与厂休排班日历 */}
                <div className="acm-modal-col">
                  {/* 参数配置 */}
                  <div className="acm-card-block">
                    <div className="acm-card-block-title">参数设置</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--acm-text-secondary)" }}>
                          本月厂休天数
                        </span>
                        <input
                          readOnly
                          style={{
                            height: "36px",
                            padding: "0 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--acm-border)",
                            background: "var(--acm-surface-muted)",
                            fontSize: "14px",
                            fontWeight: "600",
                            color: "var(--acm-text-main)",
                          }}
                          type="number"
                          value={factoryRestSummary}
                        />
                      </label>

                      <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--acm-text-secondary)" }}>
                          本月可用福利天数
                        </span>
                        <input
                          disabled={!selectedAccountSet || selectedAccountSet.is_locked}
                          min={0}
                          onChange={(event) => setMonthlyBenefitDays(event.target.value)}
                          step={0.5}
                          style={{
                            height: "36px",
                            padding: "0 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--acm-border-strong)",
                            background: "#ffffff",
                            fontSize: "14px",
                            color: "var(--acm-text-main)",
                          }}
                          type="number"
                          value={monthlyBenefitDays}
                        />
                      </label>
                    </div>
                  </div>

                  {/* 厂休日历排班 */}
                  <div className="acm-card-block">
                    <div className="acm-card-block-title">厂休排班日历</div>
                    <div className="acm-calendar-wrapper">
                      <div className="acm-calendar-topbar">
                        <div className="acm-calendar-stats">
                          <span>已标记厂休: <strong>{factoryRestSummary} 天</strong></span>
                          <span>已选天数: <strong>{factoryRestEntries.length} 天</strong></span>
                        </div>

                        <div className="acm-calendar-legend" aria-hidden="true">
                          <span className="acm-legend-item">
                            <span className="acm-legend-dot acm-legend-dot--none" />
                            上班
                          </span>
                          <span className="acm-legend-item">
                            <span className="acm-legend-dot acm-legend-dot--am" />
                            上午
                          </span>
                          <span className="acm-legend-item">
                            <span className="acm-legend-dot acm-legend-dot--pm" />
                            下午
                          </span>
                          <span className="acm-legend-item">
                            <span className="acm-legend-dot acm-legend-dot--full" />
                            全天
                          </span>
                        </div>
                      </div>

                      <div style={{ fontSize: "11.5px", color: "var(--acm-text-muted)" }}>
                        提示：点击日历日期按“上班 → 全天 → 上午 → 下午 → 上班”循环切换，配置完毕后请点击下方保存参数。
                      </div>

                      {factoryRestCalendar ? (
                        <div className="acm-calendar-grid">
                          {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                            <div key={day} className="acm-calendar-weekday">
                              周{day}
                            </div>
                          ))}
                          {factoryRestCalendar.leadingEmptySlots.map((slot) => (
                            <div key={`spacer-${slot}`} className="acm-calendar-spacer" />
                          ))}
                          {factoryRestCalendar.days.map((day) => {
                            const state = currentFactoryRestState(day.date);
                            return (
                              <button
                                className={`acm-calendar-day-btn acm-day--${state}`}
                                disabled={!selectedAccountSet || selectedAccountSet.is_locked}
                                key={day.date}
                                onClick={() => toggleFactoryRestDay(day.date)}
                                type="button"
                              >
                                <span className="acm-day-number">{day.dayOfMonth}</span>
                                <span className="acm-day-state-label">{factoryRestStateLabel(state)}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ padding: "24px", textAlign: "center", color: "var(--acm-text-muted)" }}>
                          请先选择或创建账套以配置厂休日历
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                      <button
                        className="acm-btn acm-btn--primary"
                        disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                        onClick={() =>
                          void runAction(async () => {
                            if (!selectedAccountSet) return;
                            setProgressVisible(true);
                            setProgress(0);
                            setLoadingText("正在保存账套参数与厂休明细...");
                            try {
                              const payload: { monthly_benefit_days: string; factory_rest_entries?: AdminAccountSetFactoryRestEntry[] } = {
                                monthly_benefit_days: monthlyBenefitDays,
                              };
                              if (isFactoryRestDirty) {
                                payload.factory_rest_entries = factoryRestEntries;
                              }
                              await updateAccountSet(selectedAccountSet.id, payload);
                              setProgress(100);
                              notification.success("账套参数已保存");
                              await reloadAccountSets(selectedAccountSet.id);
                            } catch (caughtError) {
                              notification.error(caughtError instanceof ApiError ? caughtError.message : "保存参数失败");
                            } finally {
                              setTimeout(() => setProgressVisible(false), 500);
                            }
                          })
                        }
                        type="button"
                      >
                        保存参数
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          原始文档上传与结算弹窗 (Upload Modal)
          ==================================================================== */}
      {showModal === "upload" && (
        <div
          className="acm-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseModal();
            }
          }}
        >
          <div className="acm-modal-card acm-modal-card--upload">
            <QueryProgressOverlay
              active={progressVisible}
              className="query-progress-overlay-modal"
              progress={progress}
              text={loadingText}
            />

            <div className="acm-modal-head">
              <div className="acm-modal-title-group">
                <h3 className="acm-modal-title">导入考勤原始表</h3>
                {selectedAccountSet ? (
                  <span className="acm-badge acm-badge--active">
                    <span className="acm-badge-dot" />
                    {selectedAccountSet.name}
                  </span>
                ) : null}
              </div>
              <button
                className="acm-modal-close-btn"
                onClick={handleCloseModal}
                type="button"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="acm-modal-body">
              <div style={{ fontSize: "13px", color: "var(--acm-text-secondary)", lineHeight: "1.5" }}>
                可一次上传全部源文件，也可只上传需要更新的部分文件；同一类型的新文件会替换该账套里已有的归档文件。点击“开始计算”后才会生成并持久化考勤数据。
              </div>

              {/* 6 大上传槽位卡片网格 */}
              <div className="acm-upload-grid">
                {FILE_INPUT_LABELS.map((label, index) => {
                  const file = uploadFiles[index];
                  const isDragOver = dragOverIndex[index];
                  const fileInputId = `acm-file-input-${index}`;
                  const disabledReason = slotDisabledReasons[index];
                  const isSlotDisabled = Boolean(disabledReason);

                  return (
                    <div
                      className={`acm-upload-slot ${file ? "has-file" : ""} ${isDragOver ? "is-dragover" : ""} ${isSlotDisabled ? "is-disabled" : ""}`}
                      key={label}
                      title={disabledReason ?? undefined}
                      onClick={() => {
                        if (isSlotDisabled) return;
                        document.getElementById(fileInputId)?.click();
                      }}
                      onDragLeave={(e) => {
                        if (isSlotDisabled) return;
                        e.preventDefault();
                        const nextDrag = [...dragOverIndex];
                        nextDrag[index] = false;
                        setDragOverIndex(nextDrag);
                      }}
                      onDragOver={(e) => {
                        if (isSlotDisabled) return;
                        e.preventDefault();
                        const nextDrag = [...dragOverIndex];
                        nextDrag[index] = true;
                        setDragOverIndex(nextDrag);
                      }}
                      onDrop={(e) => {
                        if (isSlotDisabled) return;
                        e.preventDefault();
                        const nextDrag = [...dragOverIndex];
                        nextDrag[index] = false;
                        setDragOverIndex(nextDrag);

                        const droppedFile = e.dataTransfer.files?.[0] ?? null;
                        if (droppedFile) {
                          const nextFiles = [...uploadFiles];
                          nextFiles[index] = droppedFile;
                          setUploadFiles(nextFiles);
                        }
                      }}
                    >
                      <input
                        id={fileInputId}
                        disabled={isSlotDisabled}
                        style={{ display: "none" }}
                        onChange={(event) => {
                          const nextFiles = [...uploadFiles];
                          nextFiles[index] = event.target.files?.[0] ?? null;
                          setUploadFiles(nextFiles);
                        }}
                        type="file"
                      />

                      {file && (
                        <button
                          className="acm-slot-clear-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            const nextFiles = [...uploadFiles];
                            nextFiles[index] = null;
                            setUploadFiles(nextFiles);
                          }}
                          title="清除选择"
                          type="button"
                        >
                          ×
                        </button>
                      )}

                      <div className="acm-slot-icon-box">
                        {file ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        )}
                      </div>

                      <div className="acm-slot-content">
                        <div className="acm-slot-title">{label}</div>
                        <div className="acm-slot-hint">
                          {disabledReason ?? (file ? `${file.name} (${(file.size / 1024).toFixed(1)} KB)` : "点击选择或拖拽文件")}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 弹窗底部操作栏 */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", borderTop: "1px solid var(--acm-border)", paddingTop: "16px", marginTop: "8px" }}>
                <button
                  className="acm-btn acm-btn--primary"
                  disabled={!selectedAccountSet || selectedAccountSet.is_locked || isWorking}
                  onClick={() =>
                    void runAction(async () => {
                      if (!selectedAccountSet) return;
                      const files = uploadFiles.filter(
                        (file, index) => file && !slotDisabledReasons[index],
                      ) as File[];
                      if (!files.length) {
                        notification.warning("请至少选择一个要上传的源文件");
                        return;
                      }

                      setProgressVisible(true);
                      setProgress(0);
                      setLoadingText("正在上传原始文件...");

                      try {
                        const response = await uploadAccountSetRawFiles(selectedAccountSet.id, files, (percent) => {
                          setProgress(percent);
                          if (percent >= 100) {
                            setLoadingText("上传完成，正在归档原始文件...");
                          }
                        });
                        setProgress(100);
                        setUploadFiles(Array.from({ length: 6 }, () => null));
                        await reloadAccountSets(selectedAccountSet.id);
                        const rejectedFiles = (response.results ?? []).filter((result) => result.status === "error");
                        if (rejectedFiles.length) {
                          notification.warning(
                            `上传完成，${rejectedFiles.length} 个文件被拒绝：${rejectedFiles
                              .map((result) => `${result.file}（${result.error ?? "未知原因"}）`)
                              .join("；")}`,
                          );
                        } else {
                          notification.success("上传成功，已归档到账套。");
                        }
                        setShowModal(null);
                      } catch (caughtError) {
                        notification.error(caughtError instanceof ApiError ? caughtError.message : "文件上传失败");
                      } finally {
                        setTimeout(() => setProgressVisible(false), 500);
                      }
                    })
                  }
                  type="button"
                >
                  上传原始文件
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
