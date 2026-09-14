import { useEffect, useState } from "react";
import { Editor, Toolbar } from "@wangeditor/editor-for-react";
import type { IDomEditor, IEditorConfig, IToolbarConfig } from "@wangeditor/editor";
import "@wangeditor/editor/dist/css/style.css";

interface RichTextEditorProps {
  ariaLabel: string;
  onChange: (html: string) => void;
  value: string;
}

export default function RichTextEditor({ ariaLabel, onChange, value }: RichTextEditorProps) {
  const [editor, setEditor] = useState<IDomEditor | null>(null);
  const toolbarConfig: Partial<IToolbarConfig> = {};
  const editorConfig: Partial<IEditorConfig> = {
    placeholder: "请输入消息内容...",
  };

  useEffect(() => {
    return () => {
      if (editor) editor.destroy();
    };
  }, [editor]);

  return <div aria-label={ariaLabel} className="rich-text-editor">
    <Toolbar className="rich-text-editor-toolbar" defaultConfig={toolbarConfig} editor={editor} mode="default" />
    <Editor
      className="rich-text-editor-body"
      defaultConfig={editorConfig}
      mode="default"
      onChange={(nextEditor) => onChange(nextEditor.getHtml())}
      onCreated={setEditor}
      value={value}
    />
  </div>;
}
