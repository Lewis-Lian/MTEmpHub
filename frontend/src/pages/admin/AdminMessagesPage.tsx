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

const SCOPE_OPTIONS: Array<{ value: MessageRecipientScope | "custom"; label: string; hint: string }> = [
  { value: "custom", label: "指定员工", hint: "" },
  { value: "all", label: "全部成员", hint: "将发送给绑定了员工档案的全部账号（不含已禁用账号）。" },
  { value: "managers", label: "全部管理人员", hint: "将发送给全部管理人员账号（不含已禁用账号）。" },
  { value: "employees", label: "全部员工", hint: "将发送给全部员工账号（不含已禁用账号）。" },
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
    <header className="legacy-page-header"><div className="legacy-page-heading"><p className="legacy-page-kicker">系统设置</p><h2 className="legacy-page-title">发送消息</h2><p className="legacy-page-description">以系统管理员身份向任意账户发送站内消息。</p></div></header>
    {error ? <p role="alert" className="message-center-error">{error}</p> : null}
    {status ? <p role="status" className="admin-message-status">{status}</p> : null}
    <form className="admin-message-form" onSubmit={handleSubmit}>
      <div className="admin-message-section"><h3>选择收件员工</h3><div aria-label="发送范围" className="admin-message-scope" role="radiogroup">{SCOPE_OPTIONS.map((option) => <label key={option.value}><input checked={scope === option.value} name="recipient-scope" onChange={() => setScope(option.value)} type="radio" value={option.value} />{option.label}</label>)}</div>{scope === "custom" ? <EmployeePicker departments={departments} emptyHint="请选择需要接收消息的员工，可多选。" employees={pickerEmployees} label="收件员工" onChange={setSelectedEmployeeIds} selectedIds={selectedEmployeeIds} /> : <p className="admin-message-scope-hint">{SCOPE_OPTIONS.find((option) => option.value === scope)?.hint}</p>}</div>
      <label>消息标题<input aria-label="消息标题" maxLength={120} required onChange={(event) => setForm({ ...form, title: event.target.value })} value={form.title} /></label>
      <div className="admin-message-editor"><label htmlFor="message-editor">消息内容</label><RichTextEditor ariaLabel="消息内容" onChange={(html) => setForm({ ...form, content: html })} value={form.content} /></div>
      <button className="admin-message-submit" disabled={scope === "custom" && !selectedEmployeeIds.length} type="submit"><span aria-hidden="true">➤</span> 发送消息</button>
    </form>
  </section>;
}
