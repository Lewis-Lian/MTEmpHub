import { useEffect, useState } from "react";
import { fetchMessageRecipients, sendMessage, type MessageRecipient } from "../../api/messages";
import { fetchAdminDepartments } from "../../api/admin";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import EmployeePicker from "../../components/query/EmployeePicker";
import RichTextEditor from "../../components/editor/RichTextEditor";
import { isBlankRichText } from "../../utils/richText";
import type { DepartmentOption, QueryEmployee } from "../../types/query";
import "../../styles/components/admin-message-page.css";

export default function AdminMessagesPage() {
  const [recipients, setRecipients] = useState<MessageRecipient[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
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
    const content = isBlankRichText(form.content) ? "" : form.content;
    if (!content.trim()) {
      setError("消息内容不能为空");
      return;
    }
    try {
      const accountIds = [...new Set(selectedEmployeeIds.flatMap((id) => recipients.find((recipient) => recipient.id === id)?.account_ids ?? []))];
      await sendMessage({ recipient_ids: accountIds, title: form.title, content });
      setSelectedEmployeeIds([]);
      setForm({ title: "", content: "" });
      setStatus("消息发送成功");
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
      <div className="admin-message-section"><h3>选择收件员工</h3><EmployeePicker departments={departments} emptyHint="请选择需要接收消息的员工，可多选。" employees={pickerEmployees} label="收件员工" onChange={setSelectedEmployeeIds} selectedIds={selectedEmployeeIds} /></div>
      <label>消息标题<input aria-label="消息标题" maxLength={120} required onChange={(event) => setForm({ ...form, title: event.target.value })} value={form.title} /></label>
      <div className="admin-message-editor"><label htmlFor="message-editor">消息内容</label><RichTextEditor ariaLabel="消息内容" onChange={(html) => setForm({ ...form, content: html })} value={form.content} /></div>
      <button className="admin-message-submit" disabled={!selectedEmployeeIds.length} type="submit"><span aria-hidden="true">➤</span> 发送消息</button>
    </form>
  </section>;
}
