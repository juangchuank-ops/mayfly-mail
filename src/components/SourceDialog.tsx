import { useState } from "react";
import { Check, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import { MailTmProvider } from "../lib/mailtm";
import { CloudflareEmailProvider } from "../lib/cloudflare";
import type { SourceConfig, SourceType } from "../hooks/useMailbox";

interface Props {
  open: boolean;
  sources: SourceConfig[];
  onClose: () => void;
  onAdd: (s: { name: string; type: SourceType; baseUrl: string; token?: string }) => void;
  onDelete: (id: string) => void;
}

/**
 * 数据源管理：内置公共源 + 用户自建源（mail.tm 兼容 / Cloudflare Worker）。
 * 自建源契约：
 * - mail.tm 兼容：GET /domains、POST /accounts、POST /token、GET /messages…
 * - Cloudflare Worker：GET /open_api/settings、POST /api/new_address、GET /api/mails…
 */
export function SourceDialog({ open, sources, onClose, onAdd, onDelete }: Props) {
  const [type, setType] = useState<SourceType>("cloudflare");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (!open) return null;

  const resetForm = () => {
    setName("");
    setBaseUrl("");
    setToken("");
    setTestResult(null);
  };

  const canSubmit = name.trim().length > 0 && /^(https?:\/\/|\/)/.test(baseUrl.trim());

  const runTest = async () => {
    const url = baseUrl.trim();
    setTesting(true);
    setTestResult(null);
    try {
      const provider =
        type === "cloudflare"
          ? new CloudflareEmailProvider({ baseUrl: url, adminToken: token.trim() || undefined })
          : new MailTmProvider({ baseUrl: url, staticToken: token.trim() || undefined });
      const ok = await provider.available();
      setTestResult(
        ok
          ? { ok: true, text: "连接成功，接口可用。" }
          : { ok: false, text: "连不上或接口形状不对：请确认地址、鉴权与 CORS 设置。" },
      );
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : "测试失败。" });
    } finally {
      setTesting(false);
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    onAdd({
      name: name.trim(),
      type,
      baseUrl: baseUrl.trim().replace(/\/+$/, ""),
      ...(token.trim() ? { token: token.trim() } : {}),
    });
    resetForm();
  };

  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div
        className="dialog source-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="管理数据源"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="source-head">
          <h2>数据源</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} aria-hidden />
          </button>
        </div>
        <p className="source-desc">
          每个自建数据源需提供与所选类型一致的接口；同一数据源下可以创建多个邮箱，切换器里会标注来源。
        </p>

        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id} className="source-row">
              <div className="source-row-main">
                <div className="source-row-name">
                  {s.name}
                  <span className="box-src-tag">{s.type === "cloudflare" ? "CF Worker" : "mail.tm 兼容"}</span>
                  {s.builtin && <span className="box-src-tag">内置</span>}
                </div>
                <div className="source-row-url">{s.baseUrl}</div>
              </div>
              {s.token && (
                <span className="source-token">
                  <Lock size={11} aria-hidden />
                  令牌
                </span>
              )}
              <button
                type="button"
                className="icon-btn source-remove"
                onClick={() => {
                  setRemoving(s.id);
                  onDelete(s.id);
                  setRemoving(null);
                }}
                disabled={s.builtin || removing === s.id}
                aria-label={`删除数据源 ${s.name}`}
                title={s.builtin ? "内置数据源不可删除" : "删除此数据源（其下邮箱一并移除）"}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <div className="source-form" aria-label="添加自建数据源">
          <div className="source-form-title">
            <Plus size={14} aria-hidden />
            添加自建数据源
          </div>

          <div className="seg" role="radiogroup" aria-label="数据源类型">
            <button
              type="button"
              role="radio"
              aria-checked={type === "cloudflare"}
              className={type === "cloudflare" ? "seg-item on" : "seg-item"}
              onClick={() => {
                setType("cloudflare");
                setTestResult(null);
              }}
            >
              Cloudflare Worker
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={type === "mailtm"}
              className={type === "mailtm" ? "seg-item on" : "seg-item"}
              onClick={() => {
                setType("mailtm");
                setTestResult(null);
              }}
            >
              mail.tm 兼容
            </button>
          </div>

          <div className="field">
            <label htmlFor="src-name">名称</label>
            <input
              id="src-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "cloudflare" ? "我的域名邮箱" : "备用公共源"}
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
            />
          </div>
          <div className="field">
            <label htmlFor="src-url">API 地址</label>
            <input
              id="src-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                type === "cloudflare"
                  ? "https://mail-worker.example.workers.dev"
                  : "https://mail.example.com/api"
              }
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
            <span className="field-hint">
              {type === "cloudflare"
                ? "Worker 根地址；域名列表从 /open_api/settings 读取。"
                : "需兼容 mail.tm 接口形状（/domains /accounts /token /messages）。"}
            </span>
          </div>
          <div className="field">
            <label htmlFor="src-token">{type === "cloudflare" ? "管理令牌（可选）" : "静态令牌（可选）"}</label>
            <input
              id="src-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={type === "cloudflare" ? "用于读取设置与删除邮件" : "后端有网关令牌时填写"}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {testResult && (
            <div className={testResult.ok ? "test-result ok" : "test-result bad"} role="status">
              {testResult.ok ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
              {testResult.text}
            </div>
          )}

          <div className="source-form-actions">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => void runTest()}
              disabled={!canSubmit || testing}
            >
              {testing ? <Loader2 size={14} className="spin" aria-hidden /> : null}
              测试连接
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={submit}
              disabled={!canSubmit}
            >
              添加
            </button>
          </div>
          <p className="field-hint">
            浏览器直连自建地址需要后端开启 CORS；HTTPS 页面无法请求 HTTP 接口（混合内容限制）。
          </p>
        </div>
      </div>
    </div>
  );
}
