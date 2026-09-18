interface QueryProgressOverlayProps {
  active: boolean;
  progress: number;
  text: string;
  className?: string;
}

const MILESTONES = [
  { value: 0, label: "准备" },
  { value: 33, label: "读取" },
  { value: 66, label: "处理" },
  { value: 100, label: "完成" },
] as const;

export default function QueryProgressOverlay({ active, progress, text, className = "" }: QueryProgressOverlayProps) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className={`query-progress-overlay ${active ? "is-active" : ""} ${className}`.trim()} role="status">
      <div className="query-progress-card">
        <div className="query-progress-heading">
          <span className="query-progress-eyebrow">PROCESSING</span>
          <span className="query-progress-percent">{safeProgress}%</span>
        </div>
        <div
          aria-label="处理进度"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={safeProgress}
          className="query-progress-track"
          role="progressbar"
        >
          <span className="query-progress-fill" style={{ transform: `scaleX(${safeProgress / 100})` }} />
          <span className="query-progress-sweep" />
          <span className="query-progress-milestones" aria-hidden="true">
            {MILESTONES.map((milestone) => (
              <span
                className={`query-progress-milestone ${safeProgress >= milestone.value ? "is-reached" : ""}`}
                key={milestone.value}
                role="presentation"
              />
            ))}
          </span>
        </div>
        <div className="query-progress-stages" aria-hidden="true">
          {MILESTONES.map((milestone, index) => {
            const isReached = safeProgress >= milestone.value;
            const isCurrent = !isReached && (index === 0 || safeProgress >= MILESTONES[index - 1].value);
            return (
              <span
                className={`query-progress-stage ${isReached ? "is-reached" : isCurrent ? "is-current" : "is-pending"}`}
                key={milestone.value}
              >
                {milestone.label}
              </span>
            );
          })}
        </div>
        <p className="query-progress-text">{text}</p>
      </div>
    </div>
  );
}
