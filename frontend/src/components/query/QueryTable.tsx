import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface QueryTableHeader {
  label: ReactNode;
  sortable?: boolean;
}

interface QueryTableProps {
  headers: Array<string | QueryTableHeader>;
  rows: Array<Array<ReactNode>>;
  sortRows?: Array<Array<string | number | null>>;
  emptyText?: string;
  panelClassName?: string;
  wrapClassName?: string;
  tableClassName?: string;
}

const PAGE_SIZES = [50, 100, 500, 1000, 2000];
const DEFAULT_PAGE_SIZE = 100;
type SortDirection = "ascending" | "descending";

export default function QueryTable({
  headers,
  rows,
  sortRows,
  emptyText = "当前条件暂无数据",
  panelClassName,
  wrapClassName,
  tableClassName,
}: QueryTableProps) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const safeHeaders = headers.length ? headers.map(normalizeHeader) : [normalizeHeader("结果")];
  const hasRows = rows.length > 0;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [jumpValue, setJumpValue] = useState("");
  const [sortIndex, setSortIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const indexedRows = useMemo(
    () => rows.map((row, index) => ({ row, sortRow: sortRows?.[index] })),
    [rows, sortRows],
  );
  const sortedRows = useMemo(() => {
    if (sortIndex === null) {
      return rows;
    }

    const nextRows = [...indexedRows];
    nextRows.sort((leftRow, rightRow) => {
      const result = compareCellValues(
        parseCellValue(leftRow.sortRow ? leftRow.sortRow[sortIndex] : leftRow.row[sortIndex]),
        parseCellValue(rightRow.sortRow ? rightRow.sortRow[sortIndex] : rightRow.row[sortIndex]),
      );
      return sortDirection === "ascending" ? result : -result;
    });
    return nextRows.map((item) => item.row);
  }, [indexedRows, rows, sortDirection, sortIndex]);
  const visibleRows = hasRows
    ? sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)
    : [];

  useEffect(() => {
    setPage(1);
    setJumpValue("");
  }, [rows]);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) {
      return undefined;
    }
    const container = tableWrap;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase() ?? "";
      if (["input", "select", "button", "a", "label", "textarea"].includes(tagName)) {
        return;
      }

      isDragging = true;
      startX = event.clientX;
      startY = event.clientY;
      scrollLeft = container.scrollLeft;
      scrollTop = container.scrollTop;
      container.classList.add("is-dragging");
    }

    function handleMouseMove(event: MouseEvent) {
      if (!isDragging) {
        return;
      }

      container.scrollLeft = scrollLeft - (event.clientX - startX);
      container.scrollTop = scrollTop - (event.clientY - startY);
    }

    function handleMouseUp() {
      if (!isDragging) {
        return;
      }

      isDragging = false;
      container.classList.remove("is-dragging");
    }

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  function jumpToPage() {
    const target = Number(jumpValue || 0);
    if (!target) {
      return;
    }

    const nextPage = Math.min(Math.max(target, 1), pageCount);
    setPage(nextPage);
    setJumpValue(String(nextPage));
  }

  function toggleSort(nextSortIndex: number) {
    if (!safeHeaders[nextSortIndex]?.sortable) {
      return;
    }
    if (sortIndex === nextSortIndex) {
      setSortDirection((currentDirection) =>
        currentDirection === "ascending" ? "descending" : "ascending",
      );
    } else {
      setSortIndex(nextSortIndex);
      setSortDirection("ascending");
    }
    setPage(1);
  }

  return (
    <div className={["legacy-table-panel", panelClassName].filter(Boolean).join(" ")}>
      <div className={["legacy-table-wrap", wrapClassName].filter(Boolean).join(" ")} ref={tableWrapRef}>
        <table className={["legacy-table", tableClassName].filter(Boolean).join(" ")}>
          <thead>
            <tr>
              {safeHeaders.map((header, index) => (
                <th key={`header-${index}`} className="legacy-table-head-cell">
                  {header.sortable ? (
                    <button
                      aria-sort={sortIndex === index ? sortDirection : "none"}
                      className="legacy-table-head-button"
                      data-sort-direction={sortIndex === index ? sortDirection : "none"}
                      onClick={() => toggleSort(index)}
                      type="button"
                    >
                      <span>{header.label || "-"}</span>
                      <span aria-hidden="true" className="legacy-table-sort-indicator">
                        {sortIndex === index
                          ? sortDirection === "ascending"
                            ? "▲"
                            : "▼"
                          : "↕"}
                      </span>
                    </button>
                  ) : (
                    <div className="master-static-head">{header.label || "-"}</div>
                  )}
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
              visibleRows.map((row, rowIndex) => (
                <tr key={`row-${safePage}-${rowIndex}`}>
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
      {hasRows ? (
        <div className="table-pager">
          <div className="table-pager-right">
            <span className="table-pager-total">共 {rows.length} 条记录</span>
            <label className="small text-muted mb-0">每页</label>
            <select
              className="form-select form-select-sm"
              onChange={(event) => {
                setPageSize(Number(event.target.value || DEFAULT_PAGE_SIZE));
                setPage(1);
                setJumpValue("");
              }}
              style={{ width: 88 }}
              value={pageSize}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm btn-outline-secondary"
              disabled={safePage <= 1}
              onClick={() => setPage((currentPage) => currentPage - 1)}
              type="button"
            >
              上一页
            </button>
            <span className="table-pager-page">
              第 {safePage} / {pageCount} 页
            </span>
            <div className="table-pager-jump">
              <input
                className="form-control form-control-sm"
                max={pageCount}
                min={1}
                onChange={(event) => setJumpValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  jumpToPage();
                }}
                placeholder="页码"
                step={1}
                type="number"
                value={jumpValue}
              />
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={jumpToPage}
                type="button"
              >
                跳转
              </button>
            </div>
            <button
              className="btn btn-sm btn-outline-secondary"
              disabled={safePage >= pageCount}
              onClick={() => setPage((currentPage) => currentPage + 1)}
              type="button"
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeHeader(header: string | QueryTableHeader): QueryTableHeader {
  if (typeof header === "string") {
    return { label: header, sortable: true };
  }
  return {
    label: header.label,
    sortable: header.sortable ?? true,
  };
}

function parseCellValue(value: ReactNode) {
  const text = String(value ?? "").trim();
  if (!text) {
    return { type: "empty" as const, value: "" };
  }

  const normalizedNumber = text.replace(/,/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(normalizedNumber)) {
    return { type: "number" as const, value: Number(normalizedNumber) };
  }

  const timestamp = Date.parse(text.replace(/\./g, "-"));
  if (!Number.isNaN(timestamp) && /[-/:\s年月日]/.test(text)) {
    return { type: "date" as const, value: timestamp };
  }

  return { type: "text" as const, value: text.toLocaleLowerCase("zh-CN") };
}

function compareCellValues(
  left: ReturnType<typeof parseCellValue>,
  right: ReturnType<typeof parseCellValue>,
) {
  if (left.type === "empty" && right.type === "empty") {
    return 0;
  }
  if (left.type === "empty") {
    return 1;
  }
  if (right.type === "empty") {
    return -1;
  }
  if (left.type === right.type) {
    if (left.value < right.value) {
      return -1;
    }
    if (left.value > right.value) {
      return 1;
    }
    return 0;
  }
  return String(left.value).localeCompare(String(right.value), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}
