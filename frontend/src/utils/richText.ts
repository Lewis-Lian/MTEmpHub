const PREVIEW_MAX_LENGTH = 120;
const BLANK_MEDIA_TAGS = ["img", "video", "audio", "iframe"];

function parseHtmlBody(html: string): HTMLElement {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body;
}

// 消息 content 存的是富文本 HTML；列表预览需要纯文本摘要
export function htmlToTextPreview(html: string): string {
  const text = (parseHtmlBody(html).textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text;
}

// 仅含空段落（如 wangEditor 空编辑器输出的 <p><br></p>）视为空内容；纯图片不算空
export function isBlankRichText(html: string): boolean {
  const body = parseHtmlBody(html);
  if ((body.textContent ?? "").trim()) return false;
  return !BLANK_MEDIA_TAGS.some((tag) => body.querySelector(tag));
}
