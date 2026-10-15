"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Feather,
  FlaskConical,
  Hash,
  Lightbulb,
  LoaderCircle,
  Orbit,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sprout,
  Trash2,
  X,
} from "lucide-react";
import type { Idea } from "@/lib/domain";
import { isAnalysisRunning, MAX_CONTENT_LENGTH } from "@/lib/domain";
import {
  Activity,
  AnalysisSection,
  dateFormatter,
  Dialog,
  ErrorState,
  fullDate,
  Status,
  tagsOf,
  timeFormatter,
  TraceDrawing,
} from "./notebook-parts";

type Connection = {
  configured: boolean;
  model: string | null;
  displayName: string;
};
type Draft = { id: string; content: string; tags: string };
const DRAFT_KEY = "research-trace-draft";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("网络暂时不可用，请检查连接后重试。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("服务暂时没有响应，请稍后重试。");
  }
  if (!response.ok)
    throw new Error(
      typeof data === "object" &&
        data &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : "操作失败，请稍后重试。",
    );
  return data as T;
}

export default function Notebook({
  initialIdeaId = null,
}: {
  initialIdeaId?: string | null;
}) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string | null>(initialIdeaId);
  const [view, setView] = useState<"timeline" | "bookmarks">("timeline");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [ascending, setAscending] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<Draft>({ id: "", content: "", tags: "" });
  const [draftReady, setDraftReady] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState("");
  const [bookmarkBusy, setBookmarkBusy] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [now, setNow] = useState<Date | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const saveGuard = useRef(false);
  const analysisGuards = useRef(new Set<string>());

  const reload = useCallback(async () => {
    try {
      const [records, config] = await Promise.all([
        api<{ ideas: Idea[] }>("/api/ideas"),
        api<Connection>("/api/config"),
      ]);
      setIdeas(records.ideas);
      setConnection(config);
      setLoadError("");
    } catch (error) {
      setLoadError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    setSelected(initialIdeaId);
  }, [initialIdeaId]);
  useEffect(() => {
    setNow(new Date());
    let initial: Draft = { id: crypto.randomUUID(), content: "", tags: "" };
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      if (
        saved &&
        typeof saved.content === "string" &&
        typeof saved.tags === "string"
      )
        initial = {
          id: typeof saved.id === "string" ? saved.id : crypto.randomUUID(),
          content: saved.content,
          tags: saved.tags,
        };
    } catch {
      /* Draft persistence is optional; server saves remain available. */
    }
    setDraft(initial);
    setDraftReady(true);
    setComposerOpen(!initialIdeaId);
    const updateTime = window.setInterval(() => setNow(new Date()), 30_000);
    const pop = () => {
      setSelected(
        window.location.pathname.startsWith("/ideas/")
          ? decodeURIComponent(window.location.pathname.split("/")[2])
          : null,
      );
      setComposerOpen(false);
    };
    window.addEventListener("popstate", pop);
    return () => {
      clearInterval(updateTime);
      window.removeEventListener("popstate", pop);
    };
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (draft.content || draft.tags)
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* The editor also works without browser storage. */
    }
  }, [draft, draftReady]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      const editing =
        /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName) ||
        (event.target as HTMLElement).isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!composerOpen && !settingsOpen && !deleteOpen)
          searchRef.current?.focus();
      }
      if (
        event.key.toLowerCase() === "n" &&
        !editing &&
        !event.ctrlKey &&
        !event.metaKey &&
        !settingsOpen &&
        !deleteOpen
      ) {
        event.preventDefault();
        setComposerOpen(true);
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [composerOpen, settingsOpen, deleteOpen]);
  const hasProcessing = ideas.some((idea) => isAnalysisRunning(idea));
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => {
      void reload();
    }, 4000);
    return () => clearInterval(timer);
  }, [hasProcessing, reload]);

  const upsert = (idea: Idea) =>
    setIdeas((previous) =>
      [idea, ...previous.filter((item) => item.id !== idea.id)].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  const navigate = (id: string | null) => {
    setSelected(id);
    window.history.pushState(null, "", id ? `/ideas/${id}` : "/");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const home = (nextView: "timeline" | "bookmarks") => {
    setView(nextView);
    setTag(null);
    setFilter("all");
    setQuery("");
    navigate(null);
  };
  const current = ideas.find((idea) => idea.id === selected);
  const completed = ideas.filter((idea) => idea.status === "completed").length;
  const bookmarked = ideas.filter((idea) => idea.bookmarked).length;
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    ideas.forEach((idea) =>
      tagsOf(idea).forEach((value) =>
        counts.set(value, (counts.get(value) ?? 0) + 1),
      ),
    );
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [ideas]);
  const visible = useMemo(
    () =>
      ideas
        .filter(
          (idea) =>
            (view !== "bookmarks" || idea.bookmarked) &&
            (filter === "all" ||
              (filter === "completed"
                ? idea.status === "completed"
                : idea.status !== "completed")) &&
            (!tag || tagsOf(idea).includes(tag)) &&
            (!query.trim() ||
              `${idea.title} ${idea.content} ${idea.analysis?.summary ?? ""} ${tagsOf(idea).join(" ")}`
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase())),
        )
        .sort((a, b) =>
          ascending
            ? a.createdAt.localeCompare(b.createdAt)
            : b.createdAt.localeCompare(a.createdAt),
        ),
    [ideas, view, filter, tag, query, ascending],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Idea[]>();
    visible.forEach((idea) => {
      const day = dateFormatter.format(new Date(idea.createdAt));
      map.set(day, [...(map.get(day) ?? []), idea]);
    });
    return [...map.entries()];
  }, [visible]);

  async function runAnalysis(idea: Idea) {
    if (analysisGuards.current.has(idea.id)) return;
    analysisGuards.current.add(idea.id);
    setAnalyzing((previous) => new Set(previous).add(idea.id));
    try {
      const config = await api<Connection>("/api/config");
      setConnection(config);
      if (!config.configured) {
        setSettingsOpen(true);
        return;
      }
      upsert({
        ...idea,
        status: "processing",
        analysisStartedAt: new Date().toISOString(),
        error: null,
      });
      const result = await api<{ idea: Idea }>(
        `/api/ideas/${idea.id}/analyze`,
        { method: "POST" },
      );
      if (result.idea) {
        upsert(result.idea);
        setToast("AI 分析已保存");
      }
    } catch (error) {
      setToast((error as Error).message);
      await reload();
    } finally {
      analysisGuards.current.delete(idea.id);
      setAnalyzing((previous) => {
        const next = new Set(previous);
        next.delete(idea.id);
        return next;
      });
    }
  }

  async function saveIdea(event?: FormEvent) {
    event?.preventDefault();
    if (saveGuard.current || !draft.content.trim()) return;
    const tags = [
      ...new Set(
        draft.tags
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (tags.length > 8 || tags.some((value) => value.length > 24)) {
      setSaveError("最多添加 8 个标签，每个不超过 24 字。");
      return;
    }
    saveGuard.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const { idea, aiConfigured } = await api<{
        idea: Idea;
        aiConfigured: boolean;
      }>("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, content: draft.content, tags }),
      });
      upsert(idea);
      setDraft({ id: crypto.randomUUID(), content: "", tags: "" });
      setComposerOpen(false);
      home("timeline");
      setToast(
        aiConfigured
          ? "灵感已保存，正在准备 AI 分析"
          : "灵感已保存，时间戳已自动记录",
      );
      if (
        aiConfigured &&
        idea.status !== "completed" &&
        !isAnalysisRunning(idea)
      )
        void runAnalysis(idea);
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      saveGuard.current = false;
      setSaving(false);
    }
  }

  async function toggleBookmark(idea: Idea) {
    if (bookmarkBusy) return;
    setBookmarkBusy(idea.id);
    try {
      const { idea: updated } = await api<{ idea: Idea }>(
        `/api/ideas/${idea.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookmarked: !idea.bookmarked }),
        },
      );
      upsert(updated);
      setToast(updated.bookmarked ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBookmarkBusy(null);
    }
  }

  async function deleteIdea() {
    if (!current || deleting) return;
    setDeleting(true);
    try {
      await api(`/api/ideas/${current.id}`, { method: "DELETE" });
      setIdeas((previous) => previous.filter((idea) => idea.id !== current.id));
      setDeleteOpen(false);
      navigate(null);
      setToast("灵感已删除");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function exportIdeas() {
    if (!ideas.length) {
      setToast("记录第一条灵感后，就可以导出笔记了");
      return;
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            app: "研迹 Trace",
            version: 1,
            exportedAt: new Date().toISOString(),
            ideas,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `research-trace-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("已导出全部灵感与分析");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="/"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            home("timeline");
          }}
          aria-label="研迹 Trace 首页"
        >
          <span className="brand-symbol">
            <Orbit size={27} strokeWidth={1.45} />
          </span>
          <span>
            研迹<span className="brand-english">trace</span>
          </span>
        </a>
        <div className="workspace-label">PERSONAL RESEARCH SPACE</div>
        <button
          className="button primary sidebar-capture"
          onClick={() => setComposerOpen(true)}
        >
          <Plus size={18} />
          记录灵感<kbd>N</kbd>
        </button>
        <nav aria-label="主导航">
          <span className="nav-caption">我的研究空间</span>
          <button
            className={`nav-item ${view === "timeline" && !tag ? "active" : ""}`}
            onClick={() => home("timeline")}
          >
            <span>
              <Clock3 size={18} />
              灵感轨迹
            </span>
            <span className="nav-count">{ideas.length}</span>
          </button>
          <button
            className={`nav-item ${view === "bookmarks" ? "active" : ""}`}
            onClick={() => home("bookmarks")}
          >
            <span>
              <Bookmark size={18} />
              我的收藏
            </span>
            {bookmarked > 0 && <span className="nav-count">{bookmarked}</span>}
          </button>
        </nav>
        <div className="topics">
          <div className="nav-caption">
            研究关键词
            <span>
              {tagCounts.length > 0
                ? tagCounts.length.toString().padStart(2, "0")
                : "—"}
            </span>
          </div>
          {tagCounts.length ? (
            tagCounts.slice(0, 8).map(([value, count]) => (
              <button
                key={value}
                className={`topic ${tag === value ? "active" : ""}`}
                onClick={() => {
                  setTag(tag === value ? null : value);
                  setView("timeline");
                  setFilter("all");
                  navigate(null);
                }}
              >
                <span>
                  <Hash size={14} />
                  {value}
                </span>
                <span>{count}</span>
              </button>
            ))
          ) : (
            <p className="muted-caption">
              你写下的关键词，
              <br />
              会在这里慢慢汇聚。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sprout size={23} strokeWidth={1.3} />
            <p>
              给尚未成形的想法，
              <br />
              一个生长的地方。
            </p>
            <span>SMALL IDEAS. NEW POSSIBILITIES.</span>
          </div>
          <button
            className="nav-item settings-nav"
            onClick={() => setSettingsOpen(true)}
          >
            <span>
              <Settings2 size={17} />
              AI 连接设置
            </span>
            <span
              className={`connection-dot ${connection?.configured ? "connected" : ""}`}
            />
          </button>
          <div className="profile">
            <span className="avatar">研</span>
            <div>
              <strong>我的研究笔记</strong>
              <span>每一点思考，都值得留下</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Orbit size={20} />
              研迹
            </span>
            <span>我的空间</span>
            <ChevronRight size={13} />
            <strong>
              {selected
                ? "灵感详情"
                : view === "bookmarks"
                  ? "我的收藏"
                  : "灵感轨迹"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="private-label">
              <span className="connection-dot connected" />
              私人的思考空间
            </span>
            <button
              className="icon-button"
              title="导出全部灵感"
              aria-label="导出全部灵感"
              onClick={exportIdeas}
            >
              <Download size={17} />
            </button>
            <button
              className="top-avatar"
              aria-label="打开 AI 设置"
              onClick={() => setSettingsOpen(true)}
            >
              研
            </button>
          </div>
        </header>
        <main
          className={selected ? "main-content detail-main" : "main-content"}
        >
          {selected ? (
            <>
              <button className="back-link" onClick={() => navigate(null)}>
                <ArrowLeft size={16} />
                返回灵感轨迹
              </button>
              {loading ? (
                <div className="loading-block">
                  <LoaderCircle className="spin" />
                  正在打开灵感…
                </div>
              ) : loadError ? (
                <ErrorState message={loadError} onRetry={reload} />
              ) : !current ? (
                <div className="empty-state">
                  <Feather size={38} />
                  <h2>这条灵感暂时找不到了</h2>
                  <p>它可能已经被删除。回到时间线，继续你的思考吧。</p>
                  <button
                    className="button secondary"
                    onClick={() => navigate(null)}
                  >
                    回到时间线
                  </button>
                </div>
              ) : (
                <>
                  <div className="detail-title">
                    <div className="eyebrow">A THOUGHT WORTH EXPLORING</div>
                    <h1>{current.analysis?.title || current.title}</h1>
                    <div className="detail-meta">
                      <span>
                        <Clock3 size={14} />
                        <time dateTime={current.createdAt}>
                          {fullDate(current.createdAt)}
                        </time>
                      </span>
                      <Status idea={current} />
                      <button
                        className={`icon-button ${current.bookmarked ? "bookmarked" : ""}`}
                        disabled={bookmarkBusy === current.id}
                        onClick={() => void toggleBookmark(current)}
                        aria-label={
                          current.bookmarked ? "取消收藏" : "收藏灵感"
                        }
                      >
                        <Bookmark
                          size={17}
                          fill={current.bookmarked ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        className="icon-button danger-hover"
                        aria-label="删除灵感"
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="detail-grid">
                    <section className="original-card">
                      <div className="section-label">
                        <Feather size={16} />
                        <h2>最初的想法</h2>
                        <button
                          className="icon-button"
                          aria-label="复制灵感原文"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                current.content,
                              );
                              setToast("原文已复制");
                            } catch {
                              setToast("无法访问剪贴板，请选中原文复制。");
                            }
                          }}
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                      <div className="original-text">{current.content}</div>
                      {current.tags.length > 0 && (
                        <div className="tags">
                          {current.tags.map((value) => (
                            <span key={value}># {value}</span>
                          ))}
                        </div>
                      )}
                      <div className="original-foot">
                        <CheckCheck size={14} />
                        原始记录 · 自动保存时间戳
                      </div>
                    </section>
                    <section className="analysis-panel">
                      <div className="analysis-heading">
                        <div>
                          <span className="ai-icon">
                            <Sparkles size={19} />
                          </span>
                          <h2>换个视角，继续探索</h2>
                        </div>
                        <span className="eyebrow">AI INSIGHTS</span>
                      </div>
                      {isAnalysisRunning(current) ||
                      analyzing.has(current.id) ? (
                        <div className="analysis-waiting">
                          <span className="orb processing">
                            <Sparkles size={28} />
                          </span>
                          <h3>正在梳理这束灵感</h3>
                          <p>
                            提炼研究问题，寻找可行路径。
                            <br />
                            你可以回到时间线，继续记录新的想法。
                          </p>
                          <span className="status status-processing">
                            <LoaderCircle size={13} className="spin" />
                            分析中，请稍候
                          </span>
                        </div>
                      ) : current.analysis ? (
                        <>
                          <div className="analysis-summary">
                            <span>灵感概述</span>
                            <p>{current.analysis.summary}</p>
                          </div>
                          <AnalysisSection number="01" title="核心研究问题">
                            {current.analysis.question}
                          </AnalysisSection>
                          <AnalysisSection number="02" title="值得探索的价值">
                            {current.analysis.value}
                          </AnalysisSection>
                          <AnalysisSection number="03" title="可行路径与局限">
                            {current.analysis.approach}
                          </AnalysisSection>
                          <div className="next-steps">
                            <div className="section-label">
                              <FlaskConical size={16} />
                              <h3>从这几步开始</h3>
                            </div>
                            {current.analysis.nextSteps.map((step, index) => (
                              <div className="next-step" key={index}>
                                <span>
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <p>{step}</p>
                              </div>
                            ))}
                          </div>
                          <div className="tags analysis-tags">
                            {current.analysis.keywords.map((value, index) => (
                              <span key={`${value}-${index}`}># {value}</span>
                            ))}
                          </div>
                          <div className="analysis-footer">
                            <span>
                              {current.analysisModel} ·{" "}
                              {current.analyzedAt &&
                                fullDate(current.analyzedAt)}
                            </span>
                            <button
                              className="text-button"
                              onClick={() => void runAnalysis(current)}
                            >
                              <Sparkles size={13} />
                              重新分析
                            </button>
                          </div>
                          {current.error && (
                            <p className="form-error">
                              {current.error} 上一次成功的分析已保留。
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="analysis-waiting">
                          <span className="orb">
                            <Sparkles size={28} strokeWidth={1.3} />
                          </span>
                          <h3>
                            {current.status === "failed"
                              ? "这次分析暂时中断了"
                              : "为这个想法，多打开一扇窗"}
                          </h3>
                          <p>
                            {current.error ||
                              (connection?.configured
                                ? "让 AI 帮你提炼研究问题、探索潜在价值，\n把模糊的想法变成可执行的下一步。"
                                : "你的灵感已经妥善保存。\n连接 AI 后，就能获得研究问题、可行路径与下一步建议。")}
                          </p>
                          <button
                            className="button primary"
                            onClick={() => void runAnalysis(current)}
                          >
                            <Sparkles size={16} />
                            {connection?.configured
                              ? current.status === "failed" ||
                                current.status === "processing"
                                ? "重新分析"
                                : "分析这条灵感"
                              : "了解如何连接 AI"}
                            <ArrowUpRight size={15} />
                          </button>
                          <span className="muted-caption">
                            原文始终保留，分析可以随时补充
                          </span>
                        </div>
                      )}
                      <div className="ai-disclaimer">
                        <Lightbulb size={14} />
                        <p>
                          AI
                          提供思考的起点。研究结论与新颖性，仍需要文献检索和实验验证。
                        </p>
                      </div>
                    </section>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span />
                    YOUR IDEAS, CONNECTED THROUGH TIME
                  </div>
                  <h1>
                    {view === "bookmarks"
                      ? "值得再次回看的想法"
                      : "让灵感，留下轨迹"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {view === "bookmarks"
                      ? "把值得深入的想法放在一起，让下一步更清晰。"
                      : "捕捉稍纵即逝的念头，看见思考一点点生长。"}
                  </p>
                </div>
                <button
                  className="button primary heading-capture"
                  onClick={() => setComposerOpen(true)}
                >
                  <Plus size={17} />
                  记录灵感
                </button>
              </div>
              <div className="capture-banner">
                <div className="capture-banner-content">
                  <span className="eyebrow">
                    A SMALL THOUGHT CAN GO A LONG WAY
                  </span>
                  <h2>此刻，有什么新想法？</h2>
                  <p>一个问题、一次观察，或一个还没想清楚的「如果」。</p>
                  <button
                    onClick={() => setComposerOpen(true)}
                    className="capture-prompt"
                  >
                    <Feather size={18} />
                    <span>不必完整，先记下来…</span>
                    <span className="capture-key">N</span>
                    <ArrowUpRight size={17} />
                  </button>
                  <div className="capture-benefits">
                    <span>
                      <Clock3 size={12} />
                      自动记录时间
                    </span>
                    <span>
                      <Sparkles size={12} />
                      AI 辅助探索
                    </span>
                    <span>
                      <CheckCheck size={13} />
                      留存每一次思考
                    </span>
                  </div>
                </div>
                <TraceDrawing />
              </div>
              <div className="workspace-grid">
                <section className="timeline-section" aria-label="灵感时间线">
                  <div className="timeline-section-heading">
                    <h2>
                      {view === "bookmarks" ? "我的收藏" : "灵感轨迹"}
                      <span>{visible.length.toString().padStart(2, "0")}</span>
                    </h2>
                    <button
                      className="text-button sort-button"
                      onClick={() => setAscending(!ascending)}
                    >
                      {ascending ? (
                        <ArrowUp size={13} />
                      ) : (
                        <ArrowDown size={13} />
                      )}
                      {ascending ? "最早优先" : "最新优先"}
                    </button>
                  </div>
                  <div className="timeline-toolbar">
                    <div className="filter-tabs" aria-label="分析状态筛选">
                      {[
                        ["all", "全部"],
                        ["completed", "已分析"],
                        ["pending", "待分析"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={filter === value ? "selected" : ""}
                          aria-pressed={filter === value}
                          onClick={() => setFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="search-field">
                      <Search size={15} />
                      <input
                        ref={searchRef}
                        placeholder="搜索灵感或关键词"
                        aria-label="搜索灵感或关键词"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      <kbd>⌘ K</kbd>
                    </label>
                  </div>
                  {tag && (
                    <div className="active-filter">
                      关键词：{tag}
                      <button
                        aria-label="清除关键词筛选"
                        onClick={() => setTag(null)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                  {loading ? (
                    <div className="loading-block">
                      <LoaderCircle size={21} className="spin" />
                      <span>正在展开你的灵感轨迹…</span>
                    </div>
                  ) : loadError ? (
                    <ErrorState message={loadError} onRetry={reload} />
                  ) : visible.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-art">
                        <TraceDrawing small />
                        <span>
                          <Feather size={23} strokeWidth={1.4} />
                        </span>
                      </div>
                      <h3>
                        {ideas.length === 0
                          ? "你的下一次发现，从这里开始"
                          : view === "bookmarks"
                            ? "把值得深入的想法收藏起来"
                            : "暂时没有匹配的灵感"}
                      </h3>
                      <p>
                        {ideas.length === 0
                          ? "不需要完美的论证，也不需要完整的计划。\n写下第一条灵感，为未来的发现留一条线索。"
                          : view === "bookmarks"
                            ? "点击灵感卡片上的书签，留给未来的自己。"
                            : "换个关键词，或调整筛选条件再试试。"}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => {
                          if (ideas.length === 0) setComposerOpen(true);
                          else home("timeline");
                        }}
                      >
                        {ideas.length === 0 ? (
                          <>
                            <Plus size={16} />
                            记录第一条灵感
                          </>
                        ) : (
                          "查看全部灵感"
                        )}
                      </button>
                      <span className="empty-bottom">
                        EVERY DISCOVERY BEGINS WITH A THOUGHT
                      </span>
                    </div>
                  ) : (
                    <div className="timeline">
                      {groups.map(([day, records]) => (
                        <div className="day-group" key={day}>
                          <div className="day-heading">
                            <span className="day-node" />
                            <h3>
                              {day === (now ? dateFormatter.format(now) : "")
                                ? "今天"
                                : day}
                            </h3>
                            {day === (now ? dateFormatter.format(now) : "") && (
                              <span>{day}</span>
                            )}
                            <span className="day-count">
                              {records.length} 条灵感
                            </span>
                          </div>
                          {records.map((idea) => (
                            <article className="idea-row" key={idea.id}>
                              <div className="time-marker">
                                <time dateTime={idea.createdAt}>
                                  {timeFormatter.format(
                                    new Date(idea.createdAt),
                                  )}
                                </time>
                                <span />
                              </div>
                              <div className="idea-card">
                                <div className="idea-card-top">
                                  <Status idea={idea} />
                                  <button
                                    className={`icon-button bookmark-button ${idea.bookmarked ? "bookmarked" : ""}`}
                                    disabled={bookmarkBusy === idea.id}
                                    aria-label={
                                      idea.bookmarked ? "取消收藏" : "收藏灵感"
                                    }
                                    onClick={() => void toggleBookmark(idea)}
                                  >
                                    <Bookmark
                                      size={16}
                                      fill={
                                        idea.bookmarked
                                          ? "currentColor"
                                          : "none"
                                      }
                                    />
                                  </button>
                                </div>
                                <a
                                  href={`/ideas/${idea.id}`}
                                  className="idea-card-main"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    navigate(idea.id);
                                  }}
                                >
                                  <h3>
                                    {idea.analysis?.title || idea.title}
                                    <ArrowUpRight size={17} />
                                  </h3>
                                  <p>{idea.content}</p>
                                </a>
                                <div className="idea-card-footer">
                                  <div className="tags">
                                    {tagsOf(idea)
                                      .slice(0, 3)
                                      .map((value) => (
                                        <button
                                          key={value}
                                          onClick={() => setTag(value)}
                                        >
                                          # {value}
                                        </button>
                                      ))}
                                  </div>
                                  <button
                                    className="card-link"
                                    onClick={() => navigate(idea.id)}
                                  >
                                    {idea.status === "completed"
                                      ? "查看分析"
                                      : "展开灵感"}
                                    <ArrowRight size={14} />
                                  </button>
                                </div>
                                {idea.analysis && (
                                  <div className="idea-insight">
                                    <Sparkles size={13} />
                                    <p>{idea.analysis.summary}</p>
                                  </div>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      ))}
                      <div className="timeline-end">
                        <span />
                        每一次记录，都是下一步的起点
                      </div>
                    </div>
                  )}
                </section>
                <aside className="insights-sidebar">
                  <section className="overview">
                    <div className="section-label">
                      <Orbit size={17} />
                      <h2>思考的足迹</h2>
                      <span className="eyebrow">OVERVIEW</span>
                    </div>
                    <div className="overview-numbers">
                      <div>
                        <strong>
                          {ideas.length.toString().padStart(2, "0")}
                        </strong>
                        <span>记录的灵感</span>
                      </div>
                      <div>
                        <strong>{completed.toString().padStart(2, "0")}</strong>
                        <span>AI 已分析</span>
                      </div>
                    </div>
                    <Activity ideas={ideas} now={now} />
                    <div className="overview-foot">
                      <span>一点一滴，积累成发现</span>
                      <Sprout size={16} />
                    </div>
                  </section>
                  <section className="ai-connect-card">
                    <span className="ai-icon">
                      <Sparkles size={18} />
                    </span>
                    <span
                      className={`mini-badge ${connection?.configured ? "ready" : ""}`}
                    >
                      {connection?.configured ? "已连接" : "等待连接"}
                    </span>
                    <h3>给灵感一个新视角</h3>
                    <p>
                      {connection?.configured
                        ? `由 ${connection.model} 帮你梳理研究问题与下一步。`
                        : "连接你选择的 AI，让每个想法多一份深入探索的可能。"}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setSettingsOpen(true)}
                    >
                      {connection?.configured ? "查看 AI 连接" : "连接 AI 服务"}
                      <ArrowUpRight size={14} />
                    </button>
                  </section>
                  <section className="field-note">
                    <span className="eyebrow">A NOTE TO YOURSELF</span>
                    <span className="quote-mark">“</span>
                    <blockquote>
                      先把想法留下，
                      <br />
                      答案可以慢慢找。
                    </blockquote>
                    <span className="note-line" />
                    <p>保持好奇，允许不确定。</p>
                  </section>
                </aside>
              </div>
              <footer className="page-footer">
                <span>研迹 TRACE</span>
                <span>为好奇心留白，为灵感留痕。</span>
                <span>{now ? now.getFullYear() : ""}</span>
              </footer>
            </>
          )}
        </main>
      </div>

      <Dialog
        open={composerOpen}
        onClose={() => {
          if (!saving) setComposerOpen(false);
        }}
        title="捕捉一束灵感"
        className="composer-dialog"
      >
        <form onSubmit={saveIdea}>
          <div className="composer-intro">
            <span className="composer-feather">
              <Feather size={25} strokeWidth={1.3} />
            </span>
            <div className="eyebrow">MAKE ROOM FOR A NEW IDEA</div>
            <h2>此刻的想法，值得留下。</h2>
            <p>无需组织语言，让思考自然发生。</p>
          </div>
          <div className="composer-input">
            <label className="sr-only" htmlFor="idea-content">
              写下你的科研灵感
            </label>
            <textarea
              id="idea-content"
              autoFocus
              placeholder={
                "我在想，是否可以…\n\n一个实验中的观察，一篇论文带来的问题，或是一个大胆的假设。"
              }
              maxLength={MAX_CONTENT_LENGTH}
              value={draft.content}
              disabled={saving}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  content: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void saveIdea();
                }
              }}
            />
            <span className="character-count">
              {draft.content.length.toLocaleString()} / 12,000
            </span>
          </div>
          <label className="tag-input">
            <Hash size={15} />
            <input
              value={draft.tags}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  tags: event.target.value,
                }))
              }
              disabled={saving}
              placeholder="添加关键词，用逗号分隔（可选）"
              aria-label="灵感关键词，用逗号分隔"
              maxLength={200}
            />
          </label>
          {saveError && (
            <p className="form-error" role="alert">
              {saveError}
            </p>
          )}
          <div className="composer-footer">
            <span>
              <Clock3 size={13} />
              保存时自动记录时间
            </span>
            <button
              className="button primary"
              type="submit"
              disabled={!draft.content.trim() || saving || !draftReady}
            >
              {saving ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Plus size={16} />
              )}
              {saving ? "正在保存" : "保存灵感"}
              <kbd>⌘ ↵</kbd>
            </button>
          </div>
          <p className="composer-hint">
            {connection?.configured
              ? "保存后，AI 会自动为你梳理思路。"
              : "先记录，后探索。连接 AI 后，可随时补充分析。"}
          </p>
        </form>
      </Dialog>

      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="AI 连接"
        className="settings-dialog"
      >
        <div className="settings-intro">
          <span className="orb">
            <Sparkles size={25} />
          </span>
          <h2>
            {connection?.configured ? "你的思考助手已就绪" : "连接一个思考助手"}
          </h2>
          <p>
            支持 OpenAI 兼容接口。选择你熟悉的服务，
            <br />
            为灵感生成简洁的研究建议。
          </p>
        </div>
        <div className="connection-status">
          <span
            className={`connection-dot ${connection?.configured ? "connected" : ""}`}
          />
          <span>
            {connection?.configured
              ? `已连接 · ${connection.model}`
              : "尚未配置 AI 服务"}
          </span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                const config = await api<Connection>("/api/config");
                setConnection(config);
                setToast(
                  config.configured
                    ? "AI 配置已就绪"
                    : "尚未检测到完整的 AI 配置",
                );
              } catch (error) {
                setToast((error as Error).message);
              }
            }}
          >
            刷新状态
          </button>
        </div>
        <div className="settings-info">
          <h3>连接后，你会获得</h3>
          <div>
            <Check size={14} />
            核心研究问题与灵感概述
          </div>
          <div>
            <Check size={14} />
            潜在价值、可行路径与局限
          </div>
          <div>
            <Check size={14} />
            可以着手尝试的下一步
          </div>
        </div>
        <details className="config-details">
          <summary>
            查看服务端配置方法
            <ChevronRight size={15} />
          </summary>
          <p>
            本地运行时，在项目目录创建 <code>.dev.vars</code>
            ，填写服务地址、模型名称与密钥，然后重新启动网页。密钥不会进入浏览器，也不会提交到
            Git。
          </p>
          <pre>
            AI_BASE_URL="https://你的服务地址/v1"{"\n"}AI_MODEL="模型名称"{"\n"}
            AI_API_KEY="你的密钥"
          </pre>
          <p>
            如部署到
            Sites，在站点的环境变量中配置同名字段并重新发布。未连接时，记录和回看功能照常可用。
          </p>
        </details>
        <button
          className="button primary full-width"
          onClick={() => setSettingsOpen(false)}
        >
          继续记录我的想法
          <ArrowRight size={16} />
        </button>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        title="删除这条灵感？"
        className="delete-dialog"
      >
        <p>
          原始内容和对应的 AI
          分析将一并删除，且无法恢复。你也可以先导出全部笔记。
        </p>
        <div className="delete-actions">
          <button
            className="button secondary"
            disabled={deleting}
            onClick={() => setDeleteOpen(false)}
          >
            保留灵感
          </button>
          <button
            className="button danger"
            disabled={deleting}
            onClick={() => void deleteIdea()}
          >
            {deleting ? "正在删除…" : "确认删除"}
          </button>
        </div>
      </Dialog>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={16} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
