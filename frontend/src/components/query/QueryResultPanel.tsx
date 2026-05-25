import type { ReactNode } from "react";

interface QueryResultPanelProps {
  children: ReactNode;
}

export default function QueryResultPanel({ children }: QueryResultPanelProps) {
  return (
    <section className="card query-result-panel">
      <div className="query-result-table">{children}</div>
    </section>
  );
}
