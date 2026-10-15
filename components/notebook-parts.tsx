"use client";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Circle, LoaderCircle, Sparkles, X } from "lucide-react";
import type { Idea } from "@/lib/domain";
import { isAnalysisRunning } from "@/lib/domain";

export const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
export const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const fullDate = (date: string) =>
  `${dateFormatter.format(new Date(date))} ${timeFormatter.format(new Date(date))}`;
export const tagsOf = (idea: Idea) => [
  ...new Set([...idea.tags, ...(idea.analysis?.keywords ?? [])]),
];

export function Dialog({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
    if (open) {
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <span id={titleId}>{title}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function Status({ idea }: { idea: Idea }) {
  const running = isAnalysisRunning(idea);
  const label = running
    ? "分析中"
    : idea.status === "completed"
      ? "已分析"
      : idea.status === "failed" || idea.status === "processing"
        ? "待重试"
        : "待分析";
  return (
    <span className={`status status-${running ? "processing" : idea.status}`}>
      {running ? (
        <LoaderCircle size={12} className="spin" />
      ) : idea.status === "completed" ? (
        <Sparkles size={12} />
      ) : (
        <Circle size={7} fill="currentColor" />
      )}
      {label}
    </span>
  );
}

export function TraceDrawing({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "trace-drawing small" : "trace-drawing"}
      viewBox="0 0 280 180"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M22 146C70 146 52 96 103 96C159 96 122 40 181 40C225 40 218 80 260 80"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="4 5"
        opacity=".55"
      />
      <path
        d="M103 96C158 96 141 146 200 146"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity=".3"
      />
      <circle
        cx="22"
        cy="146"
        r="5"
        fill="var(--paper)"
        stroke="currentColor"
      />
      <circle
        cx="103"
        cy="96"
        r="19"
        fill="var(--paper)"
        stroke="currentColor"
        strokeOpacity=".25"
      />
      <circle cx="103" cy="96" r="6" fill="currentColor" />
      <circle
        cx="181"
        cy="40"
        r="26"
        stroke="currentColor"
        strokeOpacity=".15"
      />
      <circle
        cx="181"
        cy="40"
        r="15"
        fill="var(--paper)"
        stroke="currentColor"
        strokeOpacity=".3"
      />
      <path
        d="m181 32 2.2 5.8L189 40l-5.8 2.2L181 48l-2.2-5.8L173 40l5.8-2.2z"
        fill="currentColor"
      />
      <circle
        cx="260"
        cy="80"
        r="4"
        fill="var(--paper)"
        stroke="currentColor"
      />
      <circle
        cx="200"
        cy="146"
        r="4"
        fill="var(--paper)"
        stroke="currentColor"
      />
      <path
        d="M26 40h10m-5-5v10M231 119h8m-4-4v8M70 53h5m-2.5-2.5v5"
        stroke="currentColor"
        strokeOpacity=".4"
      />
    </svg>
  );
}

export function AnalysisSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="analysis-section">
      <span className="analysis-number">{number}</span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </section>
  );
}
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      <button className="button secondary" onClick={onRetry}>
        重新加载
      </button>
    </div>
  );
}
export function Activity({ ideas, now }: { ideas: Idea[]; now: Date | null }) {
  const days = Array.from({ length: 84 }, (_, i) => {
    const date = new Date(now ?? "2026-01-01T00:00:00Z");
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 83 + i);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    const count = ideas.filter((idea) => {
      const time = Date.parse(idea.createdAt);
      return time >= date.getTime() && time < end.getTime();
    }).length;
    return { date, count };
  });
  const activeDays = days.filter((day) => day.count > 0).length;
  return (
    <div className="activity">
      <div className="activity-label">
        <span>最近 12 周</span>
        <span>{activeDays} 天有新想法</span>
      </div>
      <div
        className="activity-grid"
        role="img"
        aria-label={`最近十二周有 ${activeDays} 天记录了灵感`}
      >
        {days.map(({ date, count }) => (
          <span
            key={date.toISOString()}
            className={`activity-day level-${Math.min(count, 3)}`}
            title={`${date.toLocaleDateString("zh-CN")} · ${count} 条灵感`}
          />
        ))}
      </div>
      <div className="activity-legend">
        <span>少</span>
        {[0, 1, 2, 3].map((level) => (
          <i key={level} className={`activity-day level-${level}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
