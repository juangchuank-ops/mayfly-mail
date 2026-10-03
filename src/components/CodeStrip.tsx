import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, SearchX } from "lucide-react";
import { type CodeCandidate, extractCodes } from "../lib/codes";
import { copyText } from "../lib/clipboard";
import type { MessageDetail } from "../lib/types";

interface Props {
  message: MessageDetail;
  onNotify: (text: string, error?: boolean) => void;
}

function CandidateRow({ c, onCopied }: { c: CodeCandidate; onCopied: (v: string) => void }) {
  return (
    <li className="code-alt">
      <span className="code-value">{c.value}</span>
      <span className="code-context-inline">{c.context}</span>
      <button type="button" onClick={() => onCopied(c.value)}>
        复制
      </button>
    </li>
  );
}

export function CodeStrip({ message, onNotify }: Props) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [altsOpen, setAltsOpen] = useState(false);

  const { best, alternatives } = useMemo(
    () => extractCodes(message.subject, message.text, message.html),
    [message.subject, message.text, message.html],
  );

  const copy = async (value: string) => {
    const ok = await copyText(value);
    if (ok) {
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(null), 2000);
      onNotify(`验证码 ${value} 已复制`);
    } else {
      onNotify("复制失败，请手动选择复制", true);
    }
  };

  if (!best && alternatives.length === 0) {
    return (
      <div className="code-strip" aria-label="验证码识别">
        <div className="code-strip-head">
          <span className="code-label">验证码</span>
          <span className="code-none">
            <SearchX size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
            未在这封邮件里识别到验证码
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="code-strip" aria-label="验证码识别">
      {best && (
        <>
          <div className="code-strip-head">
            <span className="code-label">验证码</span>
            <span className="code-value" translate="no">
              {best.value}
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => copy(best.value)}
              aria-label={`复制验证码 ${best.value}`}
            >
              {copiedValue === best.value ? (
                <Check size={15} aria-hidden />
              ) : (
                <Copy size={15} aria-hidden />
              )}
            </button>
          </div>
          {best.context && <p className="code-context">{best.context}</p>}
        </>
      )}

      {alternatives.length > 0 && (
        <div className="code-alts">
          <button
            type="button"
            className="code-alts-toggle"
            onClick={() => setAltsOpen((v) => !v)}
            aria-expanded={altsOpen}
          >
            {altsOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
            其他候选（{alternatives.length}）
          </button>
          {altsOpen && (
            <ul className="code-alts-list">
              {alternatives.map((c) => (
                <CandidateRow key={c.value} c={c} onCopied={copy} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
