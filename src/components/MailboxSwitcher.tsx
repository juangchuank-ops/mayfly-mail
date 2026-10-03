import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Inbox, Loader2, Plus, Settings2, X } from "lucide-react";
import type { BoxMode } from "../hooks/useMailbox";

export interface SwitcherRow {
  id: string;
  address: string;
  sourceName: string;
  mode: BoxMode;
  /** -1 表示未知（同步失败），null 表示尚未同步过。 */
  unread: number | null;
  active: boolean;
}

interface Props {
  rows: SwitcherRow[];
  realSources: { id: string; name: string }[];
  busy: boolean;
  syncing: boolean;
  onSwitch: (id: string) => void;
  onCreate: (sourceId?: string) => void;
  onRemove: (id: string) => void;
  onManageSources: () => void;
  onOpen: () => void;
}

/** 地址铭牌右上角的邮箱切换器：多数据源下的每个邮箱都在这里区分与切换。 */
export function MailboxSwitcher({
  rows,
  realSources,
  busy,
  syncing,
  onSwitch,
  onCreate,
  onRemove,
  onManageSources,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openPanel = () => {
    setOpen(true);
    setChoosing(false);
    onOpen();
  };

  const unreadLabel = (u: number | null) => {
    if (u === null) return "· 尚未同步";
    if (u === -1) return "· 不可达";
    if (u > 0) return `· ${u} 封未读`;
    return "· 无未读";
  };

  return (
    <div className="box-switcher" ref={rootRef}>
      <button
        type="button"
        className="box-trigger"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`切换邮箱（共 ${rows.length} 个）`}
        title="切换邮箱"
      >
        <Inbox size={13} aria-hidden />
        <span>邮箱 {rows.length}</span>
        <ChevronDown size={13} aria-hidden />
      </button>

      {open && (
        <div className="box-pop" role="dialog" aria-label="邮箱列表">
          <div className="box-pop-head">
            <span>全部邮箱</span>
            {syncing && (
              <span className="box-pop-sync">
                <Loader2 size={12} className="spin" aria-hidden />
                正在同步未读…
              </span>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setOpen(false);
                onManageSources();
              }}
              aria-label="管理数据源"
              title="管理数据源"
            >
              <Settings2 size={14} aria-hidden />
            </button>
          </div>

          <ul className="box-list">
            {rows.map((r) => (
              <li key={r.id}>
                <div className={r.active ? "box-row active" : "box-row"}>
                  <button
                    type="button"
                    className="box-row-main"
                    onClick={() => {
                      setOpen(false);
                      if (!r.active) onSwitch(r.id);
                    }}
                    disabled={busy}
                    aria-current={r.active ? "true" : undefined}
                  >
                    <span className="box-row-check">
                      {r.active ? <Check size={14} aria-hidden /> : null}
                    </span>
                    <span className="box-row-addr">{r.address}</span>
                    <span className="box-row-meta">
                      <span className="box-src-tag">{r.sourceName}</span>
                      <span className="box-unread">{unreadLabel(r.unread)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn box-row-remove"
                    onClick={() => {
                      setOpen(false);
                      onRemove(r.id);
                    }}
                    disabled={busy}
                    aria-label={`移除邮箱 ${r.address}`}
                    title="移除此邮箱"
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {choosing && realSources.length > 1 ? (
            <div className="box-choose">
              <div className="box-choose-label">在哪个数据源上创建？</div>
              {realSources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="box-choose-row"
                  disabled={busy}
                  onClick={() => {
                    setChoosing(false);
                    setOpen(false);
                    onCreate(s.id);
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="box-create"
              onClick={() => {
                if (realSources.length > 1) setChoosing(true);
                else {
                  setOpen(false);
                  onCreate();
                }
              }}
              disabled={busy}
            >
              {busy ? <Loader2 size={14} className="spin" aria-hidden /> : <Plus size={14} aria-hidden />}
              新建邮箱
            </button>
          )}
        </div>
      )}
    </div>
  );
}
