/**
 * 轻量 MIME 解析：把原始 RFC822 报文拆成 text / html，供验证码识别与正文渲染。
 *
 * 覆盖临时邮箱场景的常见形态：
 * - 单部分 text/plain 或 text/html
 * - multipart/alternative、multipart/mixed（两层以内）
 * - Content-Transfer-Encoding: base64 / quoted-printable / 7bit / 8bit
 * - charset 参数（utf-8 优先，其余交给 TextDecoder，失败回退 utf-8）
 *
 * 不解析附件、不处理嵌套超过两层的 multipart（那类邮件退化为原文展示，
 * 用户仍有「查看原文」兜底）。
 */

export interface ParsedMime {
  text: string | null;
  html: string[];
}

function splitHeaders(raw: string): { headers: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const idx = normalized.indexOf("\n\n");
  const head = idx === -1 ? normalized : normalized.slice(0, idx);
  const body = idx === -1 ? "" : normalized.slice(idx + 2);
  const headers: Record<string, string> = {};
  // 头部折叠行：以空白开头的行并入上一条
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line) && headers.__last) {
      headers[headers.__last] += " " + line.trim();
    } else {
      const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
      if (m) {
        headers[m[1].toLowerCase()] = m[2];
        headers.__last = m[1].toLowerCase();
      }
    }
  }
  delete headers.__last;
  return { headers, body };
}

function parseContentType(value: string | undefined): {
  type: string;
  params: Record<string, string>;
} {
  const type = value?.split(";")[0].trim().toLowerCase() || "text/plain";
  const params: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*"?([^";]+)"?/g;
  let m: RegExpExecArray | null;
  const rest = value?.slice(value.indexOf(";") + 1) ?? "";
  while ((m = re.exec(rest))) params[m[1].toLowerCase()] = m[2].trim();
  return { type, params };
}

function decodeByCte(body: string, cte: string, charset: string): string {
  const enc = cte.trim().toLowerCase();
  try {
    if (enc === "base64") {
      const clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
      const bin = atob(clean);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder(charset || "utf-8").decode(bytes);
    }
    if (enc === "quoted-printable") {
      const joined = body.replace(/=\r?\n/g, "");
      const bytes: number[] = [];
      for (let i = 0; i < joined.length; i++) {
        const c = joined[i];
        if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
          bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          bytes.push(joined.charCodeAt(i) & 0xff);
        }
      }
      return new TextDecoder(charset || "utf-8").decode(Uint8Array.from(bytes));
    }
  } catch {
    return body;
  }
  return body;
}

function splitParts(body: string, boundary: string): string[] {
  const lines = body.split(/\r?\n/);
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.trim() === `--${boundary}`) {
      if (current) parts.push(current.join("\n"));
      current = [];
    } else if (line.trim() === `--${boundary}--`) {
      if (current) parts.push(current.join("\n"));
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  if (current && current.length) parts.push(current.join("\n"));
  return parts;
}

function collectPart(partRaw: string, depth: number, out: { text: string | null; html: string[] }): void {
  const { headers, body } = splitHeaders(partRaw);
  const ct = parseContentType(headers["content-type"]);
  const cte = headers["content-transfer-encoding"] ?? "7bit";
  const disposition = (headers["content-disposition"] ?? "").toLowerCase();

  if (ct.type.startsWith("multipart/") && depth < 3 && ct.params.boundary) {
    for (const sub of splitParts(body, ct.params.boundary)) {
      collectPart(sub, depth + 1, out);
    }
    return;
  }
  // 跳过附件
  if (disposition.includes("attachment") || ct.params.name) return;

  const decoded = decodeByCte(body.trim(), cte, ct.params.charset ?? "utf-8");
  if (ct.type === "text/html") {
    out.html.push(decoded);
  } else if (ct.type === "text/plain") {
    out.text = out.text ? out.text + "\n\n" + decoded : decoded;
  }
}

export function parseMime(raw: string): ParsedMime {
  const out: ParsedMime = { text: null, html: [] };
  try {
    collectPart(raw, 0, out);
  } catch {
    /* 解析失败时退化为纯文本兜底 */
  }
  if (!out.text && out.html.length === 0) {
    // 兜底：把整个报文当纯文本（剥掉头部）
    const { body } = splitHeaders(raw);
    out.text = body.trim() || raw.trim();
  }
  return out;
}

/** 从原始报文中提取正文预览（列表摘要用）。 */
export function mimeIntro(raw: string, maxLen = 120): string {
  const parsed = parseMime(raw);
  const base = parsed.text
    ? parsed.text
    : parsed.html[0]
      ? parsed.html[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
      : "";
  return base.replace(/\s+/g, " ").trim().slice(0, maxLen);
}
