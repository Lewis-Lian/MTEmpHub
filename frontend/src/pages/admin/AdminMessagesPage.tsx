import { useEffect, useState } from "react";
import { fetchMessageRecipients, sendMessage, type MessageRecipient, type MessageRecipientScope } from "../../api/messages";
import { fetchAdminDepartments } from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import EmployeePicker from "../../components/query/EmployeePicker";
import RichTextEditor from "../../components/editor/RichTextEditor";
import { isBlankRichText } from "../../utils/richText";
import type { DepartmentOption, QueryEmployee } from "../../types/query";
import "../../styles/components/admin-message-page.css";

// 统一描边风格小图标（stroke currentColor），仅作视觉点缀。
const strokeIcon = (children: React.ReactNode) => (
  <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15">{children}</svg>
);

const ICON_SEND = strokeIcon(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></>);
const ICON_USERS = strokeIcon(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>);
const ICON_USER = strokeIcon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
const ICON_SHIELD = strokeIcon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
const ICON_BUILDING = strokeIcon(<><rect height="20" rx="2" width="16" x="4" y="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" /></>);
const ICON_SUCCESS = strokeIcon(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></>);
const ICON_ERROR = strokeIcon(<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>);

const SCOPE_OPTIONS: Array<{ value: MessageRecipientScope | "custom"; label: string; hint: string; icon: React.ReactNode }> = [
  { value: "custom", label: "指定员工", hint: "", icon: ICON_USER },
  { value: "all", label: "全部成员", hint: "将发送给绑定了员工档案的全部账号（不含已禁用账号）。", icon: ICON_USERS },
  { value: "managers", label: "全部管理人员", hint: "将发送给全部管理人员账号（不含已禁用账号）。", icon: ICON_SHIELD },
  { value: "employees", label: "全部员工", hint: "将发送给全部员工账号（不含已禁用账号）。", icon: ICON_BUILDING },
];

export default function AdminMessagesPage() {
  const [recipients, setRecipients] = useState<MessageRecipient[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [scope, setScope] = useState<MessageRecipientScope | "custom">("custom");
  const [form, setForm] = useState({ title: "", content: "" });
  const [loading, setLoading] = useState(true);
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
    try {
      const result = await sendMessage(payload);
      setSelectedEmployeeIds([]);
      setForm({ title: "", content: "" });
      setStatus(result.created_count ? `已向 ${result.created_count} 人发送消息` : "消息发送成功");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "消息发送失败");
    }
  }

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

  return <section className="legacy-page-section admin-message-page">
    <header className="legacy-page-header admin-message-header"><div className="legacy-page-heading"><p className="legacy-page-kicker">系统设置</p><h2 className="legacy-page-title"><span aria-hidden="true" className="admin-message-title-icon">{ICON_SEND}</span>发送消息</h2><p className="legacy-page-description">以系统管理员身份向任意账户发送站内消息。</p></div></header>
    {error ? <p role="alert" className="admin-message-alert admin-message-alert--error">{ICON_ERROR}{error}</p> : null}
    {status ? <p role="status" className="admin-message-alert admin-message-alert--success">{ICON_SUCCESS}{status}</p> : null}
    <form className="admin-message-form" onSubmit={handleSubmit}>
      <div className="admin-message-section"><h3><span aria-hidden="true" className="admin-message-section-icon">{ICON_USERS}</span>选择收件员工</h3><div aria-label="发送范围" className="admin-message-scope" role="radiogroup">{SCOPE_OPTIONS.map((option) => <label key={option.value} className="admin-message-scope-option"><input checked={scope === option.value} className="admin-message-scope-radio" name="recipient-scope" onChange={() => setScope(option.value)} type="radio" value={option.value} /><span aria-hidden="true" className="admin-message-scope-icon">{option.icon}</span>{option.label}</label>)}</div>{scope === "custom" ? <EmployeePicker departments={departments} emptyHint="请选择需要接收消息的员工，可多选。" employees={pickerEmployees} label="收件员工" onChange={setSelectedEmployeeIds} selectedIds={selectedEmployeeIds} /> : <p className="admin-message-scope-hint">{SCOPE_OPTIONS.find((option) => option.value === scope)?.hint}</p>}</div>
      <label className="admin-message-field">消息标题<input aria-label="消息标题" maxLength={120} required onChange={(event) => setForm({ ...form, title: event.target.value })} value={form.title} /></label>
      <div className="admin-message-editor"><label htmlFor="message-editor">消息内容</label><RichTextEditor ariaLabel="消息内容" onChange={(html) => setForm({ ...form, content: html })} value={form.content} /></div>
      <button className="admin-message-submit" disabled={scope === "custom" && !selectedEmployeeIds.length} type="submit"><span aria-hidden="true">{ICON_SEND}</span> 发送消息</button>
    </form>
  </section>;
}
