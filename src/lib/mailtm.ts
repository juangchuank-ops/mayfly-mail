/**
 * mail.tm 公共 API 适配器（真实数据源）。
 * 文档：https://docs.mail.tm — CORS 对浏览器开放，速率限制约 8 次/秒。
 * 凭据（address/password/token）只保存在本机 localStorage，不经过任何第三方。
 */
import {
  type MailProvider,
  type Mailbox,
  type MessageSummary,
  type MessageDetail,
  providerError,
} from "./types";

const API = import.meta.env.VITE_MAIL_API_BASE ?? "/api";

interface Credentials {
  address: string;
  password: string;
  token?: string;
  accountId?: string;
}

function isCredentials(v: Record<string, string>): v is Credentials & Record<string, string> {
  return typeof v.address === "string" && typeof v.password === "string";
}

async function request<T>(
  path: string,
  opts: {
    method?: string;
    token?: string;
    body?: unknown;
    contentType?: string;
    accept?: string;
    raw?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: opts.accept ?? "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "application/json";
  }
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw providerError("network", "无法连接邮件服务，请检查网络后重试。");
  }
  if (opts.raw) return res.text() as T;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw providerError("auth", "登录状态已失效，请重新生成地址。", res.status);
    }
    if (res.status === 429) {
      throw providerError("http", "操作太频繁，请等一分钟再试。", res.status);
    }
    if (res.status === 422) {
      throw providerError("http", "服务拒绝了请求（地址可能已被占用）。", res.status);
    }
    let detail = "";
    try {
      const data = await res.json();
      detail = data?.["hydra:description"] ?? data?.detail ?? "";
    } catch {
      /* ignore */
    }
    throw providerError(
      "http",
      detail || `服务返回错误（${res.status}）。`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 地址前缀：一个可读单词 + 数字。不能用点号 —— mail.tm 会剥掉本地部分的点。 */
const WORDS = [
  "cedar", "otter", "maple", "ember", "quill", "drift", "slate", "fable",
  "harbor", "lumen", "moss", "nova", "onyx", "plume", "reef", "sable",
  "tide", "umbra", "vellum", "willow", "zephyr", "cinder", "dune", "echo",
];

function randomLocalPart(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = String(Math.floor(Math.random() * 900000) + 100000);
  return `${word}${num}`;
}

function randomPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const rand = crypto.getRandomValues(new Uint32Array(16));
  for (let i = 0; i < 16; i++) out += chars[rand[i] % chars.length];
  return out;
}

interface RawDomain {
  domain: string;
  isActive: boolean;
  isPrivate: boolean;
}

interface RawAccount {
  id: string;
  address: string;
}

interface RawMessage {
  id: string;
  from: { address: string; name?: string };
  to: { address: string; name?: string }[];
  subject: string;
  intro?: string;
  seen: boolean;
  hasAttachments: boolean;
  size: number;
  createdAt: string;
}

interface RawMessageDetail extends RawMessage {
  text?: string | null;
  html?: string[] | string | null;
}

function toSummary(m: RawMessage): MessageSummary {
  return {
    id: m.id,
    fromName: m.from.name?.trim() || m.from.address,
    fromAddress: m.from.address,
    toAddress: m.to?.[0]?.address ?? "",
    subject: m.subject || "(无主题)",
    intro: m.intro ?? "",
    seen: m.seen,
    hasAttachments: m.hasAttachments,
    createdAt: m.createdAt,
  };
}

/** mail.tm 依 Accept 头返回 hydra 集合或纯数组，两种形态都要兼容。 */
function hydraMember<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { "hydra:member"?: T[] })["hydra:member"])) {
    return (data as { "hydra:member": T[] })["hydra:member"];
  }
  return [];
}

export class MailTmProvider implements MailProvider {
  readonly mode = "real" as const;
  private creds: Credentials | null = null;

  private get token(): string {
    if (!this.creds?.token) throw providerError("auth", "尚未登录邮箱。");
    return this.creds.token;
  }

  async available(): Promise<boolean> {
    try {
      await request<unknown>("/domains?page=1");
      return true;
    } catch {
      return false;
    }
  }

  private async login(address: string, password: string): Promise<void> {
    const tok = await request<{ id: string; token: string }>("/token", {
      method: "POST",
      body: { address, password },
    });
    this.creds = { address, password, token: tok.token, accountId: tok.id };
  }

  /** 刚建好的账号在服务端有短暂同步延迟，/token 会瞬时 401，做退避重试。 */
  private async loginWithRetry(address: string, password: string): Promise<void> {
    const delays = [500, 1500, 3000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        await this.login(address, password);
        return;
      } catch (err) {
        if ((err as { status?: number }).status !== 401) throw err;
        lastErr = err;
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw lastErr;
  }

  async createMailbox(): Promise<Mailbox> {
    const domains = hydraMember<RawDomain>(await request<unknown>("/domains?page=1"));
    const active = domains.find((d) => d.isActive && !d.isPrivate);
    if (!active) throw providerError("unavailable", "服务暂无可用域名，请稍后再试。");

    // 建号接口限流约 1 次/分钟，不做自动重试，失败时如实告知。
    const requested = `${randomLocalPart()}@${active.domain}`;
    const password = randomPassword();
    const account = await request<RawAccount>("/accounts", {
      method: "POST",
      body: { address: requested, password },
    });
    // 以服务端返回的规范地址为准（本地部分可能被归一化）。
    this.creds = { address: account.address, password };
    // 建号后立即可登录；短暂 401 时退避重试兜底。
    try {
      await this.loginWithRetry(account.address, password);
    } catch {
      /* 仍未就绪 → provision() 会继续轮询 */
    }
    return { address: account.address, mode: "real", credentials: { ...this.creds } };
  }

  /** 已拿到 token 即视为就绪；否则用保存的凭据再试一次登录。 */
  async provision(): Promise<boolean> {
    if (this.creds?.token) return true;
    if (!this.creds) return false;
    try {
      await this.login(this.creds.address, this.creds.password);
      return true;
    } catch {
      return false;
    }
  }

  async restoreMailbox(credentials: Record<string, string>): Promise<Mailbox> {
    if (!isCredentials(credentials)) {
      throw providerError("auth", "本机保存的凭据不完整。");
    }
    try {
      await this.login(credentials.address, credentials.password);
    } catch (err) {
      const e = err as { kind?: string };
      if (e.kind === "auth") {
        throw providerError("auth", "邮箱已过期或已失效。");
      }
      throw err;
    }
    return { address: credentials.address, mode: "real", credentials: { ...this.creds } };
  }

  async listMessages(): Promise<MessageSummary[]> {
    // 用 ld+json 拿到 hydra 总数，翻页拉全（上限 3 页，防止旧邮件被截断）
    const first = await request<unknown>("/messages?page=1", {
      token: this.token,
      accept: "application/ld+json",
    });
    const all = [...hydraMember<RawMessage>(first)];
    const total = (first as { "hydra:totalItems"?: number })["hydra:totalItems"];
    let page = 1;
    while (typeof total === "number" && all.length < total && page < 3) {
      page += 1;
      const next = await request<unknown>(`/messages?page=${page}`, { token: this.token });
      all.push(...hydraMember<RawMessage>(next));
    }
    return all.map(toSummary);
  }

  async getMessage(id: string): Promise<MessageDetail> {
    const m = await request<RawMessageDetail>(`/messages/${id}`, { token: this.token });
    const html = Array.isArray(m.html) ? m.html : m.html ? [m.html] : [];
    return {
      ...toSummary(m),
      text: m.text ?? null,
      html,
      rawAvailable: true,
    };
  }

  /** 完整 RFC822 原始邮件（含全部邮件头）。 */
  async getRawSource(id: string): Promise<string | null> {
    return request<string>(`/messages/${id}/download`, { token: this.token, raw: true });
  }

  async setSeen(id: string, seen: boolean): Promise<void> {
    await request(`/messages/${id}`, {
      method: "PATCH",
      token: this.token,
      body: { seen },
      contentType: "application/merge-patch+json",
    });
  }

  async deleteMessage(id: string): Promise<void> {
    await request(`/messages/${id}`, { method: "DELETE", token: this.token });
  }
}
