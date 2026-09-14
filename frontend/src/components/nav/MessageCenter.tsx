import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMessages, markMessageRead, type MessageItem } from "../../api/messages";
import { htmlToTextPreview } from "../../utils/richText";
import "../../styles/components/message-center.css";

function formatMessageTime(isoString?: string): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString.replace("T", " ").slice(0, 16);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24 && date.getDate() === now.getDate()) {
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
  } catch {
    return isoString.replace("T", " ").slice(0, 16);
  }
}

export default function MessageCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");
  const [markingAll, setMarkingAll] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  async function refreshMessages() {
    await fetchMessages().then((payload) => {
      setMessages(payload.messages);
      setUnreadCount(payload.unread_count);
      setError("");
    }).catch(() => setError("消息加载失败"));
  }

  useEffect(() => {
    void refreshMessages();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshMessages();
  }, [isOpen]);

  // 点击外部区域或按下 ESC 键关闭弹窗
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleRead(message: MessageItem) {
    if (!message.unread) return;
    await markMessageRead(message.id);
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, unread: false } : item));
    setUnreadCount((current) => Math.max(0, current - 1));
  }

  async function handleMarkAllRead() {
    const unreadList = messages.filter((m) => m.unread);
    if (!unreadList.length || markingAll) return;
    setMarkingAll(true);
    try {
      await Promise.allSettled(unreadList.map((m) => markMessageRead(m.id)));
      setMessages((current) => current.map((item) => ({ ...item, unread: false })));
      setUnreadCount(0);
    } finally {
      setMarkingAll(false);
    }
  }

  function openMessage(message: MessageItem) {
    setIsOpen(false);
    void handleRead(message);
    navigate(`/employee/messages/${message.id}`);
  }

  const displayedMessages = activeTab === "unread"
    ? messages.filter((m) => m.unread)
    : messages;

  return (
    <div className="message-center" ref={containerRef}>
      <button
        aria-label={`消息${unreadCount ? `，${unreadCount}条未读` : ""}`}
        className={`app-header-icon-btn message-center-trigger${isOpen ? " is-active" : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        title="消息通知"
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unreadCount > 0 ? (
          <span className="message-center-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section aria-label="消息中心" className="message-center-panel">
          {/* 弹窗头部 */}
          <div className="message-center-heading">
            <div className="message-center-heading-left">
              <strong>消息中心</strong>
              {unreadCount > 0 && (
                <span className="message-center-count-pill">{unreadCount} 未读</span>
              )}
            </div>
            <button
              aria-label="关闭"
              className="message-center-close"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="3" x2="13" y2="13" />
                <line x1="13" y1="3" x2="3" y2="13" />
              </svg>
            </button>
          </div>

          {/* 选项卡筛选 */}
          <div className="message-center-tabs">
            <button
              className={`message-center-tab${activeTab === "all" ? " is-active" : ""}`}
              onClick={() => setActiveTab("all")}
              type="button"
            >
              全部
              <span className="message-center-tab-count">{messages.length}</span>
            </button>
            <button
              className={`message-center-tab${activeTab === "unread" ? " is-active" : ""}`}
              onClick={() => setActiveTab("unread")}
              type="button"
            >
              未读
              {unreadCount > 0 && (
                <span className="message-center-tab-unread-count">{unreadCount}</span>
              )}
            </button>
          </div>

          {error ? <p className="message-center-error">{error}</p> : null}

          {/* 消息列表 */}
          <div className="message-center-list">
            {displayedMessages.length ? (
              displayedMessages.map((message) => {
                const timeText = formatMessageTime(message.created_at);
                return (
                  <article
                    className={message.unread ? "is-unread" : ""}
                    key={message.id}
                    onClick={() => openMessage(message)}
                  >
                    <div className="message-center-item-icon-col">
                      <div className={`message-center-type-badge${message.unread ? " is-unread" : ""}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="20" height="16" x="2" y="4" rx="2" />
                          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                        </svg>
                      </div>
                    </div>

                    <div className="message-center-item-content">
                      <div className="message-center-item-title-row">
                        <strong className="message-center-title">{message.title}</strong>
                        {message.unread ? <span className="message-center-dot" /> : null}
                        {timeText && <span className="message-center-item-time">{timeText}</span>}
                      </div>

                      <p className="message-center-preview">{htmlToTextPreview(message.content)}</p>

                      <div className="message-center-item-footer">
                        <small className="message-center-sender">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <span>{message.sender}</span>
                        </small>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="message-center-empty-state">
                <div className="message-center-empty-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    <path d="m16 19 2 2 4-4" />
                  </svg>
                </div>
                <p className="message-center-empty">
                  {activeTab === "unread" ? "暂无未读消息" : "暂无消息"}
                </p>
                <span className="message-center-empty-hint">所有系统消息已全部处理完毕</span>
              </div>
            )}
          </div>

          {/* 弹窗底部操作 */}
          {messages.length > 0 && (
            <div className="message-center-panel-footer">
              <span className="message-center-footer-summary">
                共 {messages.length} 条消息
              </span>
              {unreadCount > 0 && (
                <button
                  className="message-center-mark-all-btn"
                  disabled={markingAll}
                  onClick={handleMarkAllRead}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{markingAll ? "处理中..." : "全部标为已读"}</span>
                </button>
              )}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
