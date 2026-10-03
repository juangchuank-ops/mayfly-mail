/**
 * 演示模式适配器：仅在无法连接邮件服务（或 URL 带 ?demo=1）时启用。
 * 全部数据为本地模拟，界面上会有明确的「演示模式」横幅与状态标记，
 * 不冒充真实邮件。验证码等值为编造的示例格式。
 */
import {
  type MailProvider,
  type Mailbox,
  type MessageSummary,
  type MessageDetail,
} from "./types";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

interface DemoMessage extends MessageDetail {
  raw: string;
}

function htmlWrap(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fff;color:#222;font:14px/1.6 -apple-system,'Segoe UI',sans-serif;">${inner}</body></html>`;
}

function makeMessages(): DemoMessage[] {
  return [
    {
      id: "demo-code-1",
      fromName: "Nimbus Cloud",
      fromAddress: "no-reply@nimbus-cloud.example.com",
      toAddress: "mayfly.demo@demo.local",
      subject: "【Nimbus Cloud】登录验证码：582914，10 分钟内有效",
      intro: "您正在登录 Nimbus Cloud。验证码 582914，请勿泄露给他人。",
      seen: false,
      hasAttachments: false,
      createdAt: minutesAgo(2),
      text: "您正在登录 Nimbus Cloud。\n\n您的验证码是 582914，10 分钟内有效。\n\n如果这不是您本人的操作，请忽略本邮件。\n\nNimbus Cloud 安全团队",
      html: [
        htmlWrap(
          '<div style="font-family:inherit"><p>您正在登录 <b>Nimbus Cloud</b>。</p><p style="font-size:22px;letter-spacing:3px"><b>582914</b></p><p>验证码 <b>10 分钟</b>内有效。请勿泄露给他人。</p><p style="color:#888">如果这不是您本人的操作，请忽略本邮件。</p></div>',
        ),
      ],
      rawAvailable: true,
      raw: [
        "From: Nimbus Cloud <no-reply@nimbus-cloud.example.com>",
        "To: mayfly.demo@demo.local",
        `Date: ${new Date(Date.now() - 2 * 60_000).toUTCString()}`,
        "Subject: =?utf-8?B?...?= 【Nimbus Cloud】登录验证码：582914",
        "MIME-Version: 1.0",
        'Content-Type: multipart/alternative; boundary="demo-boundary-1"',
        "",
        "--demo-boundary-1",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        "您正在登录 Nimbus Cloud。您的验证码是 582914，10 分钟内有效。",
        "",
        "--demo-boundary-1",
        'Content-Type: text/html; charset="utf-8"',
        "",
        "<p>您的验证码是 <b>582914</b>，10 分钟内有效。</p>",
        "--demo-boundary-1--",
        "",
        "（以上为演示数据：模拟的原始邮件，非真实报文）",
      ].join("\n"),
    },
    {
      id: "demo-html-1",
      fromName: "Orbit Weekly",
      fromAddress: "letter@orbit-weekly.example.org",
      toAddress: "mayfly.demo@demo.local",
      subject: "Orbit Weekly · 第 214 期：轨道上的这一周",
      intro: "本周要点：近地轨道货运计划延期，深空网络完成年度演练……",
      seen: false,
      hasAttachments: false,
      createdAt: minutesAgo(47),
      text: "本周要点：近地轨道货运计划延期，深空网络完成年度演练。",
      html: [
        htmlWrap(
          '<div style="max-width:560px;margin:0 auto"><h2 style="font-size:18px;margin:0 0 12px">轨道上的这一周</h2><p>近地轨道货运计划因天气延期至下周窗口。</p><p>深空网络完成年度演练，测控链路冗余全部通过验证。</p><hr style="border:0;border-top:1px solid #ddd"><p style="color:#999;font-size:12px">Orbit Weekly · 每周五发出 · <a href="https://orbit-weekly.example.org">example.org</a></p></div>',
        ),
      ],
      rawAvailable: true,
      raw: [
        "From: Orbit Weekly <letter@orbit-weekly.example.org>",
        "To: mayfly.demo@demo.local",
        "Subject: Orbit Weekly - No.214",
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="utf-8"',
        "",
        "<h2>轨道上的这一周</h2><p>近地轨道货运计划延期。</p>",
        "",
        "（以上为演示数据：模拟的原始邮件，非真实报文）",
      ].join("\n"),
    },
    {
      id: "demo-nocode-1",
      fromName: "Atlas Hosting",
      fromAddress: "billing@atlas-hosting.example.net",
      toAddress: "mayfly.demo@demo.local",
      subject: "订单已确认：Atlas Hosting 年度主机套餐（订单号 AT-20261003-7741）",
      intro: "您的订单已确认，金额 ¥680.00，预计 2 小时内开通。此邮件为确认凭据，请勿回复。",
      seen: true,
      hasAttachments: true,
      createdAt: minutesAgo(190),
      text: "您的订单已确认。\n\n订单号：AT-20261003-7741\n金额：¥680.00\n开通时间：预计 2 小时内\n\n客服电话 400-100-2345，工作日 9:00-18:00。",
      html: [],
      rawAvailable: true,
      raw: [
        "From: Atlas Hosting <billing@atlas-hosting.example.net>",
        "To: mayfly.demo@demo.local",
        "Subject: Order confirmed AT-20261003-7741",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        "您的订单已确认。订单号 AT-20261003-7741，金额 680.00 CNY。",
        "",
        "（以上为演示数据：模拟的原始邮件，非真实报文）",
      ].join("\n"),
    },
    {
      id: "demo-nocode-2",
      fromName: "Mira Chen",
      fromAddress: "mira.chen@artstudio.example.com",
      toAddress: "mayfly.demo@demo.local",
      subject:
        "关于下月联合展览的场地档期、展签排版与运输保险细节，想约个时间对一下（长主题测试：主题在列表里应当省略而不是撑破布局）",
      intro: "你好，场地那边给了三个档期，附上了平面图，你看看哪个合适……",
      seen: true,
      hasAttachments: false,
      createdAt: minutesAgo(1_500),
      text: "你好，\n\n场地那边给了三个档期：10 月 14 日、10 月 21 日、11 月 2 日，附上了平面图，你看看哪个合适。展签排版我想用之前那版字体，运输保险走去年的同一家。\n\n有空回个电话。\n\nMira",
      html: [],
      rawAvailable: true,
      raw: [
        "From: Mira Chen <mira.chen@artstudio.example.com>",
        "To: mayfly.demo@demo.local",
        "Subject: (long subject demo)",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        "场地档期：10 月 14 日、10 月 21 日、11 月 2 日。",
        "",
        "（以上为演示数据：模拟的原始邮件，非真实报文）",
      ].join("\n"),
    },
  ];
}

export class DemoProvider implements MailProvider {
  readonly mode = "demo" as const;
  private messages: DemoMessage[] = makeMessages();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 模拟「收着收着来了一封新邮件」。 */
  private delayed = true;

  async available(): Promise<boolean> {
    return true;
  }

  async createMailbox(): Promise<Mailbox> {
    const n = Math.floor(Math.random() * 900 + 100);
    return {
      address: `mayfly.demo.${n}@demo.local`,
      mode: "demo",
      credentials: {},
    };
  }

  async restoreMailbox(credentials: Record<string, string>): Promise<Mailbox> {
    // 演示会话在同一浏览器里保持同一个演示地址，避免每次刷新都换号
    const address =
      typeof credentials.address === "string" && credentials.address.includes("@demo.local")
        ? credentials.address
        : (await this.createMailbox()).address;
    return { address, mode: "demo", credentials: {} };
  }

  async provision(): Promise<boolean> {
    return true;
  }

  private maybeScheduleArrival(): void {
    if (!this.delayed || this.timer) return;
    this.delayed = false;
    this.timer = setTimeout(() => {
      this.messages.unshift({
        id: "demo-code-2",
        fromName: "ForgeID",
        fromAddress: "verify@forgeid.example.com",
        toAddress: "mayfly.demo@demo.local",
        subject: "Your ForgeID verification code: HK7Q2M",
        intro: "Use code HK7Q2M to finish signing in. It expires in 5 minutes.",
        seen: false,
        hasAttachments: false,
        createdAt: new Date().toISOString(),
        text: "Your ForgeID verification code is HK7Q2M. It expires in 5 minutes.\n\nIf you didn't request this, ignore this email.",
        html: [
          htmlWrap(
            '<p>Use code <b style="font-size:20px;letter-spacing:2px">HK7Q2M</b> to finish signing in. It expires in <b>5 minutes</b>.</p>',
          ),
        ],
        rawAvailable: true,
        raw: [
          "From: ForgeID <verify@forgeid.example.com>",
          "To: mayfly.demo@demo.local",
          "Subject: Your ForgeID verification code: HK7Q2M",
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="utf-8"',
          "",
          "Your ForgeID verification code is HK7Q2M. It expires in 5 minutes.",
          "",
          "（以上为演示数据：模拟的原始邮件，非真实报文）",
        ].join("\n"),
      });
      this.timer = null;
      window.dispatchEvent(new CustomEvent("demo-mail-arrived"));
    }, 35_000);
  }

  async listMessages(): Promise<MessageSummary[]> {
    this.maybeScheduleArrival();
    return this.messages.map(({ raw: _raw, text: _t, html: _h, rawAvailable: _r, ...rest }) => rest);
  }

  async getMessage(id: string): Promise<MessageDetail> {
    const m = this.messages.find((x) => x.id === id);
    if (!m) throw new Error("演示数据中没有这封邮件。");
    return { ...m };
  }

  async getRawSource(id: string): Promise<string | null> {
    const m = this.messages.find((x) => x.id === id);
    return m ? `${m.raw}\n` : null;
  }

  async setSeen(id: string, seen: boolean): Promise<void> {
    const m = this.messages.find((x) => x.id === id);
    if (m) m.seen = seen;
  }

  async deleteMessage(id: string): Promise<void> {
    this.messages = this.messages.filter((x) => x.id !== id);
  }
}
