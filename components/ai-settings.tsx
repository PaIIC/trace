"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Unplug,
} from "lucide-react";
import { api } from "@/lib/api-client";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEEPSEEK_MODELS,
} from "@/lib/connection-types";
import type { Connection } from "@/lib/connection-types";
import { Dialog } from "./notebook-parts";

export function AISettings({
  onClose,
  onConnection,
}: {
  onClose: () => void;
  onConnection: (value: Connection) => void;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_DEEPSEEK_MODEL);
  const [custom, setCustom] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const saved = connection?.source === "saved";

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api<Connection>("/api/config")
      .then((value) => {
        if (!active) return;
        setConnection(value);
        onConnection(value);
        if (value.source === "saved" && value.model) {
          setModel(value.model);
          setCustom(!DEEPSEEK_MODELS.some((item) => item === value.model));
        }
      })
      .catch((error: Error) => {
        if (active) setLoadError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onConnection, reload]);

  async function perform(action: "test" | "save" | "remove") {
    if (busy || loading || loadError) return;
    setFeedback(null);
    if (action !== "remove" && (!model.trim() || (!saved && !apiKey.trim()))) {
      setFeedback({
        kind: "error",
        text: !model.trim()
          ? "请填写模型名称。"
          : "请先填写 DeepSeek API Key。",
      });
      return;
    }
    setBusy(action);
    try {
      if (action === "test") {
        const result = await api<{ message: string }>("/api/config/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "deepseek", model, apiKey }),
        });
        setFeedback({
          kind: "success",
          text: `${result.message} ${apiKey || model !== connection?.model ? "请保存连接以应用此配置。" : ""}`,
        });
      } else {
        const value = await api<Connection>(
          "/api/config",
          action === "remove"
            ? { method: "DELETE" }
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider: "deepseek", model, apiKey }),
              },
        );
        setConnection(value);
        onConnection(value);
        setApiKey("");
        setShowKey(false);
        setConfirmRemove(false);
        setFeedback({
          kind: "success",
          text:
            action === "save"
              ? "连接已保存，新灵感将自动分析；已有灵感可进入详情页补充分析。"
              : value.configured
                ? "已移除 DeepSeek 配置，恢复使用原有预设服务。"
                : "已移除连接，灵感和已有分析均已保留。",
        });
      }
    } catch (error) {
      setFeedback({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="AI 连接"
      className="settings-dialog"
    >
      <div className="settings-intro">
        <span className="orb">
          <Sparkles size={25} />
        </span>
        <h2>给灵感一个思考伙伴</h2>
        <p>接入 DeepSeek，让每一个想法多走一步。</p>
      </div>
      {loading ? (
        <p className="settings-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          正在读取连接…
        </p>
      ) : loadError ? (
        <div className="settings-load-error" role="alert">
          <p>{loadError}</p>
          <button
            className="text-button"
            onClick={() => setReload((value) => value + 1)}
          >
            重新加载
          </button>
        </div>
      ) : (
        <div className="connection-status">
          <span
            className={`connection-dot ${connection?.configured ? "connected" : ""}`}
          />
          <span>
            {saved
              ? `已保存 · ${connection.model}`
              : connection?.configured
                ? `当前预设 · ${connection.model}`
                : "尚未配置，填写后即可保存"}
          </span>
        </div>
      )}
      <form
        className="connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          void perform("save");
        }}
      >
        <fieldset disabled={loading || !!loadError || !!busy}>
          <div className="provider-option">
            <span className="provider-mark">
              <Sparkles size={20} />
            </span>
            <div>
              <strong>DeepSeek</strong>
              <span>官方 API · api.deepseek.com</span>
            </div>
            <Check size={17} />
          </div>
          <div className="connection-label-row">
            <label htmlFor="deepseek-key">API Key</label>
            <a
              href="https://platform.deepseek.com/api_keys"
              target="_blank"
              rel="noreferrer"
            >
              获取密钥
              <ArrowUpRight size={13} />
            </a>
          </div>
          <div className="connection-key-field">
            <KeyRound size={16} aria-hidden="true" />
            <input
              id="deepseek-key"
              name="deepseek-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                setFeedback(null);
              }}
              placeholder={
                saved ? "已保存，留空沿用原密钥" : "粘贴你的 DeepSeek API Key"
              }
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={512}
              aria-describedby="connection-key-hint"
            />
            <button
              className="icon-button"
              type="button"
              aria-label={showKey ? "隐藏密钥" : "显示密钥"}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p id="connection-key-hint" className="connection-hint">
            {saved
              ? `已保存密钥尾号 ${connection.keyHint}。填写新密钥可替换。`
              : "只需填写一次，之后会自动使用。"}
          </p>
          <label htmlFor="deepseek-model">分析模型</label>
          <select
            id="deepseek-model"
            value={custom ? "custom" : model}
            onChange={(event) => {
              const isCustom = event.target.value === "custom";
              setCustom(isCustom);
              setModel(isCustom ? "" : event.target.value);
              setFeedback(null);
            }}
          >
            <option value="deepseek-flash">
              DeepSeek Flash · 日常灵感分析
            </option>
            <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
            <option value="custom">自定义模型名称</option>
          </select>
          {custom && (
            <input
              className="connection-custom-model"
              aria-label="自定义模型名称"
              value={model}
              maxLength={100}
              placeholder="填写 DeepSeek 模型 ID"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setModel(event.target.value);
                setFeedback(null);
              }}
            />
          )}
          <p className="connection-hint">
            测试仅验证密钥与模型可用性，不提交灵感内容。
          </p>
          <div className="connection-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => void perform("test")}
            >
              {busy === "test" && <LoaderCircle size={15} className="spin" />}
              {busy === "test" ? "正在测试…" : "测试连接"}
            </button>
            <button type="submit" className="button primary">
              {busy === "save" ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              {busy === "save" ? "正在保存…" : "保存连接"}
            </button>
          </div>
        </fieldset>
      </form>
      {feedback && (
        <p
          className={`connection-feedback ${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
      <p className="connection-privacy">
        <ShieldCheck size={16} />
        <span>
          密钥在服务端加密保存，不写入浏览器存储或笔记导出。生成分析时，灵感内容会发送至
          DeepSeek。
        </span>
      </p>
      <div className="connection-footer">
        {saved && !confirmRemove && (
          <button
            className="text-button remove-connection"
            disabled={!!busy}
            onClick={() => setConfirmRemove(true)}
          >
            <Unplug size={13} />
            移除连接
          </button>
        )}
        {confirmRemove && (
          <div className="connection-remove-confirm">
            <span>移除已保存的密钥？</span>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => setConfirmRemove(false)}
            >
              取消
            </button>
            <button
              className="text-button remove-connection"
              disabled={!!busy}
              onClick={() => void perform("remove")}
            >
              {busy === "remove" ? "正在移除…" : "确认移除"}
            </button>
          </div>
        )}
        <button
          className="text-button connection-done"
          disabled={!!busy}
          onClick={onClose}
        >
          完成
        </button>
      </div>
    </Dialog>
  );
}
