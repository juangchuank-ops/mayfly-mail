import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  EyeOff,
  FileCode2,
  Loader2,
  Mail,
  Trash2,
} from "lucide-react";
import { type MessageDetail } from "../lib/types";
import { formatFullTime } from "../lib/time";
import { buildFrameDoc, enableRemoteImages, sanitizeMailHtml } from "../lib/sanitize";
import { copyText } from "../lib/clipboard";
import { CodeStrip } from "./CodeStrip";

interface Props {
  message: MessageDetail;
  dark: boolean;
  onBack: () => void;
  onNotify: (text: string, error?: boolean) => void;
  onMarkUnread: (id: string) => void;
  onDelete: (id: string) => void;
  getRaw: (id: string) => Promise<string | null>;
}

/** 原始邮件视图：完整 MIME 报文（含邮件头），只读、可复制。 */
function RawView({
  message,
  getRaw,
  onNotify,
}: {
  message: MessageDetail;
  getRaw: (id: string) => Promise<string | null>;
  onNotify: (t: string, e?: boolean) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void getRaw(message.id).then((text) => {
      if (!alive) return;
      if (text === null) setFailed(true);
      else setRaw(text);
    });
    return () => {
      alive = false;
    };
  }, [message.id, getRaw]);

  const copyAll = async () => {
    if (!raw) return;
    const ok = await copyText(raw);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
    onNotify(ok ? "原始邮件已复制" : "复制失败", !ok);
  };

  const download = () => {
    if (!raw) return;
    const blob = new Blob([raw], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${message.id}.eml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sourceNote = message.rawAvailable
    ? "完整原始报文 · MIME，含邮件头"
    : "仅解析后正文，此邮件服务未提供完整原文";

  return (
    <div className="raw-wrap">
      <div className="raw-head">
        <FileCode2 size={15} aria-hidden />
        <span className="tag">原始邮件</span>
        <span>{sourceNote}</span>
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          onClick={copyAll}
          disabled={!raw}
          aria-label="复制全部原始内容"
          title="复制全部"
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={download}
          disabled={!raw}
          aria-label="下载为 .eml 文件"
          title="下载 .eml"
        >
          <Download size={15} aria-hidden />
        </button>
      </div>
      {failed ? (
        <div className="state-block" role="status">
          <div className="state-title">拿不到原始邮件</div>
          <div className="state-detail">邮件服务没有返回这封邮件的原始报文，可能已过期或被清理。</div>
        </div>
      ) : raw === null ? (
        <div className="raw-loading" role="status">
          <Loader2 size={18} className="spin" aria-hidden />
          <span>正在获取原始邮件…</span>
        </div>
      ) : (
        <pre className="raw-pre">{raw}</pre>
      )}
    </div>
  );
}

export function Reader({
  message,
  dark,
  onBack,
  onNotify,
  onMarkUnread,
  onDelete,
  getRaw,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [showImages, setShowImages] = useState(false);

  const sanitized = useMemo(() => sanitizeMailHtml(message.html[0] ?? ""), [message.html]);
  const frameDoc = useMemo(
    () => buildFrameDoc(showImages ? enableRemoteImages(sanitized.html) : sanitized.html, dark),
    [sanitized, showImages, dark],
  );

  const htmlMode = message.html.length > 0;

  const copyPlain = async () => {
    const text = message.text ?? message.subject;
    const ok = await copyText(text);
    onNotify(ok ? "正文已复制" : "复制失败，请手动选择复制", !ok);
  };

  return (
    <>
      <header className="reader-head">
        <div className="reader-head-top">
          <button
            type="button"
            className="icon-btn reader-back"
            onClick={onBack}
            aria-label="返回邮件列表"
          >
            <ArrowLeft size={17} aria-hidden />
          </button>
        </div>
        <h2 className="reader-subject">{message.subject}</h2>
        <div className="reader-meta">
          <span className="who">
            <b>{message.fromName}</b> &lt;{message.fromAddress}&gt;
          </span>
          <span className="when">{formatFullTime(message.createdAt)}</span>
        </div>
        <div className="reader-actions">
          {message.rawAvailable && (
            <button
              type="button"
              className={showRaw ? "btn btn-sm" : "btn btn-quiet btn-sm"}
              onClick={() => setShowRaw((v) => !v)}
              aria-pressed={showRaw}
            >
              <FileCode2 size={14} aria-hidden />
              {showRaw ? "返回正文" : "查看原文"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => onMarkUnread(message.id)}
          >
            <EyeOff size={14} aria-hidden />
            标记未读
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={copyPlain}>
            <Copy size={14} aria-hidden />
            复制正文
          </button>
          <button
            type="button"
            className="btn btn-danger-quiet btn-sm"
            onClick={() => onDelete(message.id)}
          >
            <Trash2 size={14} aria-hidden />
            删除
          </button>
        </div>
      </header>

      <div className="reader-body" key={message.id}>
        {showRaw ? (
          <RawView message={message} getRaw={getRaw} onNotify={onNotify} />
        ) : (
          <div className="reader-body-inner">
            <CodeStrip message={message} onNotify={onNotify} />

            {htmlMode ? (
              <>
                {sanitized.hadRemoteImages && !showImages && (
                  <div className="img-note">
                    <span>为保护隐私，这封邮件的远程图片没有加载。</span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setShowImages(true)}
                    >
                      显示图片
                    </button>
                  </div>
                )}
                <iframe
                  className="mail-frame"
                  title={`邮件内容：${message.subject}`}
                  sandbox="allow-same-origin allow-popups"
                  srcDoc={frameDoc}
                  onLoad={(e) => {
                    const frame = e.currentTarget;
                    try {
                      const h = frame.contentDocument?.documentElement?.scrollHeight ?? 0;
                      if (h > 0) frame.style.height = `${Math.min(Math.max(h, 320), 6000)}px`;
                    } catch {
                      /* 受沙箱限制时保持默认高度 */
                    }
                  }}
                />
              </>
            ) : message.text ? (
              <div className="reader-plain">{message.text}</div>
            ) : (
              <div className="state-block">
                <Mail size={22} aria-hidden />
                <div className="state-title">这封邮件没有正文</div>
                <div className="state-detail">它可能只包含附件，或内容为空。</div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
