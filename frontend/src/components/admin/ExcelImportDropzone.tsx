import { useRef, useState } from "react";
import "./excel-import-dropzone.css";

type ExcelImportDropzoneProps = {
  file: File | null;
  onFileChange: (file: File | null) => void;
  className?: string;
};

export default function ExcelImportDropzone({ file, onFileChange, className = "" }: ExcelImportDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      className={`excel-import-dropzone ${className}${file ? " has-file" : ""}${isDragOver ? " is-dragover" : ""}`}
      onClick={(event) => {
        if (event.target !== inputRef.current) inputRef.current?.click();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragOver(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragOver(false);
        const droppedFile = event.dataTransfer.files?.[0];
        if (droppedFile) onFileChange(droppedFile);
      }}
    >
      <div className="excel-import-dropzone-icon">
        {file ? (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        ) : (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </div>
      <div className="excel-import-dropzone-title">{file ? file.name : "点击选择，或将 Excel 文件拖拽到这里"}</div>
      <div className="excel-import-dropzone-detail">{file ? `大小: ${(file.size / 1024).toFixed(1)} KB` : "支持 .xlsx 格式文件"}</div>
      <input
        ref={inputRef}
        className="account-file-input"
        name="file"
        type="file"
        accept=".xlsx"
        style={{ display: "none" }}
        onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
      />
    </div>
  );
}
