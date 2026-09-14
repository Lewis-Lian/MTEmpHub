import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "./sanitizeHtml";

describe("sanitizeHtml", () => {
  it("保留常规富文本标签与内容", () => {
    const html = '<h2>标题</h2><p>正文<b>加粗</b></p><ul><li>要点</li></ul><table><tbody><tr><td>表格</td></tr></tbody></table>';
    expect(sanitizeHtml(html)).toContain("<h2>标题</h2>");
    expect(sanitizeHtml(html)).toContain("<b>加粗</b>");
    expect(sanitizeHtml(html)).toContain("要点");
    expect(sanitizeHtml(html)).toContain("<table>");
  });

  it("移除 script 标签与事件属性", () => {
    const html = '<p onclick="alert(1)">安全</p><script>alert(1)</script><img src="x" onerror="alert(1)">';
    const cleaned = sanitizeHtml(html);
    expect(cleaned).not.toContain("<script");
    expect(cleaned).not.toContain("onerror");
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).toContain("安全");
    expect(cleaned).toContain("<img");
  });

  it("移除 javascript: 链接", () => {
    const cleaned = sanitizeHtml('<a href="javascript:alert(1)">链接</a>');
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).toContain("链接");
  });
});
