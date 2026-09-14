import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RichTextEditor from "./RichTextEditor";

type EditorProps = Record<string, unknown>;
const editorPropsLog: EditorProps[] = [];

vi.mock("@wangeditor/editor-for-react", () => ({
  // 以空组件捕获透传的 props，wangEditor 真实 DOM 初始化无法在 jsdom 中运行
  Editor: (props: EditorProps) => {
    editorPropsLog.push(props);
    return null;
  },
  Toolbar: () => null,
}));

describe("RichTextEditor", () => {
  it("以指定标签渲染并回显初始内容", () => {
    editorPropsLog.length = 0;
    render(<RichTextEditor ariaLabel="消息内容" onChange={() => undefined} value="<p>初始内容</p>" />);
    expect(screen.getByLabelText("消息内容")).toBeInTheDocument();
    expect(editorPropsLog[editorPropsLog.length - 1]?.value).toBe("<p>初始内容</p>");
  });

  it("编辑器内容变化时向外抛出对应 HTML", () => {
    editorPropsLog.length = 0;
    const onChange = vi.fn();
    const getHtml = vi.fn(() => "<p>更新后的内容</p>");
    render(<RichTextEditor ariaLabel="消息内容" onChange={onChange} value="" />);
    const editorProps = editorPropsLog[editorPropsLog.length - 1]!;
    act(() => (editorProps.onCreated as (editor: unknown) => void)({ destroy: vi.fn(), getHtml }));
    act(() => (editorProps.onChange as (editor: unknown) => void)({ getHtml }));
    expect(onChange).toHaveBeenLastCalledWith("<p>更新后的内容</p>");
  });
});
