import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface QueryProgressCardProps {
  progress: number | null;
  text: string;
  label?: string;
  status?: "running" | "completed" | "failed" | "idle" | "pending";
  children?: ReactNode;
}

interface QueryProgressOverlayProps extends QueryProgressCardProps {
  active: boolean;
  className?: string;
}

export function QueryProgressCard({ progress, text, label = "处理进度", status, children }: QueryProgressCardProps) {
  const safeProgress = status === "completed" ? 100 : progress === null || !Number.isFinite(progress) ? null : Math.max(0, Math.min(100, progress));
  const stopped = status === "failed" || status === "idle";
  const waiting = status === "pending";
  const completed = !waiting && !stopped && (status === "completed" || (status === undefined && safeProgress === 100));
  const percentText = waiting ? "待开始" : status === "failed" ? "未完成" : status === "idle" ? "已取消" : safeProgress === null ? "处理中" : `${Math.floor(safeProgress)}%`;

  return (
    <div className={`query-progress-card query-progress-card-inline${stopped ? " is-stopped" : waiting || completed ? " is-still" : ""}`}>
      <div className="query-progress-heading">
        <div className="query-progress-status-badge">
          <span className="query-progress-pulse-dot" aria-hidden="true" />
          <span className="query-progress-eyebrow">{waiting ? "READY" : stopped ? "STOPPED" : completed ? "COMPLETED" : "PROCESSING"}</span>
        </div>
        <span className="query-progress-percent">{percentText}</span>
      </div>
      <div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={safeProgress ?? undefined}
        aria-valuetext={text} className={`query-progress-track${safeProgress === null && !stopped && !waiting ? " is-indeterminate" : ""}`} role="progressbar">
        <span className="query-progress-fill" style={{ transform: `scaleX(${(safeProgress ?? 0) / 100})` }} />
        {!waiting && !stopped && !completed && <span className="query-progress-sweep" />}
        {safeProgress !== null && <span className="query-progress-milestones" aria-hidden="true">
          {[0, 33, 66, 100].map(value => <span className={`query-progress-milestone ${safeProgress >= value ? "is-reached" : ""}`} key={value} />)}
        </span>}
      </div>
      <div className="query-progress-footer">
        {completed ? <span className="query-progress-check" aria-hidden="true">
          <svg fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="13"><polyline points="20 6 9 17 4 12" /></svg>
        </span> : !waiting && !stopped && <span className="query-progress-spinner" aria-hidden="true" />}
        <p className="query-progress-text">{text}</p>
      </div>
      {children && <div className="query-progress-details">{children}</div>}
    </div>
  );
}

export default function QueryProgressOverlay({ active, className = "", ...props }: QueryProgressOverlayProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [scope, setScope] = useState<{ target: HTMLElement; inset: string } | null>(null);

  useLayoutEffect(() => {
    const parent = anchor.current?.parentElement;
    if (!parent) return;
    const dialog = parent.closest<HTMLElement>('.acm-modal-card, .master-modal, [role="dialog"]');
    const target = dialog ?? parent.closest<HTMLElement>(".app-tab-pane");
    if (!target) return;
    const content = !dialog && target.parentElement?.classList.contains("app-content") ? target.parentElement : null;
    const padding = content ? getComputedStyle(content) : null;
    let inset = padding ? [padding.paddingTop, padding.paddingRight, padding.paddingBottom, padding.paddingLeft]
      .map(value => `${-(parseFloat(value) || 0)}px`).join(" ") : "0px";
    if (dialog && active) {
      const { scrollTop, scrollLeft } = dialog;
      if (scrollTop || scrollLeft) inset = `${scrollTop}px ${-scrollLeft}px ${-scrollTop}px ${scrollLeft}px`;
      const overflow = ["overflow", "overflow-x", "overflow-y"].map(property => ({
        property, value: dialog.style.getPropertyValue(property), priority: dialog.style.getPropertyPriority(property),
      }));
      dialog.style.setProperty("overflow", "hidden", "important");
      setScope({ target, inset });
      return () => {
        for (const { property } of overflow) dialog.style.removeProperty(property);
        for (const { property, value, priority } of overflow) if (value) dialog.style.setProperty(property, value, priority);
      };
    }
    setScope({ target, inset });
  }, [active]);

  const overlay = <div className={`query-progress-overlay ${active ? "is-active" : ""} ${className}`.trim()}
    role="status" aria-hidden={!active} style={{ "--query-progress-inset": scope?.inset ?? "0px" } as CSSProperties}>
    <QueryProgressCard {...props} />
  </div>;
  return <><span ref={anchor} hidden />{scope ? createPortal(overlay, scope.target) : overlay}</>;
}

// A running task blocks its page or dialog; its final result stays readable without a mask.
export function TaskProgress({ active, ...props }: QueryProgressOverlayProps) {
  return active ? <QueryProgressOverlay active {...props} /> : <QueryProgressCard {...props} />;
}
