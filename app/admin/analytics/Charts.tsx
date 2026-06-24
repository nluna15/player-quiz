import type { DailyTimeSeriesRow } from "@/lib/analytics-store";
import { HINT_KEYS, type HintKey } from "@/lib/analytics-store";

// ── Theme colours (mirrors the tokens in app/globals.css) ──────────────────
const INK = "#1b1813";
const MUTED = "#8a7f6a";
const ACTIVE = "#3f74ff";
const CORRECT = "#1fb84f";
const WRONG = "#fb5436";
const HINT = "#ffd23f";

// Shared SVG geometry. Charts scale to their container via viewBox.
const W = 760;
const H = 240;
const M = { top: 16, right: 18, bottom: 38, left: 44 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** Round a max value up to a clean axis bound (1·2·5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const norm = value / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}

/** "2026-06-23" → "Jun 23". */
function shortDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Show at most ~8 x-axis labels so they never overlap. */
function labelStride(n: number): number {
  return Math.max(1, Math.ceil(n / 8));
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[18px] border-[2.5px] border-ink bg-surface p-5 shadow-[4px_4px_0_#1b1813]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[16px] font-bold text-ink">{title}</h3>
        {subtitle && (
          <span className="font-extrabold text-[10px] uppercase tracking-[1px] text-muted">
            {subtitle}
          </span>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[160px] items-center justify-center font-bold text-sm text-muted">
      No data in this window yet.
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-extrabold text-[10px] uppercase tracking-[0.5px] text-muted">
      <span
        className="inline-block h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-ink"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/** Horizontal gridlines + left value labels shared by the bar and line charts. */
function YGrid({ max, format }: { max: number; format: (v: number) => string }) {
  const lines = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g>
      {lines.map((t) => {
        const y = M.top + PLOT_H - t * PLOT_H;
        return (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y}
              y2={y}
              stroke={INK}
              strokeOpacity={t === 0 ? 0.5 : 0.12}
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={y + 3.5}
              textAnchor="end"
              fontSize={10}
              fontWeight={800}
              fill={MUTED}
            >
              {format(t * max)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ days }: { days: string[] }) {
  const n = days.length;
  const band = PLOT_W / n;
  const stride = labelStride(n);
  return (
    <g>
      {days.map((day, i) =>
        i % stride === 0 ? (
          <text
            key={day}
            x={M.left + band * i + band / 2}
            y={H - M.bottom + 16}
            textAnchor="middle"
            fontSize={10}
            fontWeight={800}
            fill={MUTED}
          >
            {shortDate(day)}
          </text>
        ) : null
      )}
    </g>
  );
}

// ── 1. Unique users by day (bar chart) ─────────────────────────────────────
export function UniqueUsersChart({ data }: { data: DailyTimeSeriesRow[] }) {
  return (
    <ChartCard title="Unique users by day" subtitle="distinct user IDs">
      {data.length === 0 ? (
        <EmptyState />
      ) : (
        (() => {
          const max = niceMax(Math.max(...data.map((d) => d.uniqueUsers)));
          const band = PLOT_W / data.length;
          const barW = Math.min(band * 0.62, 48);
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
              <YGrid max={max} format={(v) => String(Math.round(v))} />
              {data.map((d, i) => {
                const h = (d.uniqueUsers / max) * PLOT_H;
                const x = M.left + band * i + (band - barW) / 2;
                const y = M.top + PLOT_H - h;
                return (
                  <rect
                    key={d.day}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(h, d.uniqueUsers > 0 ? 2 : 0)}
                    rx={3}
                    fill={ACTIVE}
                    stroke={INK}
                    strokeWidth={1.5}
                  >
                    <title>{`${shortDate(d.day)}: ${d.uniqueUsers} users`}</title>
                  </rect>
                );
              })}
              <XLabels days={data.map((d) => d.day)} />
            </svg>
          );
        })()
      )}
    </ChartCard>
  );
}

// ── 2. Quiz completion rate by day (line chart) ────────────────────────────
export function CompletionRateChart({ data }: { data: DailyTimeSeriesRow[] }) {
  const points = data
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.completionRate != null);

  return (
    <ChartCard title="Completion rate by day" subtitle="completed ÷ started">
      {points.length === 0 ? (
        <EmptyState />
      ) : (
        (() => {
          const band = PLOT_W / data.length;
          const xy = (i: number, rate: number) => ({
            x: M.left + band * i + band / 2,
            y: M.top + PLOT_H - rate * PLOT_H,
          });
          const path = points
            .map(({ d, i }, k) => {
              const p = xy(i, d.completionRate as number);
              return `${k === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
            })
            .join(" ");
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
              <YGrid max={1} format={(v) => `${Math.round(v * 100)}%`} />
              <path d={path} fill="none" stroke={CORRECT} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
              {points.map(({ d, i }) => {
                const p = xy(i, d.completionRate as number);
                return (
                  <circle key={d.day} cx={p.x} cy={p.y} r={4.5} fill={CORRECT} stroke={INK} strokeWidth={1.5}>
                    <title>{`${shortDate(d.day)}: ${Math.round((d.completionRate as number) * 100)}% (${d.completed}/${d.started})`}</title>
                  </circle>
                );
              })}
              <XLabels days={data.map((d) => d.day)} />
            </svg>
          );
        })()
      )}
    </ChartCard>
  );
}

// ── 3. Hints used in aggregate, segmented by hint type (horizontal bars) ────
const HINT_LABELS: Record<HintKey, string> = {
  continent: "Continent",
  fact: "Clue",
  club: "Club",
  name: "Name",
};
const HINT_COLORS: Record<HintKey, string> = {
  continent: ACTIVE,
  fact: HINT,
  club: CORRECT,
  name: WRONG,
};

export function HintsByTypeChart({ hintsByKey }: { hintsByKey: Record<HintKey, number> }) {
  const total = HINT_KEYS.reduce((sum, k) => sum + hintsByKey[k], 0);
  const max = niceMax(Math.max(...HINT_KEYS.map((k) => hintsByKey[k]), 1));
  const rowH = 40;
  const labelW = 90;
  const barMax = 600;

  return (
    <ChartCard title="Hints used by type" subtitle={`${total} total`}>
      {total === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-2.5">
          {HINT_KEYS.map((k) => {
            const value = hintsByKey[k];
            const w = (value / max) * barMax;
            const share = total > 0 ? Math.round((value / total) * 100) : 0;
            return (
              <div key={k} className="flex items-center gap-3" style={{ height: rowH }}>
                <span
                  className="shrink-0 font-extrabold text-[11px] uppercase tracking-[1px] text-ink"
                  style={{ width: labelW }}
                >
                  {HINT_LABELS[k]}
                </span>
                <div className="flex-1">
                  <div
                    className="flex items-center rounded-[8px] border-[2px] border-ink px-2.5"
                    style={{
                      width: `${Math.max((w / barMax) * 100, value > 0 ? 6 : 0)}%`,
                      minWidth: value > 0 ? 44 : 0,
                      height: 28,
                      backgroundColor: HINT_COLORS[k],
                    }}
                  >
                    <span className="font-display text-[13px] font-bold text-ink tabular-nums">
                      {value}
                    </span>
                  </div>
                </div>
                <span className="w-10 shrink-0 text-right font-bold text-[11px] text-muted tabular-nums">
                  {share}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

// ── 4. Shares by button by day (stacked bars) ──────────────────────────────
const SHARE_SERIES = [
  { key: "shareResult", label: "Native", color: ACTIVE },
  { key: "shareX", label: "X", color: INK },
  { key: "shareWhatsapp", label: "WhatsApp", color: CORRECT },
] as const;

export function SharesByButtonChart({ data }: { data: DailyTimeSeriesRow[] }) {
  const totalsByDay = data.map((d) => d.shareResult + d.shareX + d.shareWhatsapp);
  const hasData = totalsByDay.some((t) => t > 0);

  return (
    <ChartCard
      title="Shares by button by day"
      subtitle={
        <span className="flex gap-2.5">
          {SHARE_SERIES.map((s) => (
            <LegendDot key={s.key} color={s.color} label={s.label} />
          ))}
        </span>
      }
    >
      {!hasData ? (
        <EmptyState />
      ) : (
        (() => {
          const max = niceMax(Math.max(...totalsByDay));
          const band = PLOT_W / data.length;
          const barW = Math.min(band * 0.62, 48);
          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
              <YGrid max={max} format={(v) => String(Math.round(v))} />
              {data.map((d, i) => {
                const x = M.left + band * i + (band - barW) / 2;
                let yCursor = M.top + PLOT_H;
                const total = d.shareResult + d.shareX + d.shareWhatsapp;
                return (
                  <g key={d.day}>
                    {SHARE_SERIES.map((s) => {
                      const value = d[s.key];
                      if (value <= 0) return null;
                      const h = (value / max) * PLOT_H;
                      yCursor -= h;
                      return (
                        <rect
                          key={s.key}
                          x={x}
                          y={yCursor}
                          width={barW}
                          height={h}
                          fill={s.color}
                          stroke={INK}
                          strokeWidth={1.5}
                        >
                          <title>{`${shortDate(d.day)} · ${s.label}: ${value}`}</title>
                        </rect>
                      );
                    })}
                    {total > 0 && (
                      <text
                        x={x + barW / 2}
                        y={yCursor - 5}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={800}
                        fill={INK}
                      >
                        {total}
                      </text>
                    )}
                  </g>
                );
              })}
              <XLabels days={data.map((d) => d.day)} />
            </svg>
          );
        })()
      )}
    </ChartCard>
  );
}
