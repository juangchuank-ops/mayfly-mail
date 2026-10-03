/**
 * 邮件 HTML 的安全处理。
 * DOMPurify 去掉脚本与危险属性；远程图片默认不加载（隐私），
 * 用户明确点击后才展示；最终渲染进无脚本的 sandbox iframe。
 */
import DOMPurify from "dompurify";

export interface SanitizedMail {
  html: string;
  hadRemoteImages: boolean;
}

const ALLOWED_TAGS = [
  "a", "abbr", "b", "bdi", "blockquote", "br", "caption", "center", "cite",
  "code", "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img",
  "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "small", "span",
  "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "u", "ul", "font",
];

export function sanitizeMailHtml(raw: string): SanitizedMail {
  const clean = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "width", "height", "style", "colspan",
      "rowspan", "align", "valign", "border", "cellpadding", "cellspacing",
      "bgcolor", "dir", "start", "type",
    ],
    FORBID_ATTR: ["srcset"],
    ALLOW_DATA_ATTR: false,
  });

  const doc = new DOMParser().parseFromString(clean, "text/html");
  let hadRemoteImages = false;

  doc.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (/^\s*javascript:/i.test(href)) {
      a.removeAttribute("href");
    } else {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });

  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    const remote = /^https?:/i.test(src);
    if (remote) {
      hadRemoteImages = true;
      // 先占位，用户同意后再真正请求远程图片
      img.setAttribute("data-remote-src", src);
      img.removeAttribute("src");
    }
  });

  return { html: doc.body?.innerHTML ?? "", hadRemoteImages };
}

/** 在已消毒 HTML 的基础上，把占位图片恢复为远程加载。 */
export function enableRemoteImages(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("img[data-remote-src]").forEach((img) => {
    const src = img.getAttribute("data-remote-src");
    if (src) img.setAttribute("src", src);
  });
  return doc.body?.innerHTML ?? "";
}

/** iframe srcdoc：消毒后的正文 + 随主题变化的排版样式（不含任何脚本）。 */
export function buildFrameDoc(sanitizedHtml: string, dark: boolean): string {
  const colors = dark
    ? { bg: "#1a1a1a", ink: "#f0f0f0", ink2: "#b8b8b8", rule: "#2a2a2a", link: "#dedede" }
    : { bg: "#ffffff", ink: "#262626", ink2: "#595959", rule: "#e5e5e5", link: "#171717" };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    html,body{margin:0;padding:0}
    body{background:${colors.bg};color:${colors.ink};font:15px/1.65 "IBM Plex Sans","PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:4px 0 24px;word-wrap:break-word;overflow-wrap:anywhere}
    a{color:${colors.link};text-underline-offset:2px}
    img{max-width:100%;height:auto}
    table{max-width:100%;border-collapse:collapse}
    td,th{padding:2px}
    pre,code{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-size:13px;white-space:pre-wrap}
    hr{border:0;border-top:1px solid ${colors.rule};margin:16px 0}
    blockquote{margin:8px 0;padding:2px 12px;border-left:2px solid ${colors.rule};color:${colors.ink2}}
    h1,h2,h3,h4{line-height:1.35}
  </style></head><body>${sanitizedHtml}</body></html>`;
}
