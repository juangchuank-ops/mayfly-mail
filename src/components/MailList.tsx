import { Paperclip, RefreshCw, Inbox, AlertTriangle } from "lucide-react";
import { type MessageSummary } from "../lib/types";
import { formatListTime } from "../lib/time";

interface Props {
  messages: MessageSummary[];
  selectedId: string | null;
  busy: "loading" | "refreshing" | "idle";
  error: string | null;
  unreadCount: number;
  lastSync: Date | null;
  phase: "booting" | "ready" | "expired" | "demo" | "error" | "provisioning";
  onOpen: (id: string) => void;
  onRefresh: () => void;
}

function SkeletonRows() {
  return (
    <div aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="skel-row">
          <div className="skel w40" style={{ width: `${28 + (i % 3) * 14}%` }} />
          <div className="skel w70" />
          <div className="skel w55" style={{ width: "45%" }} />
        </div>
      ))}
    </div>
  );
}

export function MailList({
  messages,
  selectedId,
  busy,
  error,
  unreadCount,
  lastSync,
  phase,
  onOpen,
  onRefresh,
}: Props) {
  return (
    <>
      <div className="list-head">
        <span className="list-title">
          收件箱{" "}
          <span className="count">
            {unreadCount > 0 ? `· ${unreadCount} 封未读` : `· ${messages.length} 封`}
          </span>
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={onRefresh}
          disabled={phase === "booting" || busy === "loading"}
          aria-label="刷新收件箱"
          title="刷新收件箱"
        >
          <RefreshCw size={15} className={busy !== "idle" ? "spin" : undefined} aria-hidden />
        </button>
      </div>

      <div className="mail-list" role="list" aria-label="邮件列表">
        {busy === "loading" ? (
          <SkeletonRows />
        ) : phase === "provisioning" ? (
          <div className="state-block" role="status">
            <RefreshCw size={20} className="spin" aria-hidden />
            <div className="state-title">邮箱开通中…</div>
            <div className="state-detail">
              服务就绪后这里会自动列出收到的邮件，通常不会超过几分钟。
            </div>
          </div>
        ) : error && messages.length === 0 ? (
          <div className="state-block" role="status">
            <AlertTriangle size={22} aria-hidden />
            <div className="state-title">收件箱暂时打不开</div>
            <div className="state-detail">{error}</div>
            <button type="button" className="btn btn-outline btn-sm" onClick={onRefresh}>
              重试
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="state-block" role="status">
            <Inbox size={22} aria-hidden />
            <div className="state-title">收件箱是空的</div>
            <div className="state-detail">
              把上面的地址填到需要注册或验证的地方，新邮件会在大约 15 秒内自动出现在这里。
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const selected = m.id === selectedId;
            const cls = ["mail-item", m.seen ? "" : "unread", selected ? "selected" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={m.id} role="listitem" className={cls}>
                <MailRow message={m} selected={selected} onOpen={onOpen} />
              </li>
            );
          })
        )}
      </div>

      <div className="list-foot">
        <span>
          {lastSync ? `上次刷新 ${formatListTime(lastSync.toISOString())}` : "尚未刷新"}
        </span>
        <span className="sep" aria-hidden>
          ·
        </span>
        <span>每 15 秒自动刷新</span>
      </div>
    </>
  );
}

function MailRow({
  message,
  selected,
  onOpen,
}: {
  message: MessageSummary;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const cls = ["mail-item-btn", message.seen ? "" : "unread"]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cls}
      onClick={() => onOpen(message.id)}
      aria-current={selected ? "true" : undefined}
    >
      <span className={message.seen ? "m-dot read" : "m-dot"} aria-hidden />
      <span className="m-from">{message.fromName}</span>
      <span className="m-time">{formatListTime(message.createdAt)}</span>
      {message.hasAttachments ? (
        <span className="m-attach" aria-label="含附件">
          <Paperclip size={12} aria-hidden />
        </span>
      ) : null}
      <span className="m-subject">{message.subject}</span>
      {message.intro && <span className="m-snippet">{message.intro}</span>}
    </button>
  );
}
