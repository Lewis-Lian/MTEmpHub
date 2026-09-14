import { useEffect, useMemo, useState } from "react";
import { fetchMessageRecipients, sendMessage, type MessageRecipient, type MessageRecipientScope } from "../../api/messages";
import { fetchAdminDepartments } from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import EmployeePicker from "../../components/query/EmployeePicker";
import RichTextEditor from "../../components/editor/RichTextEditor";
import { htmlToTextPreview, isBlankRichText } from "../../utils/richText";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import type { DepartmentOption, QueryEmployee } from "../../types/query";
import "../../styles/components/admin-message-page.css";

// 统一描边微图标（stroke currentColor）
const strokeIcon = (children: React.ReactNode, size = 15) => (
  <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size}>{children}</svg>
);

const ICON_SEND = strokeIcon(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></>);
const ICON_USERS = strokeIcon(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>);
const ICON_USER = strokeIcon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
const ICON_SHIELD = strokeIcon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
const ICON_BUILDING = strokeIcon(<><rect height="20" rx="2" width="16" x="4" y="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" /></>);
const ICON_SUCCESS = strokeIcon(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></>, 16);
const ICON_ERROR = strokeIcon(<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>, 16);
const ICON_TITLE = strokeIcon(<><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>, 14);
const ICON_EDIT = strokeIcon(<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>, 14);
const ICON_INFO = strokeIcon(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>, 14);
const ICON_RESET = strokeIcon(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>, 14);
const ICON_EYE = strokeIcon(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>, 14);
const ICON_RADIO = strokeIcon(<><circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" /></>, 14);

const SCOPE_OPTIONS: Array<{ value: MessageRecipientScope | "custom"; label: string; hint: string; icon: React.ReactNode }> = [
  { value: "custom", label: "指定员工", hint: "", icon: ICON_USER },
  { value: "all", label: "全部成员", hint: "将发送给绑定了员工档案的全部账号（不含已禁用账号）。", icon: ICON_USERS },
  { value: "managers", label: "全部管理人员", hint: "将发送给全部管理人员账号（不含已禁用账号）。", icon: ICON_SHIELD },
  { value: "employees", label: "全部员工", hint: "将发送给全部员工账号（不含已禁用账号）。", icon: ICON_BUILDING },
];

const PRESET_TAGS = ["【系统通知】", "【考勤提醒】", "【节假日通知】", "【重要公告】", "【温馨提示】"];

export default function AdminMessagesPage() {
  const [recipients, setRecipients] = useState<MessageRecipient[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [scope, setScope] = useState<MessageRecipientScope | "custom">("custom");
  const [form, setForm] = useState({ title: "", content: "" });
  const [previewMode, setPreviewMode] = useState<"popup" | "detail">("popup");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    Promise.all([fetchMessageRecipients(), fetchAdminDepartments()]).then(([nextRecipients, nextDepartments]) => {
      setRecipients(nextRecipients);
      setDepartments(nextDepartments.map((department) => ({ ...department, dept_no: department.dept_no ?? "" })));
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "收件人或部门加载失败")).finally(() => setLoading(false));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("");
    setError("");
    const content = isBlankRichText(form.content) ? "" : form.content;
    if (!content.trim()) {
      setError("消息内容不能为空");
      return;
    }
    const payload = scope === "custom"
      ? {
          recipient_ids: [...new Set(selectedEmployeeIds.flatMap((id) => recipients.find((recipient) => recipient.id === id)?.account_ids ?? []))],
          title: form.title,
          content,
        }
      : { recipient_scope: scope, title: form.title, content };

    setIsSubmitting(true);
    try {
      const result = await sendMessage(payload);
      setSelectedEmployeeIds([]);
      setForm({ title: "", content: "" });
      setStatus(result.created_count ? `已向 ${result.created_count} 人发送消息` : "消息发送成功");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "消息发送失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setSelectedEmployeeIds([]);
    setForm({ title: "", content: "" });
    setError("");
    setStatus("");
  }

  function handleApplyTag(tag: string) {
    setForm((prev) => {
      const cleanTitle = prev.title.replace(/^【.*?】\s*/, "");
      return { ...prev, title: `${tag} ${cleanTitle}`.trim() };
    });
  }

  // 统计受众人数
  const targetSummary = useMemo(() => {
    if (scope === "custom") {
      return {
        count: selectedEmployeeIds.length,
        desc: selectedEmployeeIds.length ? `已选择 ${selectedEmployeeIds.length} 名员工` : "未选择员工",
      };
    }
    if (scope === "all") {
      return { count: recipients.length, desc: `全部有效账号共 ${recipients.length} 人` };
    }
    if (scope === "managers") {
      const mgrCount = recipients.filter((r) => r.is_manager).length;
      return { count: mgrCount, desc: `全部管理人员共 ${mgrCount} 人` };
    }
    if (scope === "employees") {
      const empCount = recipients.filter((r) => !r.is_manager).length;
      return { count: empCount, desc: `全体普通员工共 ${empCount} 人` };
    }
    return { count: 0, desc: "" };
  }, [scope, selectedEmployeeIds, recipients]);

  if (loading) return <LoadingState message="正在加载收件账号..." variant="admin-page" />;
  if (error && !recipients.length) return <ErrorState description={error} title="消息发送页面加载失败" />;

  const pickerEmployees: QueryEmployee[] = recipients.map((recipient) => ({
    id: recipient.id,
    emp_no: recipient.emp_no,
    name: recipient.name,
    dept_id: recipient.dept_id,
    dept_name: recipient.dept_name,
    is_manager: recipient.is_manager,
  }));

  const isFormDirty = Boolean(form.title.trim() || !isBlankRichText(form.content) || selectedEmployeeIds.length > 0);
  const isContentEmpty = isBlankRichText(form.content);

  return (
    <section className="legacy-page-section admin-message-page">
      {/* 页面顶栏 */}
      <header className="legacy-page-header admin-message-header">
        <div className="legacy-page-heading">
          <div className="admin-message-badge-wrap">
            <p className="legacy-page-kicker">系统设置</p>
            <span className="admin-message-pill">广播发布中心</span>
          </div>
          <h2 className="legacy-page-title">
            <span aria-hidden="true" className="admin-message-title-icon">{ICON_SEND}</span>
            发送消息
          </h2>
          <p className="legacy-page-description">
            以系统管理员身份向指定员工、部门或全体成员定向推送站内系统通知与公告。
          </p>
        </div>
      </header>

      {/* 结果提示条 */}
      {error ? (
        <p role="alert" className="admin-message-alert admin-message-alert--error">
          {ICON_ERROR}
          <span>{error}</span>
        </p>
      ) : null}

      {status ? (
        <p role="status" className="admin-message-alert admin-message-alert--success">
          {ICON_SUCCESS}
          <span>{status}</span>
        </p>
      ) : null}

      {/* 双栏专业架构 */}
      <div className="admin-message-layout">
        {/* 左侧主要编撰表单 */}
        <div className="admin-message-main-col">
          <form className="admin-message-form" onSubmit={handleSubmit}>
            {/* 第一分区：确定受众 */}
            <div className="admin-message-section">
              <div className="admin-message-section-title-row">
                <h3>
                  <span aria-hidden="true" className="admin-message-section-icon">{ICON_USERS}</span>
                  选择收件员工
                </h3>
                {scope === "custom" && selectedEmployeeIds.length > 0 && (
                  <span className="admin-message-count-badge">已选择 {selectedEmployeeIds.length} 人</span>
                )}
              </div>

              <div aria-label="发送范围" className="admin-message-scope" role="radiogroup">
                {SCOPE_OPTIONS.map((option) => {
                  const isChecked = scope === option.value;
                  return (
                    <label key={option.value} className={`admin-message-scope-option${isChecked ? " is-checked" : ""}`}>
                      <input
                        checked={isChecked}
                        className="admin-message-scope-radio"
                        name="recipient-scope"
                        onChange={() => setScope(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span aria-hidden="true" className="admin-message-scope-icon">{option.icon}</span>
                      <span className="admin-message-scope-label">{option.label}</span>
                    </label>
                  );
                })}
              </div>

              {scope === "custom" ? (
                <div className="admin-message-picker-container">
                  <EmployeePicker
                    departments={departments}
                    emptyHint="请选择需要接收消息的员工，可多选。"
                    employees={pickerEmployees}
                    label="收件员工"
                    onChange={setSelectedEmployeeIds}
                    selectedIds={selectedEmployeeIds}
                  />
                </div>
              ) : (
                <div className="admin-message-scope-hint">
                  <span aria-hidden="true" className="admin-message-hint-icon">{ICON_INFO}</span>
                  <span>{SCOPE_OPTIONS.find((option) => option.value === scope)?.hint}</span>
                </div>
              )}
            </div>

            {/* 第二分区：消息标题与内容 */}
            <div className="admin-message-section">
              <div className="admin-message-section-title-row">
                <h3>
                  <span aria-hidden="true" className="admin-message-section-icon">{ICON_EDIT}</span>
                  撰写消息内容
                </h3>
              </div>

              {/* 常用分类快捷标签 */}
              <div className="admin-message-quick-tags">
                <span className="admin-message-quick-tags-label">快速分类：</span>
                <div className="admin-message-quick-tags-list">
                  {PRESET_TAGS.map((tag) => (
                    <button
                      key={tag}
                      className="admin-message-quick-tag-btn"
                      onClick={() => handleApplyTag(tag)}
                      type="button"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* 消息标题输入框 */}
              <div className="admin-message-field-wrap">
                <label className="admin-message-field">
                  <div className="admin-message-field-header">
                    <span className="admin-message-field-label">
                      <span aria-hidden="true" className="admin-message-field-icon">{ICON_TITLE}</span>
                      消息标题
                      <span className="admin-message-required-star">*</span>
                    </span>
                    <span className="admin-message-char-count">{form.title.length}/120</span>
                  </div>
                  <input
                    aria-label="消息标题"
                    maxLength={120}
                    placeholder="请输入简明醒目的消息标题（如：【考勤提醒】本周五截点通知）..."
                    required
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    value={form.title}
                  />
                </label>
              </div>

              {/* 富文本编辑器 */}
              <div className="admin-message-editor">
                <div className="admin-message-field-header">
                  <label htmlFor="message-editor" className="admin-message-field-label">
                    <span aria-hidden="true" className="admin-message-field-icon">{ICON_EDIT}</span>
                    消息内容
                    <span className="admin-message-required-star">*</span>
                  </label>
                  <span className="admin-message-editor-hint">支持粗体、列表、超链接等富文本排版</span>
                </div>
                <RichTextEditor
                  ariaLabel="消息内容"
                  onChange={(html) => setForm({ ...form, content: html })}
                  value={form.content}
                />
              </div>
            </div>

            {/* 第三分区：操作发布栏 */}
            <div className="admin-message-actions-bar">
              <div className="admin-message-actions-left">
                <button
                  className="admin-message-submit"
                  disabled={isSubmitting || (scope === "custom" && !selectedEmployeeIds.length)}
                  type="submit"
                >
                  <span aria-hidden="true" className={isSubmitting ? "admin-message-spinner" : ""}>
                    {ICON_SEND}
                  </span>
                  <span>{isSubmitting ? "正在发送..." : "发送消息"}</span>
                </button>
                {isFormDirty && (
                  <button
                    className="admin-message-reset-btn"
                    onClick={handleReset}
                    type="button"
                  >
                    <span aria-hidden="true">{ICON_RESET}</span>
                    <span>清空重填</span>
                  </button>
                )}
              </div>
              <p className="admin-message-actions-tip">
                消息发送后将即时推送到收件人顶栏消息中心
              </p>
            </div>
          </form>
        </div>

        {/* 右侧：专业即时收件模拟器 & 洞察卡片 */}
        <aside className="admin-message-side-col">
          {/* 实时模拟器 */}
          <div className="admin-message-preview-card">
            <div className="admin-message-preview-header">
              <div className="admin-message-preview-title">
                <span aria-hidden="true">{ICON_EYE}</span>
                <strong>收件人视角模拟</strong>
              </div>
              <div className="admin-message-preview-tabs">
                <button
                  className={`admin-message-preview-tab${previewMode === "popup" ? " is-active" : ""}`}
                  onClick={() => setPreviewMode("popup")}
                  type="button"
                >
                  消息卡片
                </button>
                <button
                  className={`admin-message-preview-tab${previewMode === "detail" ? " is-active" : ""}`}
                  onClick={() => setPreviewMode("detail")}
                  type="button"
                >
                  正文详情
                </button>
              </div>
            </div>

            <div className="admin-message-preview-body">
              {previewMode === "popup" ? (
                /* 顶栏消息浮窗效果仿真 */
                <div className="admin-message-sim-popup">
                  <div className="admin-message-sim-popup-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </div>
                  <div className="admin-message-sim-popup-content">
                    <div className="admin-message-sim-popup-title-row">
                      <strong className="admin-message-sim-popup-title">
                        {form.title.trim() || "（请输入消息标题）"}
                      </strong>
                      <span className="admin-message-sim-dot" />
                      <span className="admin-message-sim-time">刚刚</span>
                    </div>
                    <p className="admin-message-sim-popup-text">
                      {!isContentEmpty
                        ? htmlToTextPreview(form.content)
                        : "（输入消息正文后在此实时生成纯文本摘要...）"}
                    </p>
                    <div className="admin-message-sim-popup-footer">
                      <small>系统管理员</small>
                    </div>
                  </div>
                </div>
              ) : (
                /* 详情页效果仿真 */
                <div className="admin-message-sim-detail">
                  <div className="admin-message-sim-detail-heading">
                    <h4 className="admin-message-sim-detail-title">
                      {form.title.trim() || "（请输入消息标题）"}
                    </h4>
                    <div className="admin-message-sim-detail-meta">
                      <span>系统管理员</span>
                      <span>{new Date().toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div
                    className="admin-message-sim-detail-body"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        !isContentEmpty
                          ? form.content
                          : '<p class="admin-message-sim-empty-placeholder">（富文本正文排版效果预览区...）</p>'
                      ),
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 投递规模洞察卡 */}
          <div className="admin-message-insights-card">
            <div className="admin-message-insights-title">
              <span aria-hidden="true">{ICON_RADIO}</span>
              <strong>发布配置概览</strong>
            </div>

            <div className="admin-message-insights-list">
              <div className="admin-message-insights-item">
                <span className="insights-label">发送范围：</span>
                <span className="insights-value">
                  {SCOPE_OPTIONS.find((opt) => opt.value === scope)?.label}
                </span>
              </div>
              <div className="admin-message-insights-item">
                <span className="insights-label">受众预估：</span>
                <span className="insights-value insights-value--highlight">
                  {targetSummary.desc}
                </span>
              </div>
              <div className="admin-message-insights-item">
                <span className="insights-label">发布凭据：</span>
                <span className="insights-value">系统管理员（站内信）</span>
              </div>
              <div className="admin-message-insights-item">
                <span className="insights-label">草稿状态：</span>
                <span className={`insights-status-tag${form.title.trim() && !isContentEmpty ? " is-ready" : ""}`}>
                  {form.title.trim() && !isContentEmpty ? "就绪可发送" : "草稿编写中"}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
