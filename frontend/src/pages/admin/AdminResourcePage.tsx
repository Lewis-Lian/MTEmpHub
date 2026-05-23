import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchAdminRows } from "../../api/admin";
import QueryTable from "../../components/query/QueryTable";
import ErrorState from "../../components/feedback/ErrorState";
import LoadingState from "../../components/feedback/LoadingState";

interface AdminColumn {
  key: string;
  label: string;
  format?: (value: unknown, row: Record<string, unknown>) => string | number;
}

interface AdminResourcePageProps {
  title: string;
  description: string;
  endpoint: string;
  columns: AdminColumn[];
}

export default function AdminResourcePage({ title, description, endpoint, columns }: AdminResourcePageProps) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadRows() {
      try {
        const payload = await fetchAdminRows<unknown>(endpoint);
        if (!mounted) {
          return;
        }
        const normalized = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as { rows?: unknown[] }).rows)
            ? ((payload as { rows: unknown[] }).rows as Array<Record<string, unknown>>)
            : [];
        setRows(normalized);
        setError("");
      } catch (caughtError) {
        if (!mounted) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "后台数据加载失败");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadRows();
    return () => {
      mounted = false;
    };
  }, [endpoint]);

  if (isLoading) {
    return <LoadingState message="正在加载后台页面..." />;
  }

  if (error) {
    return <ErrorState description={error} title={`${title}加载失败`} />;
  }

  return (
    <section style={pageStyle}>
      <header style={heroStyle}>
        <p style={tagStyle}>后台管理</p>
        <h2 style={titleStyle}>{title}</h2>
        <p style={descriptionStyle}>{description}</p>
      </header>
      <section style={panelStyle}>
        <QueryTable
          headers={columns.map((column) => column.label)}
          rows={rows.map((row) =>
            columns.map((column) => {
              const value = row[column.key];
              if (column.format) {
                return column.format(value, row);
              }
              if (Array.isArray(value)) {
                return value.length ? JSON.stringify(value) : "";
              }
              if (value && typeof value === "object") {
                return JSON.stringify(value);
              }
              return value === null || value === undefined ? "" : String(value);
            }),
          )}
        />
      </section>
    </section>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "24px",
};

const heroStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const tagStyle: CSSProperties = {
  margin: 0,
  color: "#5c6f68",
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "34px",
  color: "#183153",
};

const descriptionStyle: CSSProperties = {
  margin: 0,
  color: "#4b5d67",
  lineHeight: 1.7,
};

const panelStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  background: "#ffffff",
  boxShadow: "0 18px 40px rgba(24, 49, 83, 0.08)",
};
