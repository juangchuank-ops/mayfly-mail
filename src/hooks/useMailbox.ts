import { useCallback, useEffect, useRef, useState } from "react";
import { MailTmProvider } from "../lib/mailtm";
import { CloudflareEmailProvider } from "../lib/cloudflare";
import { DemoProvider } from "../lib/demo";
import {
  type MailProvider,
  type Mailbox,
  type MessageDetail,
  type MessageSummary,
} from "../lib/types";

const STORE_KEY = "mayfly.mailboxes";
const LEGACY_STORE_KEY = "mayfly.mailbox";
const POLL_MS = 15_000;
const FRESH_WINDOW = 10 * 60_000;
/** 更换下来的旧邮箱在「历史」中保留的时长，到期自动删除。 */
export const RETIRE_TTL_MS = 24 * 60 * 60 * 1000;

const BUILTIN_SOURCE_ID = "builtin";
const DEMO_SOURCE_ID = "demo";

export type BoxMode = "real" | "demo";
export type SourceType = "mailtm" | "cloudflare";

export interface SourceConfig {
  id: string;
  name: string;
  type: SourceType;
  baseUrl: string;
  /** 可选令牌：mail.tm 兼容源可留空（走 /token 登录）；CF 源对应可选管理令牌。 */
  token?: string;
  builtin?: boolean;
}

export interface MailboxEntry {
  id: string;
  /** 所属数据源；演示条目为固定 demo 源。 */
  sourceId: string;
  mode: BoxMode;
  address: string;
  credentials: Record<string, string>;
  createdAt: number;
  /** 被更换下线的时间：存在此字段即处于「历史保留」状态，到期自动删除。 */
  retiredAt?: number;
}

type Phase = "booting" | "ready" | "expired" | "demo" | "error" | "provisioning";

interface StoredV3 {
  version: 3;
  activeId: string | null;
  sources: SourceConfig[];
  entries: MailboxEntry[];
}

interface MailboxState {
  phase: Phase;
  entries: MailboxEntry[];
  sources: SourceConfig[];
  activeId: string | null;
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
  switching: boolean;
  syncingCounts: boolean;
  unreadByBox: Record<string, number>;
}

const BUILTIN_SOURCE: SourceConfig = {
  id: BUILTIN_SOURCE_ID,
  name: "蜉蝣邮公共接口",
  type: "mailtm",
  baseUrl: import.meta.env.VITE_MAIL_API_BASE ?? "/api",
  builtin: true,
};

function normalizeSources(sources: SourceConfig[]): SourceConfig[] {
  return sources.map((s) => ({ ...s, type: s.type ?? "mailtm" }));
}

/** 按条目所属数据源构造 Provider 实例。 */
function makeProvider(entry: Pick<MailboxEntry, "sourceId" | "mode">, sources: SourceConfig[]): MailProvider {
  if (entry.mode === "demo") return new DemoProvider();
  const src = sources.find((s) => s.id === entry.sourceId);
  if ((src?.type ?? "mailtm") === "cloudflare") {
    return new CloudflareEmailProvider({ baseUrl: src?.baseUrl ?? "", adminToken: src?.token });
  }
  return new MailTmProvider({
    baseUrl: src?.baseUrl ?? BUILTIN_SOURCE.baseUrl,
    staticToken: src?.token,
  });
}

const initialState: MailboxState = {
  phase: "booting",
  entries: [],
  sources: [BUILTIN_SOURCE],
  activeId: null,
  mailbox: null,
  bootError: null,
  messages: [],
  selectedId: null,
  detail: null,
  detailLoading: false,
  listBusy: "idle",
  listError: null,
  lastSync: null,
  creating: false,
  switching: false,
  syncingCounts: false,
  unreadByBox: {},
};

function randomId(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function loadStore(): StoredV3 {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as StoredV3;
      if (v.version === 3 && Array.isArray(v.entries) && Array.isArray(v.sources)) {
        return { ...v, sources: normalizeSources(v.sources) };
      }
    }
    // v1 迁移：单邮箱 {mode,address,credentials,createdAt}
    const legacyRaw = localStorage.getItem(LEGACY_STORE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as {
        mode?: BoxMode;
        address?: string;
        credentials?: Record<string, string>;
        createdAt?: number;
      };
      if (typeof legacy.address === "string") {
        const entry: MailboxEntry = {
          id: randomId(),
          sourceId: legacy.mode === "demo" ? DEMO_SOURCE_ID : BUILTIN_SOURCE_ID,
          mode: legacy.mode === "demo" ? "demo" : "real",
          address: legacy.address,
          credentials: legacy.credentials ?? {},
          createdAt: legacy.createdAt ?? Date.now(),
        };
        return { version: 3, activeId: entry.id, sources: [BUILTIN_SOURCE], entries: [entry] };
      }
    }
  } catch {
    /* 损坏则视为全新开始 */
  }
  return { version: 3, activeId: null, sources: [BUILTIN_SOURCE], entries: [] };
}

function saveStore(sources: SourceConfig[], entries: MailboxEntry[], activeId: string | null) {
  const v: StoredV3 = { version: 3, activeId, sources, entries };
  localStorage.setItem(STORE_KEY, JSON.stringify(v));
}

/** 从 hash 里解析当前打开的邮件 id（#/m/<id>）。 */
function idFromHash(): string | null {
  const m = /^#\/m\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

function clearHash() {
  if (idFromHash()) history.pushState(null, "", location.pathname + location.search);
}

export function useMailbox() {
  const [state, setState] = useState<MailboxState>(initialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** 每个邮箱条目一个 Provider 实例（缓存 JWT / 演示数据）。 */
  const providerByIdRef = useRef(new Map<string, MailProvider>());
  const providerRef = useRef<MailProvider | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const detailCacheRef = useRef(new Map<string, MessageDetail>());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const bootRef = useRef(false);
  const provisionAbortRef = useRef<{ id: string; dead: boolean } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; error?: boolean } | null>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ id: Date.now(), text, error });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** 拉取当前邮箱的收件箱（带并发守卫）。 */
  const refresh = useCallback(
    async (manual: boolean) => {
      const provider = providerRef.current;
      if (!provider || inFlightRef.current) return;
      const activeId = activeIdRef.current;
      if (!activeId) return;
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
          unreadByBox: {
            ...s.unreadByBox,
            [activeId]: messages.filter((m) => !m.seen).length,
          },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "刷新失败。";
        setState((s) => ({ ...s, listBusy: "idle", listError: message }));
        if (manual) notify(message, true);
      } finally {
        inFlightRef.current = false;
      }
    },
    [notify],
  );

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      if (!document.hidden) void refresh(false);
    }, POLL_MS);
  }, [refresh, stopPolling]);

  /** 打开某封邮件：加载详情 + 标记已读 + 写入 hash。 */
  const openMessage = useCallback(
    async (id: string) => {
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
    },
    [notify],
  );

  const closeMessage = useCallback(() => {
    setState((s) => ({ ...s, selectedId: null, detail: null, detailLoading: false }));
    clearHash();
  }, []);

  /** 激活某个邮箱条目（恢复凭据 → 收件箱 → 轮询）。 */
  const activate = useCallback(
    async (id: string, opts: { silent?: boolean } = {}) => {
      const snapshot = stateRef.current;
      const entry = snapshot.entries.find((e) => e.id === id);
      if (!entry) return;
      stopPolling();
      if (provisionAbortRef.current) provisionAbortRef.current.dead = true;
      const sources = snapshot.sources;
      let provider = providerByIdRef.current.get(id);
      if (!provider) provider = makeProvider(entry, sources);
      providerRef.current = provider;
      activeIdRef.current = id;
      detailCacheRef.current.clear();
      setState((s) => ({
        ...s,
        activeId: id,
        switching: opts.silent ? s.switching : true,
        messages: [],
        selectedId: null,
        detail: null,
        detailLoading: false,
        listError: null,
        bootError: null,
        mailbox: { address: entry.address, mode: entry.mode, credentials: entry.credentials },
      }));
      if (idFromHash()) history.pushState(null, "", location.pathname + location.search);

      let needsProvision = false;
      if (entry.mode === "demo") {
        await provider.restoreMailbox({ address: entry.address }).catch(() => undefined);
      } else if (!(await provider.provision())) {
        // 该实例还没有可用登录态：尝试用保存的凭据恢复
        try {
          await provider.restoreMailbox(entry.credentials);
        } catch (err) {
          const fresh = Date.now() - entry.createdAt < FRESH_WINDOW;
          if (!fresh) {
            setState((s) => ({
              ...s,
              phase: "expired",
              switching: false,
              listBusy: "idle",
              bootError: err instanceof Error ? err.message : null,
            }));
            notify("这个邮箱的登录状态已失效，可以移除后新建一个。", true);
            return;
          }
          // 刚创建不久的邮箱可能还没开通完：预置凭据后进入开通轮询
          provider.seedCredentials?.(entry.credentials);
          needsProvision = !(await provider.provision());
        }
      }
      if (providerRef.current !== provider) return; // 期间用户已切走

      if (needsProvision) {
        setState((s) => ({ ...s, phase: "provisioning", switching: false, listBusy: "idle" }));
        void provisionLoop(id, provider);
        return;
      }

      setState((s) => ({
        ...s,
        phase: provider.mode === "demo" ? "demo" : "ready",
        switching: false,
        listBusy: "loading",
      }));
      startPolling();
      await refresh(false);
      const deepId = idFromHash();
      if (deepId && stateRef.current.messages.some((m) => m.id === deepId)) {
        void openMessage(deepId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notify, refresh, startPolling, stopPolling, openMessage],
  );

  /** 邮箱开通轮询：建号成功但登录态尚未就绪时，后台等待直到可收信或超时。 */
  const provisionLoop = useCallback(
    async (id: string, provider: MailProvider) => {
      stopPolling();
      const abort = { id, dead: false };
      provisionAbortRef.current = abort;
      const MAX_ATTEMPTS = 45;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, 8000));
        if (abort.dead || activeIdRef.current !== id) return;
        const ok = await provider.provision();
        if (abort.dead || activeIdRef.current !== id) return;
        if (ok) {
          setState((s) => ({ ...s, phase: "ready" }));
          startPolling();
          await refresh(false);
          return;
        }
      }
      if (abort.dead || activeIdRef.current !== id) return;
      setState((s) => ({
        ...s,
        phase: "error",
        bootError: "邮箱开通超时：邮件服务长时间没有就绪。",
      }));
      notify("邮箱开通超时，可以稍后重试。", true);
    },
    [notify, refresh, startPolling, stopPolling],
  );

  /** 静默同步其它邮箱的未读数（切换器打开时调用，逐个进行，失败保持旧值）。 */
  const syncCounts = useCallback(async () => {
    const snapshot = stateRef.current;
    const targets = snapshot.entries.filter((e) => e.id !== snapshot.activeId);
    if (targets.length === 0) return;
    setState((s) => ({ ...s, syncingCounts: true }));
    for (const entry of targets) {
      try {
        let provider = providerByIdRef.current.get(entry.id);
        if (!provider) {
          provider = makeProvider(entry, snapshot.sources);
          providerByIdRef.current.set(entry.id, provider);
        }
        if (entry.mode === "demo") {
          await provider.restoreMailbox({ address: entry.address }).catch(() => undefined);
        } else if (!(await provider.provision())) {
          const seeded = provider.seedCredentials?.(entry.credentials);
          if (!seeded || !(await provider.provision())) {
            setState((s) => ({ ...s, unreadByBox: { ...s.unreadByBox, [entry.id]: -1 } }));
            continue;
          }
        }
        const messages = await provider.listMessages();
        setState((s) => ({
          ...s,
          unreadByBox: {
            ...s.unreadByBox,
            [entry.id]: messages.filter((m) => !m.seen).length,
          },
        }));
      } catch {
        setState((s) => ({ ...s, unreadByBox: { ...s.unreadByBox, [entry.id]: -1 } }));
      }
    }
    setState((s) => ({ ...s, syncingCounts: false }));
  }, []);

  const persist = useCallback(() => {
    const s = stateRef.current;
    saveStore(s.sources, s.entries, s.activeId);
  }, []);

  /** 在指定数据源创建一个新邮箱条目并切换过去；失败返回 null。 */
  const createBox = useCallback(
    async (sourceId: string, mode: BoxMode): Promise<MailboxEntry | null> => {
      const snapshot = stateRef.current;
      const provider = makeProvider({ sourceId, mode }, snapshot.sources);
      const mailbox = await provider.createMailbox();
      const entry: MailboxEntry = {
        id: randomId(),
        sourceId: mode === "demo" ? DEMO_SOURCE_ID : sourceId,
        mode,
        address: mailbox.address,
        credentials: mailbox.credentials,
        createdAt: Date.now(),
      };
      providerByIdRef.current.set(entry.id, provider);
      const entries = [...stateRef.current.entries, entry];
      setState((s) => ({ ...s, entries }));
      stateRef.current = { ...stateRef.current, entries };
      persist();
      return entry;
    },
    [persist],
  );

  /** 在指定数据源新建一个邮箱并切换过去；未指定源时用第一个数据源。 */
  const addMailbox = useCallback(
    async (sourceId?: string) => {
      const snapshot = stateRef.current;
      const targetSourceId =
        sourceId ?? snapshot.sources.find((s) => s.id !== DEMO_SOURCE_ID)?.id ?? DEMO_SOURCE_ID;
      const mode: BoxMode = targetSourceId === DEMO_SOURCE_ID ? "demo" : "real";
      setState((s) => ({ ...s, creating: true }));
      try {
        const entry = await createBox(targetSourceId, mode);
        if (entry) {
          await activate(entry.id);
          notify(`新邮箱 ${entry.address} 已就绪`);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : "生成地址失败。", true);
      } finally {
        setState((s) => ({ ...s, creating: false }));
      }
    },
    [activate, createBox, notify],
  );

  /** 更换当前邮箱的地址：同源新建一个并切换过去；旧地址移入「历史」保留 24 小时。 */
  const createNewMailbox = useCallback(async () => {
    const snapshot = stateRef.current;
    const current = snapshot.entries.find((e) => e.id === snapshot.activeId);
    if (!current) return;
    setState((s) => ({ ...s, creating: true, bootError: null }));
    try {
      const entry = await createBox(current.sourceId, current.mode);
      if (entry) {
        // 旧条目退役：移入历史保留 24 小时（保留凭据与 Provider，期间仍可查看）
        const oldIndex = snapshot.entries.findIndex((e) => e.id === current.id);
        const retiredOld: MailboxEntry = { ...current, retiredAt: Date.now() };
        const rest = stateRef.current.entries.filter((e) => e.id !== current.id && e.id !== entry.id);
        rest.splice(oldIndex, 0, entry);
        const entries = [...rest, retiredOld];
        setState((s) => ({ ...s, entries }));
        stateRef.current = { ...stateRef.current, entries };
        persist();
        await activate(entry.id, { silent: true });
        notify(`新地址 ${entry.address} 已就绪，旧地址保留在「历史」（24 小时后自动删除）`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成地址失败。";
      if (!stateRef.current.mailbox) {
        setState((s) => ({ ...s, phase: "error", bootError: message }));
      }
      notify(message, true);
    } finally {
      setState((s) => ({ ...s, creating: false }));
    }
  }, [activate, createBox, notify, persist]);

  /** 清理超过保留期的历史邮箱；若清理掉的是当前邮箱则自动切换/重建。 */
  const purgeExpired = useCallback(async () => {
    const snapshot = stateRef.current;
    const now = Date.now();
    const expired = snapshot.entries.filter(
      (e) => typeof e.retiredAt === "number" && now - e.retiredAt > RETIRE_TTL_MS,
    );
    if (expired.length === 0) return;
    const expiredIds = new Set(expired.map((e) => e.id));
    expired.forEach((e) => {
      providerByIdRef.current.delete(e.id);
      if (provisionAbortRef.current?.id === e.id) provisionAbortRef.current.dead = true;
    });
    const entries = snapshot.entries.filter((e) => !expiredIds.has(e.id));
    const unreadByBox = { ...snapshot.unreadByBox };
    expired.forEach((e) => delete unreadByBox[e.id]);
    setState((s) => ({ ...s, entries, unreadByBox }));
    stateRef.current = { ...stateRef.current, entries, unreadByBox };
    persist();
    notify(`${expired.length} 个历史邮箱已到期，自动删除。`);
    if (snapshot.activeId && expiredIds.has(snapshot.activeId)) {
      const fallbackId =
        [...entries].filter((e) => !e.retiredAt).sort((a, b) => b.createdAt - a.createdAt)[0]?.id ??
        entries[0]?.id ??
        null;
      if (fallbackId) {
        await activate(fallbackId);
      } else {
        try {
          const entry = await createBox(BUILTIN_SOURCE_ID, "real");
          if (entry) await activate(entry.id);
        } catch (err) {
          setState((s) => ({
            ...s,
            phase: "error",
            bootError: err instanceof Error ? err.message : "生成地址失败。",
          }));
          notify(err instanceof Error ? err.message : "生成地址失败。", true);
        }
      }
    }
  }, [activate, createBox, notify, persist]);

  /** 移除一个邮箱条目；若移除的是当前邮箱则切到剩余第一个（没有则新建）。 */
  const removeBox = useCallback(
    async (id: string) => {
      const snapshot = stateRef.current;
      const target = snapshot.entries.find((e) => e.id === id);
      if (!target) return;
      providerByIdRef.current.delete(id);
      if (provisionAbortRef.current?.id === id) provisionAbortRef.current.dead = true;
      const entries = snapshot.entries.filter((e) => e.id !== id);
      const unreadByBox = { ...snapshot.unreadByBox };
      delete unreadByBox[id];
      setState((s) => ({ ...s, entries, unreadByBox }));
      stateRef.current = { ...stateRef.current, entries, unreadByBox };
      persist();
      notify(`邮箱 ${target.address} 已移除。`);
      if (id !== snapshot.activeId) return;
      // 移除的是当前邮箱
      if (entries.length > 0) {
        await activate(entries[0].id);
      } else {
        // 一个都不剩：按当前模式重建一个
        const mode = target.mode;
        setState((s) => ({ ...s, phase: "booting", mailbox: null }));
        try {
          const entry = await createBox(mode === "demo" ? DEMO_SOURCE_ID : BUILTIN_SOURCE_ID, mode);
          if (entry) await activate(entry.id);
        } catch (err) {
          setState((s) => ({
            ...s,
            phase: "error",
            bootError: err instanceof Error ? err.message : "生成地址失败。",
          }));
          notify(err instanceof Error ? err.message : "生成地址失败。", true);
        }
      }
    },
    [activate, createBox, notify, persist],
  );

  /** 切换到另一个已有邮箱。 */
  const switchTo = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      await activate(id);
    },
    [activate],
  );

  /** 演示模式：新建一个演示邮箱条目并切换（作为服务不可用时的兜底）。 */
  const enterDemo = useCallback(async () => {
    const existing = stateRef.current.entries.find((e) => e.mode === "demo");
    setState((s) => ({ ...s, creating: true }));
    try {
      if (existing) {
        await activate(existing.id);
      } else {
        const entry = await createBox(DEMO_SOURCE_ID, "demo");
        if (entry) await activate(entry.id);
      }
    } finally {
      setState((s) => ({ ...s, creating: false }));
    }
  }, [activate, createBox]);

  /** 从演示模式重试真实服务：在内置源新建一个真实邮箱并切换。 */
  const switchToReal = useCallback(async () => {
    if (new URLSearchParams(location.search).has("demo")) {
      const url = new URL(location.href);
      url.searchParams.delete("demo");
      history.replaceState(null, "", url.pathname + url.search);
    }
    bootRef.current = true;
    setState((s) => ({ ...s, phase: "booting" }));
    await addMailbox(BUILTIN_SOURCE_ID);
  }, [addMailbox]);

  /** 启动：恢复已保存的邮箱（多源），或按可用性创建第一个。 */
  const bootstrap = useCallback(async () => {
    if (bootRef.current) return;
    bootRef.current = true;
    const storedRaw = loadStore();
    const sources = storedRaw.sources.some((s) => s.id === BUILTIN_SOURCE_ID)
      ? storedRaw.sources
      : [BUILTIN_SOURCE, ...storedRaw.sources];
    // 先清掉已到期（超过 24 小时）的历史邮箱
    const now = Date.now();
    const entries = storedRaw.entries.filter(
      (e) => typeof e.retiredAt !== "number" || now - e.retiredAt <= RETIRE_TTL_MS,
    );
    // 同步 ref，避免紧随其后的 activate 读到渲染前的旧 entries
    stateRef.current = { ...stateRef.current, sources, entries };
    setState((s) => ({ ...s, sources, entries }));

    const params = new URLSearchParams(location.search);
    const fallbackId = [...entries]
      .filter((e) => !e.retiredAt)
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? entries[0]?.id ?? null;
    const first =
      storedRaw.activeId && entries.some((e) => e.id === storedRaw.activeId)
        ? storedRaw.activeId
        : fallbackId;

    if (first && !params.has("demo")) {
      await activate(first);
      return;
    }

    // 没有可用条目：真实服务可达则建真实邮箱，否则进入演示
    const wantDemo = params.has("demo");
    if (!wantDemo) {
      const reachable = await new MailTmProvider({ baseUrl: BUILTIN_SOURCE.baseUrl }).available();
      if (!reachable) {
        await enterDemo();
        return;
      }
      await addMailbox(BUILTIN_SOURCE_ID);
      return;
    }
    await enterDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activate, enterDemo, addMailbox]);

  // ---------- 数据源管理 ----------

  /** 新增自建数据源。 */
  const addSource = useCallback(
    (source: Omit<SourceConfig, "id" | "builtin">) => {
      const full: SourceConfig = { ...source, id: randomId() };
      const sources = [...stateRef.current.sources, full];
      setState((s) => ({ ...s, sources }));
      stateRef.current = { ...stateRef.current, sources };
      persist();
      return full;
    },
    [persist],
  );

  /** 更新数据源配置；受影响的邮箱条目丢弃旧登录态，激活中的条目重新激活。 */
  const updateSource = useCallback(
    async (id: string, patch: Partial<Omit<SourceConfig, "id" | "builtin">>) => {
      const snapshot = stateRef.current;
      const sources = snapshot.sources.map((s) => (s.id === id ? { ...s, ...patch } : s));
      const affected = snapshot.entries.filter((e) => e.sourceId === id);
      affected.forEach((e) => providerByIdRef.current.delete(e.id));
      setState((s) => ({ ...s, sources }));
      stateRef.current = { ...stateRef.current, sources };
      persist();
      if (affected.some((e) => e.id === snapshot.activeId)) {
        await activate(snapshot.activeId!);
      }
    },
    [activate, persist],
  );

  /** 删除自建数据源（内置源不可删）。其下邮箱条目一并移除。 */
  const deleteSource = useCallback(
    async (id: string) => {
      const snapshot = stateRef.current;
      const source = snapshot.sources.find((s) => s.id === id);
      if (!source || source.builtin) return;
      const doomed = snapshot.entries.filter((e) => e.sourceId === id);
      doomed.forEach((e) => {
        providerByIdRef.current.delete(e.id);
        if (provisionAbortRef.current?.id === e.id) provisionAbortRef.current.dead = true;
      });
      const entries = snapshot.entries.filter((e) => e.sourceId !== id);
      const sources = snapshot.sources.filter((s) => s.id !== id);
      const unreadByBox = { ...snapshot.unreadByBox };
      doomed.forEach((e) => delete unreadByBox[e.id]);
      setState((s) => ({ ...s, sources, entries, unreadByBox }));
      stateRef.current = { ...stateRef.current, sources, entries, unreadByBox };
      persist();
      notify(`数据源「${source.name}」及其 ${doomed.length} 个邮箱已移除。`);
      if (!snapshot.activeId || doomed.some((e) => e.id === snapshot.activeId)) {
        if (entries.length > 0) {
          await activate(entries[0].id);
        } else {
          const reachable = await new MailTmProvider({ baseUrl: BUILTIN_SOURCE.baseUrl }).available();
          if (reachable) await addMailbox(BUILTIN_SOURCE_ID);
          else await enterDemo();
        }
      }
    },
    [activate, addMailbox, enterDemo, notify, persist],
  );

  // ---------- 消息操作 ----------

  const markUnread = useCallback(
    async (id: string) => {
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
    },
    [notify],
  );

  const removeMessage = useCallback(
    async (id: string) => {
      const provider = providerRef.current;
      if (!provider) return;
      try {
        await provider.deleteMessage(id);
      } catch (err) {
        notify(err instanceof Error ? err.message : "删除失败。", true);
        return;
      }
      detailCacheRef.current.delete(id);
      const activeId = activeIdRef.current;
      setState((s) => {
        const wasSelected = s.selectedId === id;
        return {
          ...s,
          messages: s.messages.filter((m) => m.id !== id),
          ...(wasSelected ? { selectedId: null, detail: null } : {}),
          ...(activeId ? { unreadByBox: s.unreadByBox } : {}),
        };
      });
      clearHash();
      notify("邮件已删除。");
    },
    [notify],
  );

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

  // 深链对账：#/m/<id> 指向的邮件可能在首次刷新后才到达
  useEffect(() => {
    if (state.selectedId) return;
    if (state.phase !== "ready" && state.phase !== "demo") return;
    const deepId = idFromHash();
    if (!deepId) return;
    if (state.messages.some((m) => m.id === deepId)) void openMessage(deepId);
  }, [state.messages, state.selectedId, state.phase, openMessage]);

  // 历史邮箱保留期检查：每分钟清理一次到期条目（页面隐藏时跳过）
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) void purgeExpired();
    }, 60_000);
    return () => clearInterval(t);
  }, [purgeExpired]);

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

  useEffect(() => {
    return () => {
      stopPolling();
      if (provisionAbortRef.current) provisionAbortRef.current.dead = true;
    };
  }, [stopPolling]);

  const activeEntry = state.entries.find((e) => e.id === state.activeId) ?? null;
  const unreadCount = state.messages.filter((m) => !m.seen).length;
  const activeSourceName = activeEntry
    ? activeEntry.mode === "demo"
      ? "演示"
      : (state.sources.find((s) => s.id === activeEntry.sourceId)?.name ?? "未知来源")
    : null;
  const retiredEntries = state.entries
    .filter((e) => typeof e.retiredAt === "number")
    .sort((a, b) => (b.retiredAt ?? 0) - (a.retiredAt ?? 0));

  return {
    ...state,
    unreadCount,
    activeEntry,
    activeSourceName,
    retiredEntries,
    purgeExpired,
    toast,
    dismissToast: () => setToast(null),
    notify,
    bootstrap,
    refresh,
    openMessage,
    closeMessage,
    addMailbox,
    createNewMailbox,
    enterDemo,
    switchToReal,
    switchTo,
    removeBox,
    syncCounts,
    addSource,
    updateSource,
    deleteSource,
    markUnread,
    removeMessage,
    getRawSource,
  };
}
