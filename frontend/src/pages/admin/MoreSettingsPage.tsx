import { useEffect, useState } from "react";
import { fetchMoreSettings, saveMoreSettings, type MoreSettings } from "../../api/admin";
import { useNotification } from "../../components/feedback/Notification";

export default function MoreSettingsPage() {
  const notification = useNotification();
  const [settings, setSettings] = useState<MoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<keyof MoreSettings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchMoreSettings()
      .then(value => { if (active) setSettings(value); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "设置加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function toggleSetting(key: keyof MoreSettings, label: string) {
    if (!settings || saving) return;
    setSaving(key);
    try {
      const value = await saveMoreSettings({ [key]: !settings[key] });
      setSettings(value);
      notification.success(`${label}${value[key] ? "已开启" : "已关闭"}`);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : "设置保存失败");
    } finally {
      setSaving(null);
    }
  }

  return <main className="account-center-page attendance-source-page">
    <div className="account-page-stack">
      <header className="settings-header-panel">
        <div className="settings-header-title-group">
          <h2 className="settings-header-title">更多设置</h2>
          <p className="settings-header-desc">管理菜票核算规则。</p>
        </div>
      </header>
      {loading && <div className="settings-notice-bar settings-notice-bar--info" role="status">正在加载设置...</div>}
      {error && <div className="settings-notice-bar settings-notice-bar--error" role="alert">{error}</div>}
      {settings && <section className="settings-card settings-source-card" aria-labelledby="meal-deduction-title">
        <div>
          <h3 id="meal-deduction-title" className="settings-card-title">异常考勤天数扣除</h3>
          <p className="settings-card-desc">开启后，普通员工每天打卡 1 次或 3 次，每个异常考勤日扣除 8 元菜票。管理人员，以及人员管理中勾选“是否按管理人员计算菜票”的员工免扣。</p>
          <p className="settings-card-desc">默认关闭。修改后，草稿需重新核算；已确认或已充值月份需在“后续补扣与对账”中重算并确认差额，实际充值记录保留。</p>
        </div>
        <div className="settings-source-switch-row">
          <button type="button" role="switch" aria-label="异常考勤天数扣除"
            aria-checked={settings.meal_ticket_abnormal_deduction_enabled} disabled={saving !== null}
            className={`settings-database-switch${settings.meal_ticket_abnormal_deduction_enabled ? " is-enabled" : ""}`}
            onClick={() => toggleSetting("meal_ticket_abnormal_deduction_enabled", "异常考勤天数扣除")}>
            <span aria-hidden="true" />{saving === "meal_ticket_abnormal_deduction_enabled" ? "保存中..." : settings.meal_ticket_abnormal_deduction_enabled ? "已开启" : "已关闭"}
          </button>
        </div>
      </section>}
      {settings && <section className="settings-card settings-source-card" aria-labelledby="meal-offset-title">
        <div>
          <h3 id="meal-offset-title" className="settings-card-title">补发与扣款抵消</h3>
          <p className="settings-card-desc">开启后，同一人的待补发与待扣款按净额处理，净额为零无需操作；关闭后，补发与扣款分别逐人办理。已完成的实际流水和原始补扣明细保留。</p>
          <p className="settings-card-desc">默认开启。修改后请刷新后续操作清单，已操作和已到账任务保留原金额与抵消方式。</p>
        </div>
        <div className="settings-source-switch-row">
          <button type="button" role="switch" aria-label="补发与扣款抵消"
            aria-checked={settings.meal_ticket_offset_enabled} disabled={saving !== null}
            className={`settings-database-switch${settings.meal_ticket_offset_enabled ? " is-enabled" : ""}`}
            onClick={() => toggleSetting("meal_ticket_offset_enabled", "补发与扣款抵消")}>
            <span aria-hidden="true" />{saving === "meal_ticket_offset_enabled" ? "保存中..." : settings.meal_ticket_offset_enabled ? "已开启" : "已关闭"}
          </button>
        </div>
      </section>}
    </div>
  </main>;
}
