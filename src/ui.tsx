import { Hexagon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Adds `.in` to every `.reveal` element as it scrolls into view, including ones rendered later.
// ponytail: rescans the document on each DOM mutation; fine at this page size, scope the observer to a container if it grows large.
export function useScrollReveal() {
  useEffect(() => {
    if (reducedMotion()) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }),
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    const scan = () => document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
    scan();
    const mutations = new MutationObserver(scan);
    mutations.observe(document.body, { childList: true, subtree: true });
    document.documentElement.classList.add("reveal-ready");
    return () => {
      io.disconnect();
      mutations.disconnect();
      document.documentElement.classList.remove("reveal-ready");
    };
  }, []);
}

// Counts a number up the first time it scrolls into view. Values like "24/7" or "Medium" render as-is.
// Text is written through the ref, not state, so a 60fps animation never re-renders React.
export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const played = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current!;
    const match = value.match(/^(\$?)([\d,]*\.?\d+)([%+K]?)$/);
    if (played.current || !match || reducedMotion()) {
      el.textContent = value;
      return;
    }
    const [, prefix, digits, suffix] = match;
    const target = Number(digits.replace(/,/g, ""));
    const decimals = digits.split(".")[1]?.length ?? 0;
    const format = (n: number) =>
      prefix + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: digits.includes(",") }) + suffix;
    el.textContent = format(0);

    let frame = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      played.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / 1300, 1);
        el.textContent = t < 1 ? format(target * (1 - (1 - t) ** 3)) : value;
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return <span ref={ref} />;
}

export function Aurora() {
  return (
    <div aria-hidden className="aurora">
      <span />
      <span />
      <span />
      <div className="grid-floor" />
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  function copy() {
    navigator.clipboard.writeText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
    window.setTimeout(() => setState("idle"), 1500);
  }
  return (
    <button type="button" onClick={copy} className="rounded-full bg-brand/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brand transition hover:bg-brand/20">
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

export function LogoMark() {
  return (
    <span className="logo-mark grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-red-600 via-rose-600 to-orange-500 shadow-lg shadow-red-600/30">
      <Hexagon className="h-5 w-5 rotate-12 text-white" strokeWidth={2} />
    </span>
  );
}

export function TooltipButton({
  children,
  tooltip,
  placement = "bottom",
  align = "center",
  className = "",
  onClick,
  ariaLabel,
  disabled,
}: {
  children: ReactNode;
  tooltip: string;
  placement?: "top" | "bottom";
  align?: "center" | "end";
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const placementClass =
    placement === "top"
      ? "bottom-full mb-2 group-hover:-translate-y-1"
      : "top-full mt-2 group-hover:translate-y-1";
  const alignClass = align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} disabled={disabled} className={`group relative disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
      {children}
      <span className={`pointer-events-none absolute z-[100] w-max max-w-[260px] rounded-lg bg-black px-3 py-2 text-center text-[11px] font-medium normal-case leading-4 tracking-normal text-white opacity-0 shadow-xl shadow-slate-900/20 transition duration-200 group-hover:opacity-100 ${placementClass} ${alignClass}`}>
        {tooltip}
      </span>
    </button>
  );
}

export function StatusChip({ status }: { status: string }) {
  const key = status.toUpperCase();
  const classes =
    key === "APPROVED" || key === "PASSED" || key === "ALLOWED" || key === "ALLOW" || key === "COMPLETED" || key === "RUN COMPLETED" || key === "CONNECTED"
      ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
      : key === "BLOCKED" || key === "REJECTED" || key === "BLOCK" || key === "FAILED" || key === "RUN FAILED"
        ? "bg-rose-500/10 text-rose-400 ring-rose-500/20"
        : key === "POLICY CHECK" || key === "RUNNING"
          ? "bg-red-500/10 text-red-400 ring-red-500/25"
          : key === "RUN STARTED" || key === "ESCALATED"
            ? "bg-violet-500/10 text-violet-300 ring-violet-500/20"
            : "bg-amber-500/10 text-amber-400 ring-amber-500/25";
  return <span className={`status-chip ${classes}`}>{status}</span>;
}

export function Sparkline({ tone, className = "h-12 w-24" }: { tone: "blue" | "amber" | "red"; className?: string }) {
  const stroke = tone === "red" ? "#f43f5e" : tone === "amber" ? "#f59e0b" : "#ff2d20";
  return (
    <svg viewBox="0 0 96 48" preserveAspectRatio="none" aria-hidden className={`overflow-visible ${className}`}>
      <path className="spark-fill" d="M2 47 L2 41 C 12 39, 18 31, 27 33 S 43 13, 51 20 S 62 29, 70 15 S 82 27, 94 8 L94 47 Z" fill={stroke} opacity=".12" />
      <path
        className="spark-line"
        pathLength={1}
        d="M2 41 C 12 39, 18 31, 27 33 S 43 13, 51 20 S 62 29, 70 15 S 82 27, 94 8"
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function SegBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="seg-track h-2">
      <div className={`seg-fill h-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

// Conic ring that fills from 0 on mount (animated through the registered --p property).
export function Ring({ value, size, thickness, from, to, children }: { value: number; size: number; thickness: number; from: string; to: string; children: ReactNode }) {
  const style = { "--value": value, "--ring-from": from, "--ring-to": to, "--thickness": `${thickness}px`, width: size, height: size } as CSSProperties;
  return (
    <div className="gauge" style={style}>
      <div className="gauge-inner">{children}</div>
    </div>
  );
}

export function GaugeCircle({ value }: { value: number }) {
  return (
    <Ring value={value} size={56} thickness={6} from="#fbbf24" to="#f97316">
      <span className="font-mono text-sm font-semibold">{value}</span>
    </Ring>
  );
}

export function dotColor(tone: string) {
  if (tone === "green") return "bg-emerald-500";
  if (tone === "amber") return "bg-amber-400";
  if (tone === "red") return "bg-danger";
  if (tone === "slate") return "bg-white/20";
  return "bg-brand";
}

export function statusTone(status: string) {
  if (status === "allowed" || status === "approved") return "green";
  if (status === "blocked" || status === "rejected") return "red";
  return "amber";
}
