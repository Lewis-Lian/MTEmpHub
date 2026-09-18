import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { fetchMessages, markMessageRead, type MessageItem } from "../../api/messages";
import { htmlToTextPreview } from "../../utils/richText";
import "../../styles/components/message-center.css";

export type MessageCategory = "announcement" | "attendance" | "holiday" | "reminder" | "system";

export interface MessageMeta {
  category: MessageCategory;
  categoryLabel: string;
  tag?: string;
}

export function parseMessageMeta(title: string): MessageMeta {
  const cleanTitle = title.trim();

  // 1. 重要公告 / 公告
  if (
    cleanTitle.includes("【重要公告】") ||
    cleanTitle.includes("【公告】") ||
    cleanTitle.includes("公告") ||
    cleanTitle.includes("重要通告")
  ) {
    const tagMatch = cleanTitle.match(/^【(.*?)】/);
    return {
      category: "announcement",
      categoryLabel: "重要公告",
      tag: tagMatch ? tagMatch[1] : undefined,
    };
  }

  // 2. 考勤提醒
  if (
    cleanTitle.includes("【考勤提醒】") ||
    cleanTitle.includes("考勤") ||
    cleanTitle.includes("打卡") ||
    cleanTitle.includes("加班") ||
    cleanTitle.includes("漏打卡")
  ) {
    const tagMatch = cleanTitle.match(/^【(.*?)】/);
    return {
      category: "attendance",
      categoryLabel: "考勤提醒",
      tag: tagMatch ? tagMatch[1] : undefined,
    };
  }

  // 3. 节假日通知
  if (
    cleanTitle.includes("【节假日通知】") ||
    cleanTitle.includes("节假日") ||
    cleanTitle.includes("放假") ||
    cleanTitle.includes("调休")
  ) {
    const tagMatch = cleanTitle.match(/^【(.*?)】/);
    return {
      category: "holiday",
      categoryLabel: "节假日通知",
      tag: tagMatch ? tagMatch[1] : undefined,
    };
  }

  // 4. 温馨提示
  if (
    cleanTitle.includes("【温馨提示】") ||
    cleanTitle.includes("温馨提示") ||
    cleanTitle.includes("贴心提醒")
  ) {
    const tagMatch = cleanTitle.match(/^【(.*?)】/);
    return {
      category: "reminder",
      categoryLabel: "温馨提示",
      tag: tagMatch ? tagMatch[1] : undefined,
    };
  }

  // 5. 系统通知 / 默认
  const tagMatch = cleanTitle.match(/^【(.*?)】/);
  return {
    category: "system",
    categoryLabel: "系统通知",
    tag: tagMatch ? tagMatch[1] : undefined,
  };
}

function CategoryIcon({ category }: { category: MessageCategory }) {
  switch (category) {
    case "announcement":
      // 广播大喇叭图标
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l18-5v12L3 13v-2z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      );
    case "attendance":
      // 时钟考勤图标
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "holiday":
      // 节日日历图标
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "reminder":
      // 提示灯泡图标
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="7" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
        </svg>
      );
    case "system":
    default:
      // 系统铃铛图标
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
      );
  }
}

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

      <AnimatePresence>
        {isOpen && (
          <motion.section
            animate={{ opacity: 1, scale: 1, y: 0 }}
            aria-label="消息中心"
            className="message-center-panel"
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* 弹窗头部 */}
            <div className="message-center-heading">
              <div className="message-center-heading-left">
                <div className="message-center-heading-title-wrap">
                  <span className="message-center-heading-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                    </svg>
                  </span>
                  <strong>消息中心</strong>
                </div>
                {unreadCount > 0 ? (
                  <span className="message-center-count-pill">{unreadCount} 未读</span>
                ) : (
                  <span className="message-center-count-pill is-all-read">已全读</span>
                )}
              </div>
              <div className="message-center-heading-actions">
                {unreadCount > 0 && (
                  <button
                    aria-label="一键全部已读"
                    className="message-center-quick-read-btn"
                    disabled={markingAll}
                    onClick={handleMarkAllRead}
                    title="一键全部已读"
                    type="button"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{markingAll ? "处理中" : "已读"}</span>
                  </button>
                )}
                <button
                  aria-label="关闭"
                  className="message-center-close"
                  onClick={() => setIsOpen(false)}
                  title="关闭 (Esc)"
                  type="button"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="3" x2="13" y2="13" />
                    <line x1="13" y1="3" x2="3" y2="13" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 选项卡筛选 */}
            <div className="message-center-tabs">
              <div className="message-center-tab-segment" role="tablist" aria-label="消息分类">
                <button
                  aria-selected={activeTab === "all"}
                  className={`message-center-tab${activeTab === "all" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("all")}
                  role="tab"
                  type="button"
                >
                  <span>全部</span>
                  <span className="message-center-tab-count">{messages.length}</span>
                </button>
                <button
                  aria-selected={activeTab === "unread"}
                  className={`message-center-tab${activeTab === "unread" ? " is-active" : ""}`}
                  onClick={() => setActiveTab("unread")}
                  role="tab"
                  type="button"
                >
                  <span>未读</span>
                  {unreadCount > 0 && (
                    <span className="message-center-tab-unread-count">{unreadCount}</span>
                  )}
                </button>
              </div>
            </div>

            {error ? <p className="message-center-error">{error}</p> : null}

            {/* 消息列表 */}
            <div className="message-center-list">
              {displayedMessages.length ? (
                displayedMessages.map((message) => {
                  const meta = parseMessageMeta(message.title);
                  const timeText = formatMessageTime(message.created_at);
                  return (
                    <article
                      className={`message-center-card${message.unread ? " is-unread" : ""} message-card-${meta.category}`}
                      key={message.id}
                      onClick={() => openMessage(message)}
                    >
                      <div className={`message-center-type-badge message-badge-${meta.category}${message.unread ? " is-unread" : ""}`}>
                        <CategoryIcon category={meta.category} />
                      </div>

                      <div className="message-center-item-content">
                        <div className="message-center-item-title-row">
                          {meta.tag && (
                            <span className={`message-center-tag-badge tag-${meta.category}`}>
                              {meta.tag}
                            </span>
                          )}
                          <strong className="message-center-title">{message.title}</strong>
                          {message.unread ? <span className="message-center-dot" title="未读消息" /> : null}
                          {timeText && <span className="message-center-item-time">{timeText}</span>}
                        </div>

                        <p className="message-center-preview">{htmlToTextPreview(message.content)}</p>

                        <div className="message-center-item-footer">
                          <small className="message-center-sender">
                            <span className="message-center-sender-icon">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                              </svg>
                            </span>
                            <span>{message.sender}</span>
                          </small>
                          <span className="message-center-view-hint">
                            <span>详情</span>
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 12 10 8 6 4" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="message-center-empty-state">
                  <div className="message-center-empty-icon-wrap">
                    <div className="message-center-empty-halo" />
                    <div className="message-center-empty-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                        <path d="m16 19 2 2 4-4" />
                      </svg>
                    </div>
                  </div>
                  <p className="message-center-empty">
                    {activeTab === "unread" ? "暂无未读公告或消息" : "暂无系统通知公告"}
                  </p>
                  <span className="message-center-empty-hint">所有系统消息与公告已全部处理完毕</span>
                </div>
              )}
            </div>

            {/* 弹窗底部操作 */}
            {messages.length > 0 && (
              <div className="message-center-panel-footer">
                <span className="message-center-footer-summary">
                  共 {messages.length} 条通知记录
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
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
