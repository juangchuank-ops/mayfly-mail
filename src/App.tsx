import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Mail, Moon, RefreshCw, Sun } from "lucide-react";
import { useTheme } from "./hooks/useTheme";
import { useMailbox } from "./hooks/useMailbox";
import { AddressPlate } from "./components/AddressPlate";
import { MailboxSwitcher } from "./components/MailboxSwitcher";
import { SourceDialog } from "./components/SourceDialog";
import { MailList } from "./components/MailList";
import { Reader } from "./components/Reader";
import { Toast } from "./components/Toast";
import { ConfirmDialog } from "./components/ConfirmDialog";

type ConfirmTarget =
  | { kind: "new-address" }
  | { kind: "delete"; id: string }
  | { kind: "remove-box"; boxId: string }
  | null;

export default function App() {
  const { theme, toggle } = useTheme();
  const mb = useMailbox();
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);
  const [retrying, setRetrying] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    void mb.bootstrap();
    // 仅在挂载时启动一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `${mb.unreadCount > 0 ? `(${mb.unreadCount}) ` : ""}蜉蝣邮 · 临时邮箱`;
  }, [mb.unreadCount]);

  const retryReal = useCallback(async () => {
    setRetrying(true);
    try {
      await mb.switchToReal();
    } finally {
      setRetrying(false);
    }
  }, [mb]);

  const readerOpen = mb.selectedId !== null;

  return (
    <div className="app">
      <a className="skip-link" href="#inbox">
        跳到收件箱
      </a>
      <header className="topbar">
        <div className="brand">
          <h1 className="brand-name">蜉蝣邮</h1>
          <span className="brand-tag">一次性地址，收完即走</span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={theme === "light" ? "切换到深色主题" : "切换到浅色主题"}
            title={theme === "light" ? "深色主题" : "浅色主题"}
          >
            {theme === "light" ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
          </button>
        </div>
      </header>

      {mb.phase === "demo" && (
        <div className="demo-banner" role="status">
          <FlaskConical size={14} aria-hidden />
          <span>
            <b>演示模式</b> — 无法连接邮件服务，这里展示的是模拟数据，不会真的收信。
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => void retryReal()}
            disabled={retrying}
          >
            {retrying ? <RefreshCw size={14} className="spin" aria-hidden /> : null}
            重试连接
          </button>
        </div>
      )}

      <main className="main">
        <section className="sidebar" id="inbox" tabIndex={-1} aria-label="收件箱">
          <AddressPlate
            mailbox={mb.mailbox}
            phase={mb.phase}
            bootError={mb.bootError}
            creating={mb.creating}
            creatingReal={retrying}
            sourceName={mb.activeSourceName}
            onCopyFeedback={mb.notify}
            onNewAddress={() => setConfirm({ kind: "new-address" })}
            onRetryCreate={() => void mb.createNewMailbox()}
            onRetryReal={() => void retryReal()}
            onEnterDemo={() => void mb.enterDemo()}
            switcher={
              <MailboxSwitcher
                rows={mb.entries.map((e) => ({
                  id: e.id,
                  address: e.address,
                  sourceName:
                    e.mode === "demo"
                      ? "演示"
                      : (mb.sources.find((s) => s.id === e.sourceId)?.name ?? "未知来源"),
                  mode: e.mode,
                  unread: e.id === mb.activeId ? mb.unreadCount : (mb.unreadByBox[e.id] ?? null),
                  active: e.id === mb.activeId,
                }))}
                realSources={mb.sources.map((s) => ({ id: s.id, name: s.name }))}
                busy={mb.creating || mb.switching}
                syncing={mb.syncingCounts}
                onSwitch={(id) => void mb.switchTo(id)}
                onCreate={(sourceId) => void mb.addMailbox(sourceId)}
                onRemove={(id) => setConfirm({ kind: "remove-box", boxId: id })}
                onManageSources={() => setSourcesOpen(true)}
                onOpen={() => void mb.syncCounts()}
              />
            }
          />
          <MailList
            messages={mb.messages}
            selectedId={mb.selectedId}
            busy={mb.listBusy}
            error={mb.listError}
            unreadCount={mb.unreadCount}
            lastSync={mb.lastSync}
            phase={mb.phase}
            onOpen={(id) => void mb.openMessage(id)}
            onRefresh={() => void mb.refresh(true)}
          />
        </section>

        <section
          className={readerOpen ? "reader-pane open" : "reader-pane"}
          aria-label="邮件阅读"
          aria-hidden={!readerOpen}
          inert={!readerOpen}
        >
          {mb.detail && !mb.detailLoading ? (
            <Reader
              key={mb.detail.id}
              message={mb.detail}
              dark={theme === "dark"}
              onBack={mb.closeMessage}
              onNotify={mb.notify}
              onMarkUnread={(id) => void mb.markUnread(id)}
              onDelete={(id) => setConfirm({ kind: "delete", id })}
              getRaw={mb.getRawSource}
            />
          ) : mb.detailLoading ? (
            <div className="state-block" role="status" aria-live="polite">
              <RefreshCw size={20} className="spin" aria-hidden />
              <div className="state-title">正在打开邮件…</div>
            </div>
          ) : (
            <div className="state-block">
              <Mail size={22} aria-hidden />
              <div className="state-title">还没有打开的邮件</div>
              <div className="state-detail">从左侧选一封邮件；新邮件会自动出现，无需手动刷新。</div>
            </div>
          )}
        </section>
      </main>

      <Toast toast={mb.toast} onDismiss={mb.dismissToast} />

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "delete"
            ? "删除这封邮件？"
            : confirm?.kind === "remove-box"
              ? "移除这个邮箱？"
              : "更换邮箱地址？"
        }
        body={
          confirm?.kind === "delete"
            ? "删除后无法恢复。如果只是想稍后再看，可以先「标记未读」。"
            : confirm?.kind === "remove-box"
              ? "移除后本机不再保存它的凭据，该地址将无法继续收信（服务端的邮件仍保留在自建服务里）。"
              : "会为当前数据源生成一个全新的地址并立即切换，旧地址立即作废，里面已有的邮件将无法找回。"
        }
        confirmText={
          confirm?.kind === "delete" ? "删除" : confirm?.kind === "remove-box" ? "移除" : "生成新地址"
        }
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "delete") void mb.removeMessage(confirm.id);
          else if (confirm.kind === "remove-box") void mb.removeBox(confirm.boxId);
          else void mb.createNewMailbox();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />

      <SourceDialog
        open={sourcesOpen}
        sources={mb.sources}
        onClose={() => setSourcesOpen(false)}
        onAdd={(s) => {
          mb.addSource(s);
          mb.notify(`数据源「${s.name}」已添加`);
        }}
        onDelete={(id) => void mb.deleteSource(id)}
      />
    </div>
  );
}
