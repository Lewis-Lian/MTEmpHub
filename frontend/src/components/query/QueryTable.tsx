import type { CSSProperties } from "react";

interface QueryTableProps {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  emptyText?: string;
}

export default function QueryTable({ headers, rows, emptyText = "当前条件暂无数据" }: QueryTableProps) {
  const safeHeaders = headers.length ? headers : ["结果"];

  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {safeHeaders.map((header, index) => (
              <th key={`${header}-${index}`} style={headCellStyle}>
                {header || "-"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={safeHeaders.length} style={emptyCellStyle}>
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {safeHeaders.map((_, columnIndex) => (
                  <td key={`cell-${rowIndex}-${columnIndex}`} style={bodyCellStyle}>
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  borderRadius: "20px",
  border: "1px solid #e6ece4",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#ffffff",
};

const headCellStyle: CSSProperties = {
  padding: "14px 16px",
  textAlign: "left",
  background: "#eef3ea",
  color: "#183153",
  fontSize: "14px",
  position: "sticky",
  top: 0,
};

const bodyCellStyle: CSSProperties = {
  padding: "14px 16px",
  borderTop: "1px solid #edf2ec",
  color: "#31444c",
  verticalAlign: "top",
  fontSize: "14px",
};

const emptyCellStyle: CSSProperties = {
  ...bodyCellStyle,
  textAlign: "center",
  color: "#667d74",
};
