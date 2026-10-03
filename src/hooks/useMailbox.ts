import { useCallback, useEffect, useRef, useState } from "react";
import { MailTmProvider } from "../lib/mailtm";
import { DemoProvider } from "../lib/demo";
import {
  type MailProvider,
  type Mailbox,
  type MessageDetail,
  type MessageSummary,
} from "../lib/types";

const STORE_KEY = "mayfly.mailbox";
const POLL_MS = 15_000;

type Phase = "booting" | "ready" | "expired" | "demo" | "error" | "provisioning";

interface StoredMailbox {
  mode: "real" | "demo";
  address: string;
  credentials: Record<string, string>;
  /** 首次创建时间：用于区分「刚建的号还没开通」和「真的过期了」。 */
  createdAt?: number;
}

interface MailboxState {
  phase: Phase;
  mailbox: Mailbox | null;
  bootError: string | null;
  messages: MessageSummary[];
  selectedId: string | null;
  detail: MessageDetail | null;
  detailLoading: boolean;
  listBusy: "loading" | "refreshing" | "idle";
  listError: string | null;
  lastSync: Date | null;
  creating: boolean;
}

const initialState: MailboxState = {
  phase: "booting",
  mailbox: null,
  bootError: null,
  messages: [],
  selectedId: null,
  detail: null,
  detailLoading: false,
  listBusy: "loading",
  listError: null,
  lastSync: null,
  creating: false,
};

function loadStored(): StoredMailbox | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredMailbox;
    if ((v.mode === "real" || v.mode === "demo") && typeof v.address === "string") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function saveStored(m: Mailbox | null) {
  if (!m) {
    localStorage.removeItem(STORE_KEY);
    return;
  }
  const previous = loadStored();
  const storedCreatedAt = previous?.address === m.address ? previous.createdAt : undefined;
  const v: StoredMailbox = {
    mode: m.mode,
    address: m.address,
    credentials: m.credentials,
    ...(storedCreatedAt ? { createdAt: storedCreatedAt } : { createdAt: Date.now() }),
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(v));
}

/** 从 hash 里解析当前打开的邮件 id（#/m/<id>）。 */
function idFromHash(): string | null {
  const m = /^#\/m\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

export function useMailbox() {
  const [state, setState] = useState<MailboxState>(initialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const providerRef = useRef<MailProvider | null>(null);
  const detailCacheRef = useRef(new Map<string, MessageDetail>());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const bootRef = useRef(false);
  const [toast, setToast] = useState<{ id: number; text: string; error?: boolean } | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ id: Date.now(), text, error });
  }, []);

  const clearProvider = useCallback(() => {
    detailCacheRef.current.clear();
    saveStored(null);
  }, []);

  /** 拉取收件箱（带并发守卫）。 */
  const refresh = useCallback(async (manual: boolean) => {
    const provider = providerRef.current;
    if (!provider || inFlightRef.current) return;
    inFlightRef.current = true;
    setState((s) => ({
      ...s,
      listBusy: s.messages.length === 0 ? "loading" : "refreshing",
      listError: manual ? s.listError : null,
    }));
    try {
      const messages = await provider.listMessages();
      setState((s) => ({
        ...s,
        messages,
        listBusy: "idle",
        listError: null,
        lastSync: new Date(),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "刷新失败。";
      setState((s) => ({ ...s, listBusy: "idle", listError: message }));
      if (manual) notify(message, true);
    } finally {
      inFlightRef.current = false;
    }
  }, [notify]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      if (!document.hidden) void refresh(false);
    }, POLL_MS);
  }, [refresh, stopPolling]);

  /** 打开某封邮件：加载详情 + 标记已读 + 写入 hash。 */
  const openMessage = useCallback(async (id: string) => {
    const provider = providerRef.current;
    if (!provider) return;
    const cached = detailCacheRef.current.get(id);
    setState((s) => {
      const summary = s.messages.find((m) => m.id === id);
      return {
        ...s,
        selectedId: id,
        detail: cached ?? null,
        detailLoading: !cached,
        messages: summary && !summary.seen
          ? s.messages.map((m) => (m.id === id ? { ...m, seen: true } : m))
          : s.messages,
      };
    });
    if (idFromHash() !== id) history.pushState(null, "", `#/m/${encodeURIComponent(id)}`);

    try {
      const detail = cached ?? (await provider.getMessage(id));
      detailCacheRef.current.set(id, detail);
      setState((s) => (s.selectedId === id ? { ...s, detail, detailLoading: false } : s));
      const summary = stateRef.current.messages.find((m) => m.id === id);
      if (summary && !summary.seen) {
        void provider.setSeen(id, true).catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "无法加载邮件。";
      setState((s) => (s.selectedId === id ? { ...s, detailLoading: false } : s));
      notify(message, true);
    }
  }, [notify]);

  const closeMessage = useCallback(() => {
    setState((s) => ({ ...s, selectedId: null, detail: null, detailLoading: false }));
    if (idFromHash()) history.pushState(null, "", location.pathname + location.search);
  }, []);

  /** 邮箱开通轮询：建号成功但 token 尚未可用时，后台等待直到可收信或超时。 */
  const provisionLoop = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || provider.mode !== "real") return;
    stopPolling();
    const MAX_ATTEMPTS = 45;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      if (providerRef.current !== provider) return; // 期间已切换邮箱
      const ok = await provider.provision();
      if (providerRef.current !== provider) return;
      if (ok) {
        setState((s) => ({ ...s, phase: "ready" }));
        startPolling();
        await refresh(false);
        return;
      }
    }
    setState((s) => ({
      ...s,
      phase: "error",
      bootError: "邮箱开通超时：邮件服务长时间没有就绪。",
    }));
    notify("邮箱开通超时，可以稍后重试。", true);
  }, [notify, refresh, startPolling, stopPolling]);

  const activateProvider = useCallback(
    async (provider: MailProvider, mailbox: Mailbox) => {
      providerRef.current = provider;
      detailCacheRef.current.clear();
      saveStored(mailbox);
      const needsProvision =
        provider.mode === "real" && !(await provider.provision());
      setState((s) => ({
        ...s,
        phase: provider.mode === "demo" ? "demo" : needsProvision ? "provisioning" : "ready",
        mailbox,
        messages: [],
        listBusy: needsProvision ? "idle" : "loading",
        listError: null,
        selectedId: null,
        detail: null,
      }));
      if (needsProvision) {
        void provisionLoop();
        return;
      }
      startPolling();
      // boot 完成后检查 deep link
      await refresh(false);
      const deepId = idFromHash();
      if (deepId && stateRef.current.messages.some((m) => m.id === deepId)) {
        void openMessage(deepId);
      }
    },
    [refresh, startPolling, openMessage, provisionLoop],
  );

  const enterDemo = useCallback(async () => {
    stopPolling();
    const provider = new DemoProvider();
    const stored = loadStored();
    const mailbox =
      stored?.mode === "demo"
        ? await provider.restoreMailbox({ address: stored.address })
        : await provider.createMailbox();
    await activateProvider(provider, mailbox);
  }, [activateProvider, stopPolling]);

  /** 生成全新地址（真实/演示跟随当前模式）。 */
  const createNewMailbox = useCallback(async () => {
    setState((s) => ({ ...s, creating: true, bootError: null }));
    const wasBooting = stateRef.current.mailbox === null && stateRef.current.phase !== "demo";
    try {
      const provider = providerRef.current ?? new MailTmProvider();
      const mailbox = await provider.createMailbox();
      await activateProvider(provider, mailbox);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成地址失败。";
      // 启动阶段失败：给出可恢复的错误状态，而不是永远转圈
      if (wasBooting) {
        setState((s) => ({ ...s, phase: "error", bootError: message }));
      }
      notify(message, true);
    } finally {
      setState((s) => ({ ...s, creating: false }));
    }
  }, [activateProvider, notify]);

  /** 启动：真实服务可用则恢复/创建真实邮箱，否则进入演示模式。 */
  const bootstrap = useCallback(async () => {
    if (bootRef.current) return;
    bootRef.current = true;

    const params = new URLSearchParams(location.search);
    const stored = loadStored();

    if (params.has("demo")) {
      await enterDemo();
      return;
    }

    const real = new MailTmProvider();
    const reachable = await real.available();
    if (!reachable) {
      await enterDemo();
      return;
    }

    if (stored?.mode === "real") {
      try {
        const mailbox = await real.restoreMailbox(stored.credentials);
        await activateProvider(real, mailbox);
        return;
      } catch {
        // 刚创建不久的邮箱可能只是还没开通完，而不是真的过期
        const fresh = stored.createdAt && Date.now() - stored.createdAt < 10 * 60_000;
        if (fresh) {
          await activateProvider(real, {
            address: stored.address,
            mode: "real",
            credentials: stored.credentials,
          });
          return;
        }
        clearProvider();
        setState((s) => ({ ...s, phase: "expired", mailbox: null, listBusy: "idle" }));
        return;
      }
    }

    await createNewMailbox();
  }, [activateProvider, clearProvider, createNewMailbox, enterDemo]);

  const switchToReal = useCallback(async () => {
    stopPolling();
    bootRef.current = false;
    // 从演示模式切回真实服务时，先移除 ?demo=1，否则 bootstrap 会再次进入演示
    if (new URLSearchParams(location.search).has("demo")) {
      const url = new URL(location.href);
      url.searchParams.delete("demo");
      history.replaceState(null, "", url.pathname + url.search);
    }
    setState((s) => ({ ...s, phase: "booting" }));
    await bootstrap();
  }, [bootstrap, stopPolling]);

  const markUnread = useCallback(async (id: string) => {
    const provider = providerRef.current;
    if (!provider) return;
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) => (m.id === id ? { ...m, seen: false } : m)),
    }));
    try {
      await provider.setSeen(id, false);
      detailCacheRef.current.delete(id);
    } catch {
      notify("标记未读失败。", true);
    }
  }, [notify]);

  const getRawSource = useCallback(
    async (id: string): Promise<string | null> => {
      const provider = providerRef.current;
      if (!provider) return null;
      try {
        return await provider.getRawSource(id);
      } catch (err) {
        notify(err instanceof Error ? err.message : "无法获取原始邮件。", true);
        return null;
      }
    },
    [notify],
  );

  const removeMessage = useCallback(async (id: string) => {
    const provider = providerRef.current;
    if (!provider) return;
    try {
      await provider.deleteMessage(id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "删除失败。", true);
      return;
    }
    detailCacheRef.current.delete(id);
    setState((s) => {
      const wasSelected = s.selectedId === id;
      return {
        ...s,
        messages: s.messages.filter((m) => m.id !== id),
        ...(wasSelected ? { selectedId: null, detail: null } : {}),
      };
    });
    if (idFromHash() === id) history.pushState(null, "", location.pathname + location.search);
    notify("邮件已删除。");
  }, [notify]);

  // 深链对账：#/m/<id> 指向的邮件可能在首次刷新后才到达，每次列表变化都重新检查
  useEffect(() => {
    if (state.selectedId) return;
    if (state.phase !== "ready" && state.phase !== "demo") return;
    const deepId = idFromHash();
    if (!deepId) return;
    if (state.messages.some((m) => m.id === deepId)) void openMessage(deepId);
  }, [state.messages, state.selectedId, state.phase, openMessage]);

  // 浏览器返回键 / hash 变化 → 关闭阅读区
  useEffect(() => {
    const onPop = () => {
      if (!idFromHash()) {
        setState((s) => (s.selectedId ? { ...s, selectedId: null, detail: null } : s));
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 演示模式：新邮件到达事件
  useEffect(() => {
    const onDemoArrival = () => void refresh(false);
    window.addEventListener("demo-mail-arrived", onDemoArrival);
    return () => window.removeEventListener("demo-mail-arrived", onDemoArrival);
  }, [refresh]);

  // 卸载清理
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const unreadCount = state.messages.filter((m) => !m.seen).length;

  return {
    ...state,
    unreadCount,
    toast,
    dismissToast: () => setToast(null),
    notify,
    bootstrap,
    refresh,
    openMessage,
    closeMessage,
    createNewMailbox,
    enterDemo,
    switchToReal,
    markUnread,
    removeMessage,
    getRawSource,
  };
}
