import { useState, type ReactNode } from "react";
import { Copy, Check, RefreshCw, FlaskConical, TriangleAlert } from "lucide-react";
import { copyText } from "../lib/clipboard";
import type { Mailbox } from "../lib/types";

export type PlatePhase = "booting" | "ready" | "expired" | "demo" | "error" | "provisioning";

interface Props {
  mailbox: Mailbox | null;
  phase: PlatePhase;
  bootError: string | null;
  creating: boolean;
  creatingReal: boolean;
  /** 铭牌右侧的邮箱切换器（多数据源 / 多邮箱）。 */
  switcher?: ReactNode;
  /** 当前邮箱所属数据源名（demo 条目显示「演示」）。 */
  sourceName?: string | null;
  onCopyFeedback: (text: string, error?: boolean) => void;
  onNewAddress: () => void;
  /** 错误态下的直接重试（无需确认）。 */
  onRetryCreate: () => void;
  onRetryReal: () => void;
  onEnterDemo: () => void;
}

export function AddressPlate({
  mailbox,
  phase,
  bootError,
  creating,
  creatingReal,
  switcher,
  sourceName,
  onCopyFeedback,
  onNewAddress,
  onRetryCreate,
  onRetryReal,
  onEnterDemo,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!mailbox) return;
    const ok = await copyText(mailbox.address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopyFeedback("地址已复制");
    } else {
      onCopyFeedback("复制失败，请手动选择地址复制", true);
    }
  };

  const chip =
    phase === "demo" ? (
      <span className="plate-chip">
        <span className="dot" aria-hidden />
        演示
      </span>
    ) : phase === "ready" ? (
      <span className="plate-chip live">
        <span className="dot" aria-hidden />
        在线
      </span>
    ) : phase === "provisioning" ? (
      <span className="plate-chip">
        <span className="dot pulse" aria-hidden />
        开通中
      </span>
    ) : null;

  const statusLine =
    phase === "error" ? (
      <div className="plate-address loading">
        <TriangleAlert size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
        没能生成地址
      </div>
    ) : mailbox ? (
      <div className="plate-address" translate="no">
        {mailbox.address}
      </div>
    ) : (
      <div className="plate-address loading" aria-live="polite">
        {phase === "expired" ? "邮箱已失效" : "正在生成地址…"}
      </div>
    );

  return (
    <section className="plate-zone" aria-label="当前临时邮箱地址">
      <div className="plate">
        <div className="plate-head">
          <span className="plate-label">当前地址{sourceName ? ` · ${sourceName}` : ""}</span>
          {chip}
          {switcher}
        </div>

        {statusLine}

        {phase === "expired" && (
          <p className="plate-hint">
            上次的临时地址已过期。生成一个新地址即可继续收信，旧地址里的邮件无法找回。
          </p>
        )}
        {phase === "provisioning" && (
          <p className="plate-hint" role="status">
            地址已创建，正在等待邮件服务开通（通常几秒到几分钟），开通后会自动开始收信。
          </p>
        )}
        {phase === "demo" && (
          <p className="plate-hint">
            演示地址不会真的收信，界面上是模拟邮件，用于预览完整功能。
          </p>
        )}
        {phase === "error" && (
          <p className="plate-hint" role="status">
            {bootError ?? "邮件服务暂时没有响应。"} 可以重试，或先进入演示模式看看界面。
          </p>
        )}

        <div className="plate-actions">
          {phase === "error" ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onRetryCreate}
                disabled={creating}
              >
                {creating ? <RefreshCw size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
                重试
              </button>
              <button type="button" className="btn btn-sm" onClick={onEnterDemo}>
                <FlaskConical size={14} aria-hidden />
                进入演示模式
              </button>
            </>
          ) : phase === "demo" ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={copyAddress}
                disabled={!mailbox}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? "已复制" : "复制地址"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={onRetryReal}
                disabled={creatingReal}
              >
                {creatingReal ? <RefreshCw size={14} className="spin" aria-hidden /> : null}
                重试连接真实服务
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={copyAddress}
                disabled={!mailbox}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                {copied ? "已复制" : "复制地址"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={onNewAddress}
                disabled={creating || phase === "booting"}
              >
                {creating ? <RefreshCw size={14} className="spin" aria-hidden /> : null}
                {creating ? "正在生成…" : "更换地址"}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
