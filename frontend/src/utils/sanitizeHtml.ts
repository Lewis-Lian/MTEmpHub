import DOMPurify from "dompurify";

// 消息正文为富文本 HTML，渲染前必须消毒以拦截脚本注入
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
