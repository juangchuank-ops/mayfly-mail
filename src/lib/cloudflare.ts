/**
 * Cloudflare Worker 自建临时邮箱适配器。
 *
 * 对接「拿域名 + Cloudflare Email Routing + Worker 收信」这类自建部署
 * （以 dreamhunter2333/cloudflare_temp_email 的 API 形状为准）：
 * - GET  /open_api/settings        → { defaultDomains: string[] }（无鉴权；旧部署回退 GET /settings，需管理令牌）
 * - POST /api/new_address          → { jwt }，body { name, domain }
 * - GET  /api/mails?limit&offset   → { results: [{ id, source, subject, message, created_at }], count }
 * - DELETE /api/mails/{id}         → 需管理令牌（未配置时如实返回不支持）
 *
 * 认证：地址级 Bearer JWT（创建地址时返回）；管理令牌仅用于设置/删除。
 * 已读状态：该类后端没有已读概念，本地 localStorage 记录（按数据源+地址区分）。
 * 原始报文：`message` 字段即完整 RFC822 原文，「查看原文」与正文解析都基于它。
 */
import {
  type MailProvider,
  type Mailbox,
  type MessageSummary,
  type MessageDetail,
  providerError,
} from "./types";
import { parseMime, mimeIntro } from "./mime";

const WORDS = [
  "cedar", "otter", "maple", "ember", "quill", "drift", "slate", "fable",
  "harbor", "lumen", "moss", "nova", "onyx", "plume", "reef", "sable",
  "tide", "umbra", "vellum", "willow", "zephyr", "cinder", "dune", "echo",
];

export interface CloudflareSourceOptions {
  /** Worker 地址，例如 https://mail.example.workers.dev（不含末尾斜杠）。 */
  baseUrl: string;
  /** 可选管理令牌：用于读取设置与删除邮件。 */
  adminToken?: string;
}

interface RawCfMail {
  id: number | string;
  source?: string;
  address?: string;
  subject?: string;
  message?: string;
  created_at?: string;
}

export class CloudflareEmailProvider implements MailProvider {
  readonly mode = "real" as const;
  private creds: { address: string; jwt: string } | null = null;
  private domains: string[] | null = null;
  private readonly opts: CloudflareSourceOptions;

  constructor(opts: CloudflareSourceOptions) {
    this.opts = opts;
  }

  private get api(): string {
    return this.opts.baseUrl.replace(/\/+$/, "");
  }

  private addressAuth(): string {
    if (!this.creds?.jwt) throw providerError("auth", "尚未登录邮箱。");
    return `Bearer ${this.creds.jwt}`;
  }

  private adminAuth(): string | undefined {
    return this.opts.adminToken ? `Bearer ${this.opts.adminToken}` : undefined;
  }

  private async req<T>(
    path: string,
    init: { method?: string; body?: unknown; auth?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.auth) headers.Authorization = init.auth;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(this.api + path, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw providerError("network", "无法连接邮件服务，请检查网络后重试。");
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw providerError("auth", "登录状态已失效，请重新生成地址。", res.status);
      }
      if (res.status === 429) {
        throw providerError("http", "操作太频繁，请等一分钟再试。", res.status);
      }
      let detail = "";
      try {
        detail = (await res.json())?.message ?? "";
      } catch {
        /* ignore */
      }
      throw providerError("http", detail || `服务返回错误（${res.status}）。`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** 可用域名：优先开放设置接口，旧部署回退到需要管理令牌的 /settings。 */
  async fetchDomains(): Promise<string[]> {
    if (this.domains) return this.domains;
    let domains: string[] = [];
    try {
      const data = await this.req<{ defaultDomains?: string[] }>("/open_api/settings");
      domains = data.defaultDomains ?? [];
    } catch {
      const auth = this.adminAuth();
      if (auth) {
        const data = await this.req<{ defaultDomains?: string[]; domains?: string[] }>("/settings", { auth });
        domains = data.defaultDomains ?? data.domains ?? [];
      }
    }
    domains = domains.filter(Boolean);
    if (domains.length === 0) {
      throw providerError("unavailable", "该数据源没有可用域名，请检查 Worker 设置。");
    }
    this.domains = domains;
    return domains;
  }

  async available(): Promise<boolean> {
    try {
      await this.fetchDomains();
      return true;
    } catch {
      return false;
    }
  }

  async createMailbox(): Promise<Mailbox> {
    const domains = await this.fetchDomains();
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const name = `${WORDS[Math.floor(Math.random() * WORDS.length)]}${Math.floor(Math.random() * 900000) + 100000}`;
    const data = await this.req<{ jwt: string }>("/api/new_address", {
      method: "POST",
      body: { name, domain },
      auth: this.adminAuth(),
    });
    if (!data.jwt) throw providerError("http", "服务未返回地址凭据，请检查 Worker 配置。");
    this.creds = { address: `${name}@${domain}`, jwt: data.jwt };
    return { address: this.creds.address, mode: "real", credentials: { ...this.creds } };
  }

  seedCredentials(credentials: Record<string, string>): boolean {
    if (typeof credentials.address !== "string" || typeof credentials.jwt !== "string") return false;
    this.creds = { address: credentials.address, jwt: credentials.jwt };
    return true;
  }

  async restoreMailbox(credentials: Record<string, string>): Promise<Mailbox> {
    if (
      !this.seedCredentials(credentials) ||
      typeof credentials.address !== "string" ||
      typeof credentials.jwt !== "string"
    ) {
      throw providerError("auth", "本机保存的凭据不完整。");
    }
    // 用一次轻量请求验证凭据
    try {
      await this.req<{ results?: unknown[] }>("/api/mails?limit=1&offset=0", {
        auth: this.addressAuth(),
      });
    } catch (err) {
      const e = err as { kind?: string };
      throw e.kind === "auth"
        ? providerError("auth", "邮箱已过期或已失效。")
        : e.kind === "network"
          ? err
          : providerError("auth", "邮箱已过期或已失效。");
    }
    return { address: this.creds!.address, mode: "real", credentials: { ...this.creds } };
  }

  async provision(): Promise<boolean> {
    return !!this.creds?.jwt;
  }

  private readsKey(): string {
    return `mayfly.reads.${this.opts.baseUrl}#${this.creds?.address ?? ""}`;
  }

  private readSet(): Set<string> {
    try {
      const arr = JSON.parse(localStorage.getItem(this.readsKey()) ?? "[]") as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  private persistReads(set: Set<string>) {
    localStorage.setItem(this.readsKey(), JSON.stringify([...set]));
  }

  private async fetchMails(): Promise<RawCfMail[]> {
    const data = await this.req<{ results?: RawCfMail[] }>("/api/mails?limit=30&offset=0", {
      auth: this.addressAuth(),
    });
    const mails = data.results ?? [];
    return [...mails].sort((a, b) => {
      const ta = new Date(a.created_at ?? 0).getTime() || 0;
      const tb = new Date(b.created_at ?? 0).getTime() || 0;
      return tb - ta;
    });
  }

  async listMessages(): Promise<MessageSummary[]> {
    const mails = await this.fetchMails();
    const reads = this.readSet();
    return mails.map((m) => {
      const raw = m.message ?? "";
      return {
        id: String(m.id),
        fromName: m.source?.trim() || m.source || "(未知发件人)",
        fromAddress: m.source ?? "",
        toAddress: this.creds?.address ?? "",
        subject: m.subject?.trim() || "(无主题)",
        intro: mimeIntro(raw),
        seen: reads.has(String(m.id)),
        hasAttachments: false,
        createdAt: m.created_at ?? new Date().toISOString(),
      };
    });
  }

  private async findMail(id: string): Promise<RawCfMail> {
    const mails = await this.fetchMails();
    const mail = mails.find((m) => String(m.id) === id);
    if (!mail) throw providerError("http", "找不到这封邮件，可能已被服务端清理。");
    return mail;
  }

  async getMessage(id: string): Promise<MessageDetail> {
    const mail = await this.findMail(id);
    const raw = mail.message ?? "";
    const parsed = parseMime(raw);
    const reads = this.readSet();
    reads.add(id);
    this.persistReads(reads);
    return {
      id: String(mail.id),
      fromName: mail.source?.trim() || mail.source || "(未知发件人)",
      fromAddress: mail.source ?? "",
      toAddress: this.creds?.address ?? "",
      subject: mail.subject?.trim() || "(无主题)",
      intro: mimeIntro(raw),
      seen: true,
      hasAttachments: false,
      createdAt: mail.created_at ?? new Date().toISOString(),
      text: parsed.text,
      html: parsed.html,
      rawAvailable: true,
    };
  }

  async getRawSource(id: string): Promise<string | null> {
    const mail = await this.findMail(id);
    return mail.message ?? null;
  }

  async setSeen(id: string, seen: boolean): Promise<void> {
    const reads = this.readSet();
    if (seen) reads.add(id);
    else reads.delete(id);
    this.persistReads(reads);
  }

  async deleteMessage(id: string): Promise<void> {
    if (!this.opts.adminToken) {
      throw providerError("http", "该数据源未配置管理令牌，无法删除邮件。");
    }
    await this.req(`/api/mails/${id}`, { method: "DELETE", auth: this.adminAuth() });
  }
}
