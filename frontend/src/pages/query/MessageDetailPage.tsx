import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchMessage, markMessageRead, type MessageItem } from "../../api/messages";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import "../../styles/components/message-detail-page.css";

// 描边微图标 helper
const strokeIcon = (children: React.ReactNode, size = 15) => (
  <svg
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width={size}
  >
    {children}
  </svg>
);

const ICON_ARROW_LEFT = strokeIcon(<polyline points="15 18 9 12 15 6" />, 14);
const ICON_BELL = strokeIcon(
  <>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </>,
  14
);
const ICON_USER = strokeIcon(
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
  14
);
const ICON_CLOCK = strokeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>,
  14
);
const ICON_SHIELD = strokeIcon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />, 14);
const ICON_PRINT = strokeIcon(
  <>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect height="8" width="12" x="6" y="14" />
  </>,
  14
);
const ICON_COPY = strokeIcon(
  <>
    <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
  14
);
const ICON_CHECK = strokeIcon(<polyline points="20 6 9 17 4 12" />, 14);
const ICON_INFO = strokeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </>,
  14
);

export default function MessageDetailPage() {
  const { id: paramId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // 兼顾 RouteContext 注入与多标签页直接挂载场景
  const idFromPath = location.pathname.match(/\/employee\/messages\/(\d+)/)?.[1];
  const messageId = Number(paramId || idFromPath);

  const [message, setMessage] = useState<MessageItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(messageId) || messageId <= 0) {
      setError("消息不存在");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchMessage(messageId)
      .then((loaded) => {
        setMessage(loaded);
        setError("");
        if (loaded?.unread) void markMessageRead(loaded.id).catch(() => undefined);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "消息加载失败"))
      .finally(() => setLoading(false));
  }, [messageId]);

  const handleCopy = () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(window.location.href);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 容错处理
    }
  };

  const handlePrint = () => {
    if (typeof window !== "undefined" && window.print) {
      window.print();
    }
  };

  if (loading) return <LoadingState message="正在加载消息..." variant="admin-page" />;
  if (error) return <ErrorState description={error} title="消息加载失败" />;
  if (!message) return <ErrorState description="未找到指定消息详情" title="消息不存在" />;

  const formattedTime = message.created_at ? message.created_at.replace("T", " ") : "";

  return (
    <section className="legacy-page-section message-detail-page">
      {/* 顶部通栏导航及操作工具条 */}
      <div className="message-detail-toolbar">
        <div className="message-detail-toolbar-left">
          <button
            className="message-detail-back-btn"
            onClick={() => navigate(-1)}
            type="button"
            title="返回上一页"
          >
            <span className="message-detail-btn-icon">{ICON_ARROW_LEFT}</span>
            <span>返回</span>
          </button>
          <div className="message-detail-breadcrumbs">
            <span className="message-detail-crumb">员工中心</span>
            <span className="message-detail-separator">/</span>
            <span className="message-detail-crumb">站内消息</span>
            <span className="message-detail-separator">/</span>
            <span className="message-detail-crumb is-current">详情</span>
          </div>
          <span className="message-detail-channel-badge">
            <span className="message-detail-badge-icon">{ICON_BELL}</span>
            <span>站内消息</span>
          </span>
          <span className="message-detail-status-pill">
            <span className="message-detail-status-dot" />
            <span>已读</span>
          </span>
        </div>

        <div className="message-detail-toolbar-right">
          <button
            className="message-detail-action-btn"
            onClick={handleCopy}
            type="button"
            title="复制本页链接"
          >
            <span className="message-detail-btn-icon">
              {copied ? ICON_CHECK : ICON_COPY}
            </span>
            <span>{copied ? "已复制链接" : "复制链接"}</span>
          </button>
          <button
            className="message-detail-action-btn"
            onClick={handlePrint}
            type="button"
            title="打印或另存为 PDF"
          >
            <span className="message-detail-btn-icon">{ICON_PRINT}</span>
            <span>打印</span>
          </button>
          <span className="message-detail-id-chip">#{message.id}</span>
        </div>
      </div>

      {/* 主体两栏布局：左侧阅读主体 + 右侧信息面板 */}
      <div className="message-detail-layout">
        {/* 左侧主卡片：消息内容与排版 */}
        <article className="message-detail-card">
          <header className="message-detail-heading">
            <div className="message-detail-kicker-row">
              <span className="message-detail-kicker">OFFICIAL NOTIFICATION</span>
              <span className="message-detail-type-pill">企业通知</span>
            </div>
            <h2 className="message-detail-title">{message.title}</h2>
            <div className="message-detail-meta">
              <span className="message-meta-item message-meta-sender">
                <span className="message-meta-icon">{ICON_USER}</span>
                <span>{message.sender}</span>
              </span>
              <span className="message-meta-item message-meta-time">
                <span className="message-meta-icon">{ICON_CLOCK}</span>
                <span>{formattedTime}</span>
              </span>
              <span className="message-meta-item message-meta-security">
                <span className="message-meta-icon">{ICON_SHIELD}</span>
                <span>企业安全通道</span>
              </span>
            </div>
          </header>

          <div
            aria-label="消息正文"
            className="message-detail-body"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }}
          />

          <footer className="message-detail-card-footer">
            <div className="message-detail-footer-security">
              <span className="message-detail-footer-icon">{ICON_SHIELD}</span>
              <span>此消息由 MTEmpHub 企业办公内网安全加密通道校验送达</span>
            </div>
            <div className="message-detail-footer-note">
              若对通知内容、考勤核算有任何疑问，请联系相关发件部门或系统管理人员。
            </div>
          </footer>
        </article>

        {/* 右侧边栏：属性概览与安全合规提示 */}
        <aside className="message-detail-sidebar">
          <div className="message-sidebar-card">
            <div className="message-sidebar-header">
              <span className="message-sidebar-icon">{ICON_INFO}</span>
              <h3 className="message-sidebar-title">消息概览</h3>
            </div>
            <dl className="message-sidebar-dl">
              <div className="message-sidebar-row">
                <dt>消息编号</dt>
                <dd className="message-sidebar-code">MSG-{String(message.id).padStart(6, "0")}</dd>
              </div>
              <div className="message-sidebar-row">
                <dt>发件渠道</dt>
                <dd>系统广播信道</dd>
              </div>
              <div className="message-sidebar-row">
                <dt>接收状态</dt>
                <dd className="message-sidebar-status-ok">已阅读确认</dd>
              </div>
              <div className="message-sidebar-row">
                <dt>发布时间</dt>
                <dd>{formattedTime || "实时推送"}</dd>
              </div>
              <div className="message-sidebar-row">
                <dt>内容安全</dt>
                <dd>XSS 审计已通过</dd>
              </div>
            </dl>
          </div>

          <div className="message-sidebar-card message-sidebar-tips-card">
            <div className="message-sidebar-header">
              <span className="message-sidebar-icon">{ICON_SHIELD}</span>
              <h3 className="message-sidebar-title">保密与合规</h3>
            </div>
            <p className="message-sidebar-tip-text">
              本系统消息面向企业内部员工开放，请勿向未经授权人员转发或公开。涉及放假排班、薪酬考勤等核心事项，请以公司正式文件为准。
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

