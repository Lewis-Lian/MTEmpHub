interface QueryMetricCardProps {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
}

export default function QueryMetricCard({ label, value, sub, valueClassName = "" }: QueryMetricCardProps) {
  return (
    <article className="summary-card dashboard-metric-card query-metric-card">
      <div className="dashboard-metric-label">{label}</div>
      <div className={`dashboard-metric-value${valueClassName ? ` ${valueClassName}` : ""}`}>{value}</div>
      <div className="dashboard-metric-sub">{sub}</div>
    </article>
  );
}
