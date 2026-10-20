"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clock3,
  History,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { Idea, IdeaHistory } from "@/lib/domain";
import { ideaTitle } from "@/lib/domain";
import { api, ApiError } from "@/lib/api-client";
import { AnalysisSection, Dialog, ErrorState } from "./notebook-parts";

const versionTime = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(date));

export function IdeaHistoryDialog({
  ideaId,
  onClose,
  onRestored,
}: {
  ideaId: string;
  onClose: () => void;
  onRestored: (idea: Idea) => void;
}) {
  const [data, setData] = useState<IdeaHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{
    version: number;
    requestId: string;
  } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [conflict, setConflict] = useState(false);
  const guard = useRef(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    setConfirmation(null);
    setRestoreError("");
    try {
      const history = await api<IdeaHistory>(`/api/ideas/${ideaId}/history`);
      if (sequence !== loadSequence.current) return;
      setData(history);
      setSelected(history.idea.revision);
      setConflict(false);
    } catch (error) {
      if (sequence === loadSequence.current)
        setLoadError((error as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [ideaId]);

  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [load]);

  const historical = data?.versions.find(
    (version) => version.idea.revision === selected,
  );
  const viewingCurrent = selected === data?.idea.revision;
  const preview = viewingCurrent ? data?.idea : historical?.idea;

  function select(revision: number) {
    if (guard.current) return;
    setSelected(revision);
    setConfirmation(null);
    setRestoreError("");
  }

  async function restore() {
    if (!data || !confirmation || guard.current || conflict) return;
    guard.current = true;
    setRestoring(true);
    setRestoreError("");
    try {
      const result = await api<{ idea: Idea }>(`/api/ideas/${ideaId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionRevision: confirmation.version,
          revision: data.idea.revision,
          requestId: confirmation.requestId,
        }),
      });
      onRestored(result.idea);
    } catch (error) {
      setRestoreError((error as Error).message);
      setConflict(error instanceof ApiError && error.status === 409);
    } finally {
      guard.current = false;
      setRestoring(false);
    }
  }

  return (
    <Dialog
      open
      title="灵感历史版本"
      className="history-dialog"
      onClose={() => {
        if (!guard.current) onClose();
      }}
    >
      <div className="history-intro">
        <div>
          <div className="eyebrow">EVERY THOUGHT HAS A STORY</div>
          <h2>回看想法走过的路。</h2>
          <p>每次修改前，保留当时的想法、关键词和分析。</p>
        </div>
        <History size={29} strokeWidth={1.3} />
      </div>
      {loading ? (
        <div className="loading-block">
          <LoaderCircle className="spin" />
          正在读取历史版本…
        </div>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : data && preview ? (
        <>
          {!data.versions.length && (
            <p className="history-empty">
              还没有历史版本。下次修改这条灵感时，当前内容会自动保留在这里。
            </p>
          )}
          <div className="history-body">
            <nav className="history-list" aria-label="选择灵感版本">
              {[{ idea: data.idea, archivedAt: null }, ...data.versions].map(
                (version) => (
                  <button
                    key={version.idea.revision}
                    type="button"
                    aria-pressed={selected === version.idea.revision}
                    aria-label={`第 ${version.idea.revision} 版${version.archivedAt ? "" : "，当前版本"}`}
                    disabled={restoring}
                    onClick={() => select(version.idea.revision)}
                  >
                    <span className="history-version-label">
                      <strong>第 {version.idea.revision} 版</strong>
                      {!version.archivedAt && <span>当前</span>}
                    </span>
                    <time
                      dateTime={version.archivedAt ?? version.idea.updatedAt}
                    >
                      {versionTime(
                        version.archivedAt ?? version.idea.updatedAt,
                      )}
                    </time>
                    <span className="history-version-summary">
                      {ideaTitle(version.idea)}
                    </span>
                    {version.idea.restoredFromRevision && (
                      <span className="history-origin">
                        恢复自第 {version.idea.restoredFromRevision} 版
                      </span>
                    )}
                  </button>
                ),
              )}
            </nav>
            <div className="history-preview" aria-label="版本内容">
              <div className="history-preview-heading">
                <span className="eyebrow">
                  {viewingCurrent
                    ? "当前版本"
                    : `第 ${preview.revision} 版 · 修改前的记录`}
                </span>
                <h3>{ideaTitle(preview)}</h3>
                <p>
                  <Clock3 size={12} />
                  {historical ? "保存于" : "最后更新于"}{" "}
                  <time dateTime={historical?.archivedAt ?? preview.updatedAt}>
                    {versionTime(historical?.archivedAt ?? preview.updatedAt)}
                  </time>
                </p>
              </div>
              <section className="history-content">
                <h4>想法</h4>
                <p>{preview.content}</p>
                {preview.tags.length > 0 && (
                  <div className="tags">
                    {preview.tags.map((tag) => (
                      <span key={tag}># {tag}</span>
                    ))}
                  </div>
                )}
              </section>
              <section className="history-analysis">
                <h4>
                  <Sparkles size={15} />
                  {preview.analysisStale ? "保留的较早分析" : "对应 AI 分析"}
                </h4>
                {preview.analysisStale && (
                  <p className="history-notice">
                    这份分析早于该版本的修改，尚未更新。恢复后仍会标记为待更新。
                  </p>
                )}
                {preview.analysis ? (
                  <>
                    <div className="analysis-summary">
                      <span>灵感概述</span>
                      <p>{preview.analysis.summary}</p>
                    </div>
                    <AnalysisSection number="01" title="核心研究问题">
                      {preview.analysis.question}
                    </AnalysisSection>
                    <AnalysisSection number="02" title="值得探索的价值">
                      {preview.analysis.value}
                    </AnalysisSection>
                    <AnalysisSection number="03" title="可行路径与局限">
                      {preview.analysis.approach}
                    </AnalysisSection>
                    <h4>下一步建议</h4>
                    <ol className="history-steps">
                      {preview.analysis.nextSteps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                    <div className="tags">
                      {preview.analysis.keywords.map((tag, index) => (
                        <span key={`${tag}-${index}`}># {tag}</span>
                      ))}
                    </div>
                    <p className="history-analysis-meta">
                      {preview.analysisModel}
                      {preview.analyzedAt &&
                        ` · ${versionTime(preview.analyzedAt)}`}
                    </p>
                  </>
                ) : (
                  <p className="history-notice">
                    {viewingCurrent
                      ? "当前版本尚无 AI 分析。"
                      : "该版本保存时尚无 AI 分析，恢复后可以重新生成。"}
                  </p>
                )}
                {!viewingCurrent && preview.status === "processing" && (
                  <p className="history-notice">
                    保存历史时分析尚未完成，恢复后可重新发起分析。
                  </p>
                )}
                {preview.error && <p className="form-error">{preview.error}</p>}
              </section>
            </div>
          </div>
          {restoreError && (
            <p className="form-error" role="alert">
              {restoreError}
            </p>
          )}
          <div className="history-actions">
            {conflict ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => void load()}
              >
                刷新历史记录
              </button>
            ) : confirmation ? (
              <div
                className="history-confirmation"
                role="group"
                aria-label="确认恢复历史版本"
              >
                <p>
                  将恢复第 {confirmation.version} 版的想法、关键词和分析。当前第{" "}
                  {data.idea.revision} 版会保留在历史记录中。
                </p>
                <div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={restoring}
                    onClick={() => setConfirmation(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={restoring}
                    onClick={() => void restore()}
                  >
                    {restoring ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <RotateCcw size={15} />
                    )}
                    {restoring ? "正在恢复…" : "确认恢复"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span>
                  {viewingCurrent
                    ? "选择一个历史版本，即可查看和恢复。"
                    : "恢复会生成新版本，保留已有历史。"}
                </span>
                <button
                  type="button"
                  className="button primary"
                  disabled={viewingCurrent}
                  onClick={() =>
                    setConfirmation({
                      version: preview.revision,
                      requestId: crypto.randomUUID(),
                    })
                  }
                >
                  <RotateCcw size={15} />
                  恢复此版本
                </button>
              </>
            )}
          </div>
          <p className="history-footnote">
            历史版本从功能启用后开始记录，之前未留存的修改无法追溯。
          </p>
        </>
      ) : null}
    </Dialog>
  );
}
