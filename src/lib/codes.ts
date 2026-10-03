/**
 * 验证码识别：从主题 + 正文文本中找出可能的验证码。
 *
 * 策略：
 * 1. 候选提取 —— 4~8 位数字、或「字母+数字混合」的 5~8 位字母数字串，
 *    前后不能紧贴其他字母数字（避免从电话、订单号、长串里截出片段）。
 * 2. 误报排除 —— 出现在日期、金额、电话、URL、邮箱、年份里的直接剔除。
 * 3. 上下文评分 —— 验证码关键词（验证码 / verification code / OTP …）
 *    出现在候选值附近则加分，主题里出现关键词再加分；
 *    语义模式「验证码：582914」「code is XXX」强加分。
 * 4. 排序输出；不可靠时调用方必须明确显示「未识别」，不得编造。
 */

export interface CodeCandidate {
  value: string;
  score: number;
  /** 候选值附近的一小段上下文，用于人工确认。 */
  context: string;
}

const CODE_KEYWORDS = [
  "验证码", "校验码", "动态码", "确认码", "安全码", "一次性", "动态密码",
  "verification code", "verify code", "security code", "passcode", "one-time",
  "one time", "otp", "auth code", "authorization code", "login code", "confirmation code",
  "code is", "code:", "code：", "your code", "access code", "pin",
];

/** 「code 582914」「验证码是 582914」这类紧邻模式 */
const ADJACENT_PATTERNS: RegExp[] = [
  /(?:验证码|校验码|动态码|确认码|安全码|otp|code|passcode|pin)\s*(?:是|为|:|：|=)?\s*([0-9]{4,8}|(?=[A-Z0-9]{5,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5,8})/i,
  /((?=[A-Z0-9]{5,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5,8})\s*(?:是|为)\s*(?:您的?|你的?)?\s*(?:验证码|校验码|动态码|确认码|otp|code)/i,
  /(?:is|:)\s*([0-9]{4,8})\s*(?:is\s*your)?\s*(?:verification|security|login|access|confirm\w*)?\s*code/i,
];

function extractCandidates(text: string): { value: string; index: number }[] {
  const out: { value: string; index: number }[] = [];
  const seen = new Set<string>();
  const push = (value: string, index: number) => {
    const key = value.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ value, index });
    }
  };

  // 字母数字混合（必须同时含字母与数字，5~8 位）
  const alnum = /(?<![A-Za-z0-9])(?=[A-Za-z0-9]{5,8})(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{5,8}(?![A-Za-z0-9])/g;
  for (const m of text.matchAll(alnum)) push(m[0], m.index ?? 0);

  // 纯数字 4~8 位
  const digits = /(?<![0-9A-Za-z])[0-9]{4,8}(?![0-9])/g;
  for (const m of text.matchAll(digits)) push(m[0], m.index ?? 0);

  return out;
}

function isExcluded(text: string, value: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 3), index);
  const after = text.slice(index + value.length, index + value.length + 3);

  // 邮箱 / URL / 参数里出现的串
  if (/(^|[^A-Za-z0-9])[\w.+-]*@[\w-]+\.[\w.]*$/.test(before + value) || /@/.test(after)) {
    if (/@/.test(before.slice(-1) + after) || before.endsWith("@") || after.startsWith("@")) {
      return true;
    }
  }
  if (before.endsWith("/") || before.endsWith("=") || before.endsWith("?") || before.endsWith("&")) {
    return true;
  }

  // 日期片段：2026-10-03 / 2026.10 / 10/03 之类
  if (/^[-/.年]\s*\d/.test(after) || /\d\s*[-/.]$/.test(before)) {
    return true;
  }

  // 年份：1900–2099 的裸 4 位数字，且后面直接跟「年/year」或位于日期格式中
  if (/^\d{4}$/.test(value)) {
    const n = Number(value);
    if (n >= 1900 && n <= 2099 && /^(年|\s*year)/i.test(after)) return true;
  }

  // 金额：前面是货币符号，或后面紧跟货币单位
  if (/[$¥€£]\s*$/.test(before) || /^(元|圆|块钱|美元|usd|cny|rmb|dollars?)/i.test(after)) {
    return true;
  }

  // 电话：前后有 tel/电话/手机 语境，或候选是 7~8 位且前一位是 0（区号）
  if (/(电话|手机|tel|phone|call)\s*[:：]?\s*$/i.test(before)) return true;
  if (/^1[3-9]/.test(value) && value.length >= 7) return true;

  // 纯数字且疑似时间（14:30 形式不会进来，但 0930 这类跟进在后）：
  if (/^\d{4}$/.test(value) && /^\s*[ap]?m?\b/i.test(after) && /(at|时间|上午|下午)/i.test(text.slice(Math.max(0, index - 24), index))) {
    return true;
  }
  return false;
}

function scoreCandidate(
  text: string,
  subject: string,
  value: string,
  index: number,
): number {
  const around = text.slice(Math.max(0, index - 80), index + value.length + 80).toLowerCase();
  const upperValue = value.toUpperCase();
  const hasAlnum = /[A-Za-z]/.test(value) && /\d/.test(value);
  let score = 0;

  // 长度先验：6 位数字最常见；4~8 均可
  if (/^\d{6}$/.test(value)) score += 1.5;
  else if (/^\d{4}$/.test(value) || /^\d{8}$/.test(value)) score += 0.5;
  else if (/^\d{5}$/.test(value) || /^\d{7}$/.test(value)) score += 1;

  if (hasAlnum) score += 1;

  // 紧邻语义模式：最强的信号
  for (const re of ADJACENT_PATTERNS) {
    const m = re.exec(text);
    if (m && m[1]?.toUpperCase() === upperValue) {
      score += 4;
      break;
    }
  }

  // 附近出现验证码关键词
  const near = around.toLowerCase();
  for (const kw of CODE_KEYWORDS) {
    if (near.includes(kw)) {
      score += kw.length <= 4 ? 0.6 : 1.2;
      break;
    }
  }

  // 主题里出现关键词（整封邮件的性质）
  const subjectLower = subject.toLowerCase();
  if (CODE_KEYWORDS.some((kw) => subjectLower.includes(kw))) score += 1.5;

  // 出现次数：验证码通常只在个别位置出现；反复出现更像编号
  const occurrences = text.toUpperCase().split(upperValue).length - 1;
  if (occurrences > 4) score -= 1.5;

  // 递增/重复数字（1111、1234）常见于示例，降权一点
  if (/^(\d)\1+$/.test(value)) score -= 1;
  return score;
}

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 36);
  const end = Math.min(text.length, index + len + 36);
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return head + text.slice(start, end).replace(/\s+/g, " ").trim() + tail;
}

/**
 * 返回按可靠性排序的候选值。
 * best 为 null 表示没有可信候选 —— 调用方必须如实显示「未识别」。
 */
export function extractCodes(
  subject: string,
  textBody: string | null,
  htmlBody: string[],
): { best: CodeCandidate | null; alternatives: CodeCandidate[] } {
  let text = textBody?.trim() || "";
  if (!text && htmlBody.length > 0) {
    // 仅 HTML 邮件：先转成纯文本再识别
    const doc = new DOMParser().parseFromString(htmlBody[0], "text/html");
    doc.querySelectorAll("script,style").forEach((el) => el.remove());
    text = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  if (!text) return { best: null, alternatives: [] };

  const full = `${subject}\n${text}`;
  const scored: CodeCandidate[] = [];

  for (const { value, index } of extractCandidates(full)) {
    if (isExcluded(full, value, index)) continue;
    // 主题偏移：主题关键词权重要覆盖到正文，全文统一在 full 上打分即可
    const score = scoreCandidate(full, subject, value, index);
    scored.push({ value, score, context: snippetAround(full, index, value.length) });
  }

  scored.sort((a, b) => b.score - a.score);

  // 可靠阈值：没有任何语义信号时（纯数字且无关键词），不作为「已识别」
  const reliable = scored.find((c) => c.score >= 2.4) ?? null;
  const alternatives = scored
    .filter((c) => c !== reliable && c.score >= 1.2)
    .slice(0, 3);

  return { best: reliable, alternatives };
}
