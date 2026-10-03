import { useEffect, useState } from "react";
import { History, Loader2, Trash2, X } from "lucide-react";
import { formatFullTime } from "../lib/time";
import { RETIRE_TTL_MS } from "../hooks/useMailbox";

export interface HistoryRow {
  id: string;
  address: string;
  sourceName: string;
  retiredAt: number;
  active: boolean;
}

interface Props {
  open: boolean;
  rows: HistoryRow[];
  busy: boolean;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function remainingText(retiredAt: number): string {
  const ms = retiredAt + RETIRE_TTL_MS - Date.now();
  if (ms <= 0) return "即将自动删除";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours} 小时后自动删除`;
  return `${minutes} 分钟后自动删除`;
}

/** 历史邮箱：被更换下线的地址在此保留 24 小时，期间仍可查看收信，到期自动删除。 */
export function HistoryDialog({ open, rows, busy, onSwitch, onDelete, onClose }: Props) {
  const [, setTick] = useState(0);

  // 面板打开时每 30 秒刷新一次剩余时间文案
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div
        className="dialog history-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="历史邮箱"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="source-head">
          <h2>
            <History size={16} aria-hidden style={{ verticalAlign: "-3px", marginRight: 6 }} />
            历史邮箱
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} aria-hidden />
          </button>
        </div>
        <p className="source-desc">
          更换地址后，旧邮箱会在这里保留 24 小时：期间仍能收到信、也能切过去查看，到期自动删除。
        </p>

        {rows.length === 0 ? (
          <div className="history-empty">目前没有历史邮箱。更换地址后，旧邮箱会出现在这里。</div>
        ) : (
          <ul className="history-list">
            {rows.map((r) => (
              <li key={r.id} className="history-row">
                <div className="history-row-main">
                  <div className="box-row-addr">{r.address}</div>
                  <div className="history-row-meta">
                    <span className="box-src-tag">{r.sourceName}</span>
                    <span className="history-when">退役于 {formatFullTime(new Date(r.retiredAt).toISOString())}</span>
                    <span className="history-ttl">{remainingText(r.retiredAt)}</span>
                  </div>
                </div>
                <div className="history-row-actions">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      onClose();
                      onSwitch(r.id);
                    }}
                    disabled={busy || r.active}
                  >
                    {busy ? <Loader2 size={13} className="spin" aria-hidden /> : null}
                    {r.active ? "当前邮箱" : "切过去查看"}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onDelete(r.id)}
                    disabled={busy}
                    aria-label={`立即删除历史邮箱 ${r.address}`}
                    title="立即删除"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
