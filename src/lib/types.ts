/** 领域模型：所有 Provider 必须适配到这套类型。 */

export interface Mailbox {
  address: string;
  mode: "real" | "demo";
  /** 凭据由 Provider 自行解释；仅保存在浏览器 localStorage。 */
  credentials: Record<string, string>;
}

export interface MessageSummary {
  id: string;
  fromName: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  intro: string;
  seen: boolean;
  hasAttachments: boolean;
  createdAt: string; // ISO
}

export interface MessageDetail extends MessageSummary {
  text: string | null;
  /** 每个元素是一段 HTML 文档片段（未经消毒，消毒在渲染层完成）。 */
  html: string[];
  /** Provider 是否能给出完整原始 MIME（含邮件头）。 */
  rawAvailable: boolean;
}

export interface ProviderError extends Error {
  kind: "network" | "auth" | "http" | "unavailable";
  status?: number;
}

export function providerError(
  kind: ProviderError["kind"],
  message: string,
  status?: number,
): ProviderError {
  const err = new Error(message) as ProviderError;
  err.kind = kind;
  err.status = status;
  return err;
}

/** 数据源适配层。真实后端与演示模式各自实现一份。 */
export interface MailProvider {
  readonly mode: "real" | "demo";
  /** 健康检查 / 是否可用。 */
  available(): Promise<boolean>;
  /** 创建一个全新邮箱；已有凭据时应先 restore。 */
  createMailbox(): Promise<Mailbox>;
  /** 用已保存的凭据恢复邮箱；失效时抛 kind:"auth"。 */
  restoreMailbox(credentials: Record<string, string>): Promise<Mailbox>;
  /** 预置凭据（不立即登录）；不支持时返回 false。 */
  seedCredentials?(credentials: Record<string, string>): boolean;
  /** 尝试完成登录/开通；已就绪或本次成功返回 true。 */
  provision(): Promise<boolean>;
  listMessages(): Promise<MessageSummary[]>;
  getMessage(id: string): Promise<MessageDetail>;
  /** 完整原始 MIME 文本；不支持时返回 null。 */
  getRawSource(id: string): Promise<string | null>;
  setSeen(id: string, seen: boolean): Promise<void>;
  deleteMessage(id: string): Promise<void>;
}
