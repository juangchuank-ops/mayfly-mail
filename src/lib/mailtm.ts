/**
 * mail.tm 兼容 API 适配器。
 *
 * 同一份实现服务两类数据源：
 * - 内置公共源（经 Vite 代理 /api → api.mail.tm，或 VITE_MAIL_API_BASE 指向的反代）；
 * - 用户自建数据源（baseUrl 指向自建后端，契约与 mail.tm API 形状一致：
 *   GET /domains、POST /accounts、POST /token、GET /messages、
 *   GET /messages/{id}、GET /messages/{id}/download、PATCH /messages/{id}、DELETE /messages/{id}）。
 *
 * 认证两种模式：
 * - 未配置静态令牌：mail.tm 原生流程（POST /token 换 JWT）；
 * - 配置了静态令牌：所有请求带 `Authorization: Bearer <token>`，跳过 /token 登录
 *   （适合带网关令牌的自建后端）。
 *
 * 注意：mail.tm 会把地址本地部分中的点号剥离，登录一律以创建接口返回的规范地址为准。
 */
import {
  type MailProvider,
  type Mailbox,
  type MessageSummary,
  type MessageDetail,
  providerError,
} from "./types";

const DEFAULT_API_BASE = import.meta.env.VITE_MAIL_API_BASE ?? "/api";

export interface MailTmSourceOptions {
  /** API 根地址，例如 "/api" 或 "https://mail.example.com/api"。 */
  baseUrl: string;
  /** 可选静态令牌：配置后所有请求用它作为 Bearer，跳过 /token 登录。 */
  staticToken?: string;
}

interface Credentials {
  address: string;
  password: string;
  token?: string;
  accountId?: string;
}

function isCredentials(
  v: { address?: unknown; password?: unknown } | null | undefined,
): v is Credentials & Record<string, string> {
  return !!v && typeof v.address === "string" && typeof v.password === "string";
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
  private readonly opts: MailTmSourceOptions;

  constructor(opts: MailTmSourceOptions = { baseUrl: DEFAULT_API_BASE }) {
    this.opts = opts;
  }

  private get api(): string {
    return this.opts.baseUrl.replace(/\/+$/, "");
  }

  private authHeader(): string | undefined {
    if (this.opts.staticToken) return `Bearer ${this.opts.staticToken}`;
    if (!this.creds?.token) throw providerError("auth", "尚未登录邮箱。");
    return `Bearer ${this.creds.token}`;
  }

  async request<T>(
    path: string,
    reqOpts: {
      method?: string;
      body?: unknown;
      contentType?: string;
      accept?: string;
      raw?: boolean;
      skipAuth?: boolean;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: reqOpts.accept ?? "application/json" };
    if (!reqOpts.skipAuth) {
      const auth = this.authHeader();
      if (auth) headers.Authorization = auth;
    }
    if (reqOpts.body !== undefined) {
      headers["Content-Type"] = reqOpts.contentType ?? "application/json";
    }
    let res: Response;
    try {
      res = await fetch(this.api + path, {
        method: reqOpts.method ?? "GET",
        headers,
        body: reqOpts.body === undefined ? undefined : JSON.stringify(reqOpts.body),
      });
    } catch {
      throw providerError("network", "无法连接邮件服务，请检查网络后重试。");
    }
    if (reqOpts.raw) return res.text() as T;
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
      throw providerError("http", detail || `服务返回错误（${res.status}）。`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async available(): Promise<boolean> {
    try {
      await this.request<unknown>("/domains?page=1");
      return true;
    } catch {
      return false;
    }
  }

  private async login(address: string, password: string): Promise<void> {
    const tok = await this.request<{ id: string; token: string }>("/token", {
      method: "POST",
      body: { address, password },
      skipAuth: true,
    });
    this.creds = { address, password, token: tok.token, accountId: tok.id };
  }

  /** 刚建好的账号可能有短暂同步延迟，/token 瞬时 401 时退避重试。 */
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
    const domains = hydraMember<RawDomain>(
      await this.request<unknown>("/domains?page=1", { skipAuth: !this.opts.staticToken && !this.creds }),
    );
    const active = domains.find((d) => d.isActive && !d.isPrivate);
    if (!active) throw providerError("unavailable", "服务暂无可用域名，请稍后再试。");

    // 建号接口限流约 1 次/分钟，不做自动重试，失败时如实告知。
    const requested = `${randomLocalPart()}@${active.domain}`;
    const password = randomPassword();
    const account = await this.request<RawAccount>("/accounts", {
      method: "POST",
      body: { address: requested, password },
      skipAuth: !this.opts.staticToken && !this.creds,
    });
    if (this.opts.staticToken) {
      // 静态令牌模式：不需要 /token 换 JWT，直接登记凭据。
      this.creds = { address: account.address, password };
    } else {
      this.creds = { address: account.address, password };
      // 建号后立即可登录；短暂 401 时退避重试兜底。
      try {
        await this.loginWithRetry(account.address, password);
      } catch {
        /* 仍未就绪 → provision() 会继续轮询 */
      }
    }
    return { address: account.address, mode: "real", credentials: { ...this.creds } };
  }

  /** 预置凭据（不立即登录），供「邮箱尚未开通」的恢复路径使用。 */
  seedCredentials(credentials: Record<string, string>): boolean {
    if (!isCredentials(credentials)) return false;
    this.creds = { address: credentials.address, password: credentials.password };
    return true;
  }

  async restoreMailbox(credentials: Record<string, string>): Promise<Mailbox> {
    if (this.opts.staticToken) {
      // 静态令牌模式：无独立登录流程。
      if (typeof credentials.address !== "string") {
        throw providerError("auth", "本机保存的凭据不完整。");
      }
      this.creds = { address: credentials.address, password: credentials.password ?? "" };
      return { address: credentials.address, mode: "real", credentials: { ...this.creds } };
    }
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

  /** 已就绪（静态令牌或已有 JWT）返回 true；否则用已有凭据尝试登录一次。 */
  async provision(): Promise<boolean> {
    if (this.opts.staticToken) return true;
    if (this.creds?.token) return true;
    if (!isCredentials(this.creds)) return false;
    try {
      await this.login(this.creds.address, this.creds.password);
      return true;
    } catch {
      return false;
    }
  }

  async listMessages(): Promise<MessageSummary[]> {
    // 用 ld+json 拿到 hydra 总数，翻页拉全（上限 3 页，防止旧邮件被截断）
    const first = await this.request<unknown>("/messages?page=1", {
      accept: "application/ld+json",
    });
    const all = [...hydraMember<RawMessage>(first)];
    const total = (first as { "hydra:totalItems"?: number })["hydra:totalItems"];
    let page = 1;
    while (typeof total === "number" && all.length < total && page < 3) {
      page += 1;
      const next = await this.request<unknown>(`/messages?page=${page}`);
      all.push(...hydraMember<RawMessage>(next));
    }
    return all.map(toSummary);
  }

  async getMessage(id: string): Promise<MessageDetail> {
    const m = await this.request<RawMessageDetail>(`/messages/${id}`);
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
    return this.request<string>(`/messages/${id}/download`, { raw: true });
  }

  async setSeen(id: string, seen: boolean): Promise<void> {
    await this.request(`/messages/${id}`, {
      method: "PATCH",
      body: { seen },
      contentType: "application/merge-patch+json",
    });
  }

  async deleteMessage(id: string): Promise<void> {
    await this.request(`/messages/${id}`, { method: "DELETE" });
  }
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
