import { describe, expect, it } from "vitest";

import { htmlToTextPreview, isBlankRichText } from "./richText";

describe("htmlToTextPreview", () => {
  it("去除标签只保留可见文本", () => {
    expect(htmlToTextPreview("<h2>通知</h2><p>请查收<b>公告</b></p>")).toBe("通知请查收公告");
  });

  it("折叠空白并截断过长文本", () => {
    const long = `<p>${"很".repeat(300)}</p>`;
    expect(htmlToTextPreview(long).length).toBeLessThanOrEqual(121);
    expect(htmlToTextPreview("<p>一   二\n\n三</p>")).toBe("一 二 三");
  });

  it("旧版纯文本消息原样返回", () => {
    expect(htmlToTextPreview("普通文本消息")).toBe("普通文本消息");
  });
});

describe("isBlankRichText", () => {
  it("wangEditor 空编辑器输出视为空", () => {
    expect(isBlankRichText("<p><br></p>")).toBe(true);
    expect(isBlankRichText("<p>  </p><p><br></p>")).toBe(true);
    expect(isBlankRichText("")).toBe(true);
  });

  it("含正文或图片的内容不算空", () => {
    expect(isBlankRichText("<p>公告</p>")).toBe(false);
    expect(isBlankRichText('<p><br></p><img src="http://x/a.png">')).toBe(false);
  });
});
