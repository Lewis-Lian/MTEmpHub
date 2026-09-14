import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMessages, markMessageRead, type MessageItem } from "../../api/messages";
import { htmlToTextPreview } from "../../utils/richText";
import "../../styles/components/message-center.css";

export default function MessageCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function refreshMessages() {
    await fetchMessages().then((payload) => {
      setMessages(payload.messages);
      setUnreadCount(payload.unread_count);
    }).catch(() => setError("消息加载失败"));
  }

  useEffect(() => {
    void refreshMessages();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshMessages();
  }, [isOpen]);

  async function handleRead(message: MessageItem) {
    if (!message.unread) return;
    await markMessageRead(message.id);
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, unread: false } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
  }

  function openMessage(message: MessageItem) {
    setIsOpen(false);
    void handleRead(message);
    navigate(`/employee/messages/${message.id}`);
  }

  return <div className="message-center">
    <button aria-label={`消息${unreadCount ? `，${unreadCount}条未读` : ""}`} className="app-header-icon-btn message-center-trigger" onClick={() => setIsOpen((current) => !current)} title="消息" type="button">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {unreadCount > 0 ? <span className="message-center-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
    </button>
    {isOpen ? <section aria-label="消息中心" className="message-center-panel">
      <div className="message-center-heading"><strong>消息中心</strong><button onClick={() => setIsOpen(false)} type="button">×</button></div>
      {error ? <p className="message-center-error">{error}</p> : null}
      <div className="message-center-list">{messages.length ? messages.map((message) => <article className={message.unread ? "is-unread" : ""} key={message.id} onClick={() => openMessage(message)}><div><strong>{message.title}</strong>{message.unread ? <span className="message-center-dot" /> : null}</div><p>{htmlToTextPreview(message.content)}</p><small>{message.sender}</small></article>) : <p className="message-center-empty">暂无消息</p>}</div>
    </section> : null}
  </div>;
}
