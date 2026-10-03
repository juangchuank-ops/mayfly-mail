const dtTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });
const dtDate = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
const dtFull = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** 列表里的时间：今天显示时刻，今年显示日期，更早带年份。 */
export function formatListTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) return dtTime.format(d);
  if (d.getFullYear() === now.getFullYear()) return dtDate.format(d);
  return `${d.getFullYear()}/${dtDate.format(d)}`;
}

/** 阅读区的完整时间。 */
export function formatFullTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dtFull.format(d);
}

export function formatClock(d: Date): string {
  return dtTime.format(d);
}
