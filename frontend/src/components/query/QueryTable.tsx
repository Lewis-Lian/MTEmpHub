interface QueryTableProps {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  emptyText?: string;
}

export default function QueryTable({ headers, rows, emptyText = "当前条件暂无数据" }: QueryTableProps) {
  const safeHeaders = headers.length ? headers : ["结果"];
  const hasRows = rows.length > 0;

  return (
    <div className="legacy-table-panel">
      <div className="legacy-table-wrap">
      <table className="legacy-table">
        <thead>
          <tr>
            {safeHeaders.map((header, index) => (
              <th key={`${header}-${index}`} className="legacy-table-head-cell">
                {header || "-"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!hasRows ? (
            <tr>
              <td colSpan={safeHeaders.length} className="legacy-table-empty-cell">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {safeHeaders.map((_, columnIndex) => (
                  <td key={`cell-${rowIndex}-${columnIndex}`} className="legacy-table-body-cell">
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
