"use client";

import { useRef, useState } from "react";
import { Clock3, Hash, LoaderCircle, Save, Sparkles } from "lucide-react";
import type { Idea } from "@/lib/domain";
import { MAX_CONTENT_LENGTH } from "@/lib/domain";
import { api, ApiError } from "@/lib/api-client";
import { Dialog, fullDate } from "./notebook-parts";

export function IdeaEditor({
  idea,
  aiConfigured,
  onClose,
  onSaved,
}: {
  idea: Idea;
  aiConfigured: boolean;
  onClose: () => void;
  onSaved: (idea: Idea, regenerate: boolean) => void;
}) {
  const [content, setContent] = useState(idea.content);
  const [tags, setTags] = useState(idea.tags.join("，"));
  const [revision, setRevision] = useState(idea.revision);
  const [saving, setSaving] = useState<"save" | "analyze" | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Idea | null>(null);
  const [reading, setReading] = useState(false);
  const [discard, setDiscard] = useState(false);
  const guard = useRef(false);
  const dirty = content !== idea.content || tags !== idea.tags.join("，");

  function close() {
    if (guard.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  }

  async function save(regenerate: boolean) {
    if (guard.current || !content.trim() || conflict) return;
    const values = [
      ...new Set(
        tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    if (values.length > 8 || values.some((tag) => tag.length > 24)) {
      setError("最多添加 8 个标签，每个不超过 24 字。");
      return;
    }
    guard.current = true;
    setSaving(regenerate ? "analyze" : "save");
    setError("");
    setDiscard(false);
    try {
      const result = await api<{ idea: Idea }>(`/api/ideas/${idea.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, tags: values, revision }),
      });
      onSaved(result.idea, regenerate);
    } catch (error) {
      setError((error as Error).message);
      setConflict(error instanceof ApiError && error.status === 409);
      setLatest(null);
    } finally {
      guard.current = false;
      setSaving(null);
    }
  }

  async function readLatest() {
    setReading(true);
    try {
      const result = await api<{ idea: Idea }>(`/api/ideas/${idea.id}`);
      setLatest(result.idea);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setReading(false);
    }
  }

  return (
    <Dialog open onClose={close} title="编辑灵感" className="edit-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        <div className="composer-intro">
          <div className="eyebrow">LET YOUR IDEA EVOLVE</div>
          <h2>让想法，再向前一步。</h2>
          <p>补充细节、调整方向，让新的分析跟上你的思考。</p>
        </div>
        <div className="composer-input">
          <label className="sr-only" htmlFor="edit-idea-content">
            修改灵感内容
          </label>
          <textarea
            id="edit-idea-content"
            autoFocus
            value={content}
            maxLength={MAX_CONTENT_LENGTH}
            disabled={!!saving}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void save(false);
              }
            }}
          />
          <span className="character-count">
            {content.length.toLocaleString()} / 12,000
          </span>
        </div>
        <label className="tag-input">
          <Hash size={15} />
          <input
            aria-label="修改灵感关键词，用逗号分隔"
            placeholder="添加关键词，用逗号分隔（可选）"
            value={tags}
            maxLength={216}
            disabled={!!saving}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
        <p className="edit-timestamp">
          <Clock3 size={13} />
          <span>
            记录于{" "}
            <time dateTime={idea.createdAt}>{fullDate(idea.createdAt)}</time>
            ，保留原始时间
          </span>
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {conflict && (
          <div className="edit-conflict">
            {latest ? (
              <>
                <strong>当前已保存的内容</strong>
                <p>{latest.content}</p>
                <p>关键词：{latest.tags.join("、") || "无"}</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setRevision(latest.revision);
                    setConflict(false);
                    setLatest(null);
                    setError("");
                  }}
                >
                  已查看，保留我的草稿继续编辑
                </button>
              </>
            ) : (
              <button
                type="button"
                className="text-button"
                disabled={reading}
                onClick={() => void readLatest()}
              >
                {reading ? "正在读取…" : "查看最新内容"}
              </button>
            )}
          </div>
        )}
        {discard && (
          <div className="edit-discard" role="alert">
            <span>修改尚未保存，是否放弃？</span>
            <div>
              <button
                type="button"
                className="text-button"
                onClick={() => setDiscard(false)}
              >
                继续编辑
              </button>
              <button
                type="button"
                className="text-button danger-hover"
                onClick={onClose}
              >
                放弃修改
              </button>
            </div>
          </div>
        )}
        <div className="edit-actions">
          <button
            type="submit"
            className="button secondary"
            disabled={!!saving || !content.trim() || conflict}
          >
            {saving === "save" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Save size={15} />
            )}
            {saving === "save" ? "正在保存…" : "保存修改"}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!!saving || !content.trim() || conflict}
            onClick={() => void save(true)}
          >
            {saving === "analyze" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Sparkles size={15} />
            )}
            {saving === "analyze" ? "正在保存…" : "保存并重新分析"}
          </button>
        </div>
        <p className="edit-hint">
          {aiConfigured
            ? "修改先保存，再生成分析；分析失败也不会丢失修改。"
            : "可先保存修改；重新分析需要连接 AI 服务。"}
        </p>
      </form>
    </Dialog>
  );
}
