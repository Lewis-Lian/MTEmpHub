import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchMessage, markMessageRead, type MessageItem } from "../../api/messages";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";
import { sanitizeHtml } from "../../utils/sanitizeHtml";
import "../../styles/components/message-detail-page.css";

export default function MessageDetailPage() {
  const { id } = useParams();
  const messageId = Number(id);
  const [message, setMessage] = useState<MessageItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Number.isInteger(messageId)) {
      setError("消息不存在");
      setLoading(false);
      return;
    }
    fetchMessage(messageId)
      .then((loaded) => {
        setMessage(loaded);
        if (loaded.unread) void markMessageRead(loaded.id).catch(() => undefined);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "消息加载失败"))
      .finally(() => setLoading(false));
  }, [messageId]);

  if (loading) return <LoadingState message="正在加载消息..." variant="admin-page" />;
  if (error) return <ErrorState description={error} title="消息加载失败" />;

  return message ? <section className="legacy-page-section message-detail-page">
    <article className="message-detail-card">
      <header className="message-detail-heading">
        <h2 className="message-detail-title">{message.title}</h2>
        <p className="message-detail-meta"><span>{message.sender}</span><span>{message.created_at.replace("T", " ")}</span></p>
      </header>
      <div aria-label="消息正文" className="message-detail-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} />
    </article>
  </section> : null;
}
