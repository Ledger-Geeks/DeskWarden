import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  FileText,
  Gauge,
  Hexagon,
  Lock,
  ArrowRightLeft,
  FilePen,
  FolderOpen,
  Trash2,
  RefreshCw,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { appUrl, decide, navigate, RANGES, type LiveData, type LiveRun, type RangeLabel } from "./api";
import {
  capitalize,
  clock,
  CountUp,
  dotColor,
  downloadJson,
  GaugeCircle,
  LogoMark,
  Ring,
  SegBar,
  Sparkline,
  StatusChip,
  statusTone,
  timeAgo,
  TooltipButton,
} from "./ui";

type DashboardView = "overview" | "agents" | "metrics" | "policies" | "audit" | "approvals" | "risk";
type DecisionStatus = "Waiting" | "Approved" | "Rejected" | "Escalated";
type Open = (() => void) | undefined;

const approvals = [
  ["write_file", "DeskAgent", "Pending", "2m ago"],
  ["move_path", "CleanupBot", "Pending", "5m ago"],
  ["delete_path", "DeskAgent", "Pending", "8m ago"],
  ["read_file", "ResearchAgent", "Blocked", "12m ago"],
];

const timeline = [
  ["10:24:31", "Run started", "Agent: DeskAgent", "slate"],
  ["10:24:35", "Mission received", "Delete the old installers in Downloads", "slate"],
  ["10:24:37", "Tool Call: list_folder", "Allowed: Downloads", "green"],
  ["10:24:38", "Tool Call: delete_path", "Blocked: Downloads is read-only", "red"],
  ["10:24:41", "Tool Call: write_file", "Waiting for you: notes/cleanup.txt", "amber"],
  ["10:24:45", "Run paused", "Awaiting your decision", "slate"],
];

const auditRows = [
  ["10:24:41", "PENDING", "Tool Call: write_file", "by DeskAgent"],
  ["10:24:38", "BLOCKED", "Tool Call: delete_path", "by Policy"],
  ["10:24:37", "ALLOWED", "Tool Call: list_folder", "by Policy"],
  ["10:24:31", "RUN STARTED", "DeskAgent", "by You"],
];

const scorecards = [
  ["Groundedness", 82, "bg-brand"],
  ["Relevance", 79, "bg-violet-400"],
  ["Safety", 91, "bg-emerald-400"],
  ["Completeness", 74, "bg-amber-300"],
] as const;

const operationalMetrics = [
  ["Successful runs", 94, "bg-emerald-400"],
  ["Approval latency", 64, "bg-brand"],
  ["Replay recovery", 71, "bg-violet-400"],
  ["Cost efficiency", 82, "bg-amber-300"],
] as const;

const tools = [
  ["list_folder", "File system", "Approved"],
  ["read_file", "File system", "Approved"],
  ["write_file", "File system", "Approved"],
  ["delete_path", "~/Downloads", "Blocked"],
];

const fleet = [
  ["DeskAgent", "312 runs", "98.4% success", "APPROVED"],
  ["CleanupBot", "184 runs", "12 pending", "PENDING"],
  ["ResearchAgent", "93 runs", "4 blocked", "POLICY CHECK"],
  ["BackupAgent", "28 runs", "high risk", "PENDING"],
];

const staticEvidence = {
  run_id: "run_9f3ab7e0",
  actor: "DeskAgent",
  policy_result: "passed",
  tool_call: "list_folder",
  approval: "you / approved",
  export: "immutable JSONL + signed hash",
};

const fileIcons: Record<string, typeof Shield> = { list_folder: FolderOpen, read_file: FileText, write_file: FilePen, move_path: ArrowRightLeft, delete_path: Trash2 };

const actionLabel = { allow: "Allow", approve: "Approval", block: "Block" } as const;

const sidebarItems: Array<{ icon: typeof Shield; label: string; view: DashboardView }> = [
  { icon: Shield, label: "Overview", view: "overview" },
  { icon: Hexagon, label: "Agent runs", view: "agents" },
  { icon: BarChart3, label: "Metrics", view: "metrics" },
  { icon: ShieldCheck, label: "Policies", view: "policies" },
  { icon: FileText, label: "Audit logs", view: "audit" },
  { icon: Users, label: "Approvals", view: "approvals" },
  { icon: Gauge, label: "Risk score", view: "risk" },
];

const viewTitles: Record<DashboardView, string> = {
  overview: "Overview",
  agents: "Agent Runs",
  metrics: "Operational Metrics",
  policies: "Policy Controls",
  audit: "Audit Logs",
  approvals: "Approval Center",
  risk: "Risk Command",
};

const total = (stats: Record<string, number>) => Object.values(stats).reduce((sum, n) => sum + n, 0);

export function DashboardPreview({
  live,
  reload,
  range,
  onRangeChange,
}: {
  live: LiveData | null;
  reload: () => void;
  range: RangeLabel;
  onRangeChange: (range: RangeLabel) => void;
}) {
  const [activeView, setActiveView] = useState<DashboardView>("overview");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState("Just now");
  const [notice, setNotice] = useState("");
  const [decisionStatus, setDecisionStatus] = useState<DecisionStatus>("Waiting");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function handleRefresh() {
    const currentTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setRefreshedAt(currentTime);
    setNotice(`Dashboard refreshed at ${currentTime}`);
    reload();
  }

  async function handleDecision(status: DecisionStatus) {
    if (live) {
      const call = live.queue[0];
      if (!call) return setNotice("No pending tool call to decide");
      try {
        await decide(call.id, status.toLowerCase());
        setNotice(`${call.tool} marked as ${status.toLowerCase()}`);
      } catch (error) {
        setNotice((error as Error).message);
      }
      reload();
      return;
    }
    setDecisionStatus(status);
    setNotice(`Decision marked as ${status.toLowerCase()}`);
  }

  return (
    <div id="demo" className="frame console-shell scroll-mt-24">
      {notice ? (
        <div role="status" className="toast-in absolute right-5 top-5 z-30 rounded-xl bg-black px-4 py-3 text-xs font-medium text-white shadow-xl shadow-red-600/20">
          {notice}
        </div>
      ) : null}
      <div className="grid grid-cols-[56px_1fr] md:grid-cols-[64px_1fr]">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <div className="min-w-0 border-l border-brand/10 p-4 md:p-6">
          <DashboardTopBar
            title={viewTitles[activeView]}
            live={live !== null}
            timeRange={range}
            rangeOpen={rangeOpen}
            refreshedAt={refreshedAt}
            onToggleRange={() => setRangeOpen((value) => !value)}
            onRangeSelect={(next) => {
              onRangeChange(next);
              setRangeOpen(false);
              setNotice(live ? `Showing ${next.toLowerCase()}` : `Time range changed to ${next}`);
            }}
            onRefresh={handleRefresh}
          />
          {/* Keyed so each view switch replays the enter animation. */}
          <div key={activeView} className="view-enter">
            {activeView === "overview" ? <MetricCards live={live} range={range} /> : null}
            <DashboardContent
              activeView={activeView}
              decisionStatus={decisionStatus}
              onDecision={handleDecision}
              live={live}
              go={setActiveView}
              notify={setNotice}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCards({ live, range }: { live: LiveData | null; range: RangeLabel }) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {live ? (
        <>
          <MetricCard title="Tool Calls" value={String(total(live.stats))} note={range} />
          <MetricCard title="Approval Queue" value={String(live.pending)} note="Pending Approval" tone="amber" />
          <MetricCard title="Blocked" value={String(live.stats.blocked ?? 0)} note="Denied by policy" tone="red" />
          <MetricCard title="Rejected" value={String(live.stats.rejected ?? 0)} note="Denied by operators" tone="red" />
        </>
      ) : (
        <>
          <MetricCard title="Agent Runs" value="1,284" note="+18.4% vs prev 7 days">
            <Sparkline tone="blue" />
          </MetricCard>
          <MetricCard title="Approval Queue" value="23" note="Pending Approval" tone="amber">
            <Sparkline tone="amber" />
          </MetricCard>
          <MetricCard title="Risk Score" value="Medium" note="Risk score 56 / 100" tone="amber">
            <GaugeCircle value={56} />
          </MetricCard>
          <MetricCard title="Incidents" value="7" note="+2 vs prev 7 days" tone="red">
            <Sparkline tone="red" />
          </MetricCard>
        </>
      )}
    </div>
  );
}

function Sidebar({ activeView, onViewChange }: { activeView: DashboardView; onViewChange: (view: DashboardView) => void }) {
  return (
    <aside className="flex flex-col items-center justify-between gap-6 py-5">
      <div className="flex flex-col items-center gap-5">
        <LogoMark />
        <div className="flex flex-col gap-2">
          {sidebarItems.map(({ icon: Icon, label, view }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              aria-current={activeView === view ? "page" : undefined}
              onClick={() => onViewChange(view)}
              className={`group relative grid h-10 w-10 place-items-center transition ${
                activeView === view
                  ? "rounded-full bg-brand/15 text-brand ring-1 ring-inset ring-brand/40 shadow-[0_0_20px_rgba(255,45,32,0.35)]"
                  : "text-ink/50 hover:bg-red-500/10 hover:text-brand"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span className="pointer-events-none absolute left-12 top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-lg bg-black px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition group-hover:translate-x-1 group-hover:opacity-100">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <img
        src={`${import.meta.env.BASE_URL}images/autor-logo.png`}
        alt="Daniel Danek"
        className="h-9 w-9 object-cover ring-1 ring-brand/35"
      />
    </aside>
  );
}

function DashboardTopBar({
  title,
  live,
  timeRange,
  rangeOpen,
  refreshedAt,
  onToggleRange,
  onRangeSelect,
  onRefresh,
}: {
  title: string;
  live: boolean;
  timeRange: RangeLabel;
  rangeOpen: boolean;
  refreshedAt: string;
  onToggleRange: () => void;
  onRangeSelect: (range: RangeLabel) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
          </span>
        ) : (
          <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-ink/60">Demo data</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <TooltipButton
            tooltip={live ? "Filter tool calls, audit events and stats by time window." : "Time windows filter live data when the backend is running."}
            onClick={onToggleRange}
            className="inline-flex items-center gap-2 border border-brand/15 bg-raised px-3 py-2 font-mono text-[11px] text-ink/75 transition hover:border-brand/45 hover:text-brand"
            ariaLabel="Select time range"
          >
            <CalendarDays className="h-4 w-4" /> {timeRange} <ChevronDown className="h-3 w-3" />
          </TooltipButton>
          {rangeOpen ? (
            <div className="absolute right-0 top-11 z-40 w-44 rounded-xl border border-white/10 bg-card p-1.5 shadow-xl shadow-red-600/10">
              {(Object.keys(RANGES) as RangeLabel[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => onRangeSelect(range)}
                  className={`block w-full px-3 py-2 text-left font-mono text-[11px] transition ${
                    range === timeRange ? "bg-brand/15 text-brand" : "text-ink/70 hover:bg-raised hover:text-ink"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <TooltipButton
          tooltip={`${live ? "Refresh live data" : "Refresh simulated dashboard data"}. Last refreshed: ${refreshedAt}.`}
          onClick={onRefresh}
          align="end"
          className="grid h-9 w-9 place-items-center border border-brand/15 bg-raised text-ink/75 transition hover:border-brand/45 hover:text-brand"
          ariaLabel="Refresh dashboard"
        >
          <RefreshCw className="h-4 w-4" />
        </TooltipButton>
      </div>
    </div>
  );
}

function DashboardContent({
  activeView,
  decisionStatus,
  onDecision,
  live,
  go,
  notify,
}: {
  activeView: DashboardView;
  decisionStatus: DecisionStatus;
  onDecision: (status: DecisionStatus) => void;
  live: LiveData | null;
  go: (view: DashboardView) => void;
  notify: (message: string) => void;
}) {
  // A panel links to the view that expands it, unless that view is already open.
  const link = (target: DashboardView): Open => (target === activeView ? undefined : () => go(target));
  const stats = live?.stats ?? {};

  if (activeView === "overview") {
    return (
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-12">
        <ApprovalQueue live={live} onOpen={link("approvals")} className="xl:col-span-5" />
        <RunTimeline live={live} onOpen={link("agents")} className="xl:col-span-4" />
        <RiskPanel live={live} onOpen={link("risk")} className="xl:col-span-3" />
        <AuditLogs live={live} onOpen={link("audit")} className="xl:col-span-5" />
        <EvaluationScorecard live={live} onOpen={link("metrics")} className="xl:col-span-4" />
        <SecureToolAccess live={live} onOpen={link("policies")} className="xl:col-span-3" />
      </div>
    );
  }

  if (activeView === "agents") {
    return (
      <ViewShell
        title="Live agent execution control"
        copy="Track active agents, tool usage, policy gates and run completion across the fleet."
        stats={
          live
            ? [["Active agents", String(live.agents.length)], ["Tool calls", String(total(stats))], ["Denied", String((stats.blocked ?? 0) + (stats.rejected ?? 0))]]
            : [["Active agents", "42"], ["Runs today", "1,284"], ["Tool calls", "8,931"]]
        }
      >
        <RunTimeline live={live} />
        <AgentFleetPanel live={live} />
      </ViewShell>
    );
  }

  if (activeView === "metrics") {
    return (
      <ViewShell
        title="Reliability, quality and cost signals"
        copy="Measure agent workflow health across evaluations, latency, replay outcomes and operating cost."
        stats={[["Eval score", "0.82"], ["p95 latency", "2.4s"], ["Cost/run", "$0.018"]]}
      >
        <EvaluationScorecard live={live} />
        <MetricsPanel live={live} notify={notify} />
      </ViewShell>
    );
  }

  if (activeView === "policies") {
    return (
      <ViewShell
        title="Policy enforcement surface"
        copy="Review enforced controls for tools, data scopes, approval gates and blocked actions."
        stats={
          live
            ? [["Policies", String(live.policies.length + 1)], ["Blocked", String(stats.blocked ?? 0)], ["Default", "Deny"]]
            : [["Policies", "18"], ["Blocked", "7"], ["Coverage", "100%"]]
        }
      >
        <PolicyPanel live={live} />
        <SecureToolAccess live={live} />
      </ViewShell>
    );
  }

  if (activeView === "audit") {
    return (
      <ViewShell
        title="Immutable audit trail"
        copy="Inspect every approval, policy check, tool call and operator decision in one place."
        stats={
          live
            ? [["Audit events", String(live.auditEvents)], ["Storage", "SQLite"], ["Exports", "JSON"]]
            : [["Audit events", "12.4K"], ["Retention", "365d"], ["Exports", "JSON"]]
        }
      >
        <AuditLogs live={live} />
        <AuditDetailPanel live={live} notify={notify} />
      </ViewShell>
    );
  }

  if (activeView === "approvals") {
    return (
      <ViewShell
        title="Human-in-the-loop approval queue"
        copy="Prioritize risky requests and approve, reject or escalate agent tool calls."
        stats={
          live
            ? [["Pending", String(live.pending)], ["Approved", String(stats.approved ?? 0)], ["Rejected", String(stats.rejected ?? 0)]]
            : [["Pending", "23"], ["SLA breach", "2"], ["Approved", "96%"]]
        }
      >
        <ApprovalQueue live={live} />
        <ApprovalDecisionPanel decisionStatus={decisionStatus} onDecision={onDecision} live={live} />
      </ViewShell>
    );
  }

  return (
    <ViewShell
      title="Risk command center"
      copy="Understand why a run is risky before it touches sensitive tools or data."
      stats={[["Risk score", "56"], ["Critical tools", "4"], ["Incidents", "7"]]}
    >
      <RiskPanel live={live} />
      <RiskFactorsPanel live={live} />
    </ViewShell>
  );
}

function ViewShell({ title, copy, stats, children }: { title: string; copy: string; stats: Array<[string, string]>; children: ReactNode }) {
  return (
    <div className="mt-5 space-y-3">
      <div className="frame fill-glow p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60">{copy}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/[0.06] bg-card/80 px-4 py-3 shadow-sm">
                <div className="text-gradient font-mono text-xl font-bold">
                  <CountUp value={value} />
                </div>
                <div className="mt-1 text-[11px] font-medium text-ink/55">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.25fr_1fr]">{children}</div>
    </div>
  );
}

function MetricCard({ title, value, note, tone = "blue", children }: { title: string; value: string; note: string; tone?: "blue" | "amber" | "red"; children?: ReactNode }) {
  const noteColor = tone === "red" ? "text-danger" : tone === "amber" ? "text-amber-400" : "text-emerald-400";
  return (
    <div className="frame frame-hover min-w-0 p-4">
      <div className="text-xs font-medium text-ink/55">{title}</div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-[1.8rem] font-bold leading-none tracking-tight text-ink">
            <CountUp value={value} />
          </div>
          <div className={`mt-2 text-xs font-medium ${noteColor}`}>{note}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Panel({
  title,
  action,
  actionTip,
  onAction,
  sample,
  children,
  className = "",
  id,
}: {
  title: string;
  action?: string;
  actionTip?: string;
  onAction?: () => void;
  sample?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`frame frame-hover min-w-0 p-4 hover:z-40 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="h-4 w-1 rounded-full bg-gradient-to-b from-red-600 to-orange-500" />
          {title}
          {sample ? (
            <span title="Not backed by live data yet" className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium text-ink/55">
              Sample
            </span>
          ) : null}
        </h3>
        {action && onAction ? (
          <TooltipButton
            tooltip={actionTip ?? `${action} ${title.toLowerCase()} details.`}
            placement="top"
            align="end"
            onClick={onAction}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand transition hover:text-violet-300"
          >
            {action} <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
          </TooltipButton>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-ink/15 px-3 py-6 text-center font-mono text-[11px] leading-5 text-ink/55">{children}</div>;
}

function ToolGlyph({ tool, blocked }: { tool: string; blocked: boolean }) {
  const Icon = blocked ? Lock : (fileIcons[tool] ?? FileText);
  return <Icon className="h-4 w-4" />;
}

function ApprovalQueue({ live, onOpen, className = "" }: { live: LiveData | null; onOpen?: Open; className?: string }) {
  const rows = live ? live.queue.map((call) => [call.tool, call.agent, capitalize(call.status), timeAgo(call.created_at)]) : approvals;
  return (
    <Panel title="Approval Queue" action="View all" actionTip="Open the approval center." onAction={onOpen} className={`scroll-mt-24 ${className}`} id="approval-queue">
      <div className="space-y-2">
        {live && rows.length === 0 ? <EmptyState>No pending tool calls. Approval-gated calls from agents appear here.</EmptyState> : null}
        {rows.map(([tool, agent, status, time], index) => (
          <div key={index} className="grid grid-cols-[30px_1fr_auto] items-center gap-3 rounded-xl border border-white/[0.06] bg-raised px-2.5 py-2">
            <div className={`grid h-[30px] w-[30px] place-items-center rounded-full ring-1 ring-inset ${status === "Blocked" ? "bg-danger/10 text-danger ring-danger/30" : "bg-brand/10 text-brand ring-brand/20"}`}>
              <ToolGlyph tool={tool} blocked={status === "Blocked"} />
            </div>
            <div className="min-w-0">
              <div className="truncate font-mono text-[11.5px] text-ink">{tool}</div>
              <div className="truncate text-[11px] text-ink/55">Agent: {agent}</div>
            </div>
            <div className="text-right">
              <StatusChip status={status} />
              <div className="mt-1 font-mono text-[9.5px] text-ink/55">{time}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function runRows(run: LiveRun) {
  const rows = [
    [clock(run.created_at), "Run started", `${run.agent}: ${run.task}`, "blue"],
    ...run.steps.map((step) => [clock(step.created_at), `Tool Call: ${step.tool}`, capitalize(step.status), statusTone(step.status)]),
  ];
  if (run.status === "running") rows.push(["", "Running", "Waiting on the model or an approval", "slate"]);
  else rows.push(["", run.status === "completed" ? "Run completed" : "Run failed", run.output ?? "", run.status === "completed" ? "green" : "red"]);
  return rows;
}

function RunTimeline({ live, onOpen, className = "" }: { live: LiveData | null; onOpen?: Open; className?: string }) {
  const rows = live ? (live.run ? runRows(live.run) : []) : timeline;
  return (
    <Panel title="Run Timeline" action="View run" actionTip="Open agent runs." onAction={onOpen} className={className}>
      {live && rows.length === 0 ? (
        <EmptyState>
          No agent runs yet. Start one in the <a className="text-brand underline-offset-2 hover:underline" href={appUrl("/app/playground")}>playground</a>.
        </EmptyState>
      ) : null}
      <ol className="space-y-3">
        {rows.map(([time, title, detail, tone], index) => (
          <li key={index} className="grid grid-cols-[58px_12px_1fr] gap-3">
            <div className="pt-0.5 font-mono text-[10.5px] text-ink/55">{time}</div>
            <div className="flex justify-center pt-1.5">
              <span className={`h-2 w-2 rotate-45 ${dotColor(tone)}`} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">{title}</div>
              <div className="mt-0.5 line-clamp-2 text-[11px] text-ink/55">{detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function RiskPanel({ live, onOpen, className = "" }: { live: LiveData | null; onOpen?: Open; className?: string }) {
  return (
    <Panel title="Risk Score" sample={!!live} className={`scroll-mt-24 ${className}`} id="risk-card">
      <div className="flex items-end gap-2">
        <div className="font-mono text-4xl font-semibold text-amber-400">56</div>
        <div className="pb-1 font-mono text-sm text-ink/55">/ 100</div>
      </div>
      <div className="relative mt-5">
        <div className="seg-fill h-2 bg-gradient-to-r from-emerald-400 via-amber-300 to-danger" />
        <span className="absolute -top-1.5 h-5 w-1.5 -translate-x-1/2 rounded-full bg-black ring-4 ring-brand/20" style={{ left: "56%" }} />
        <div className="mt-2 flex justify-between font-mono text-[9.5px] text-ink/55">
          <span>Low (0)</span>
          <span>Critical (100)</span>
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-2 text-xs font-semibold text-ink/55">Top Risk Factors</div>
        {["Tool: delete_path +20", "Reads in ~/.ssh +15", "Unreviewed writes +10"].map((item) => (
          <div key={item} className="mb-1.5 flex justify-between gap-2 text-xs text-ink/75">
            <span>{item.replace(/ \+\d+$/, "")}</span>
            <span className="font-mono text-danger">{item.match(/\+\d+$/)?.[0]}</span>
          </div>
        ))}
      </div>
      {onOpen ? (
        <TooltipButton
          tooltip="Open the detailed risk explanation behind this score."
          onClick={onOpen}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand transition hover:text-violet-300"
        >
          View risk assessment <ArrowRight className="h-3 w-3" />
        </TooltipButton>
      ) : null}
    </Panel>
  );
}

function AuditLogs({ live, onOpen, className = "" }: { live: LiveData | null; onOpen?: Open; className?: string }) {
  const rows = live
    ? live.audit.map((row) => [clock(row.at), row.event, row.tool ? `Tool Call: ${row.tool}` : row.detail ?? "", `by ${row.actor}`])
    : auditRows;
  return (
    <Panel title="Audit Logs" action="View all" actionTip="Open the audit trail." onAction={onOpen} className={`scroll-mt-24 ${className}`} id="audit-logs">
      <div className="space-y-2.5">
        {live && rows.length === 0 ? <EmptyState>No audit events in this time range.</EmptyState> : null}
        {rows.map(([time, status, label, actor], index) => (
          <div key={index} className="grid grid-cols-[58px_104px_minmax(0,1fr)] items-center gap-3 text-[11px] sm:grid-cols-[58px_104px_minmax(0,1fr)_auto]">
            <span className="font-mono text-ink/55">{time}</span>
            <StatusChip status={status} />
            <span className="truncate text-ink/75">{label}</span>
            <span className="hidden max-w-[160px] truncate font-mono text-[10px] text-ink/55 sm:block">{actor}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EvaluationScorecard({ live, onOpen, className = "" }: { live: LiveData | null; onOpen?: Open; className?: string }) {
  return (
    <Panel title="Evaluation Scorecards" action="View all" actionTip="Open operational metrics." onAction={onOpen} sample={!!live} className={`scroll-mt-24 ${className}`} id="scorecards">
      <div className="grid grid-cols-[104px_1fr] items-center gap-5">
        <Ring value={82} size={104} thickness={10} from="#ff2d20" to="#f97316">
          <div className="text-center">
            <div className="font-mono text-2xl font-bold">
              <CountUp value="0.82" />
            </div>
            <div className="text-[10px] text-ink/55">Overall Score</div>
            <div className="text-[10px] font-semibold text-emerald-400">Good</div>
          </div>
        </Ring>
        <div className="space-y-3">
          {scorecards.map(([label, value, color]) => (
            <div key={label}>
              <div className="mb-1 flex justify-between text-xs text-ink/75">
                <span>{label}</span>
                <span className="font-mono">{value / 100}</span>
              </div>
              <SegBar value={value} color={color} />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SecureToolAccess({ live, onOpen, className = "" }: { live: LiveData | null; onOpen?: Open; className?: string }) {
  const rows = live
    ? live.policies.map((policy) => [policy.tool, policy.description, policy.action === "block" ? "Blocked" : policy.action === "approve" ? "Approval" : "Allowed"])
    : tools;
  return (
    <Panel title="Secure Tool Access" action="View" actionTip="Open policy controls." onAction={onOpen} className={className}>
      <div className="space-y-3">
        {rows.map(([tool, system, status]) => (
          <div key={tool} className="grid grid-cols-[28px_1fr_auto] items-center gap-3">
            <div className="grid h-7 w-7 place-items-center border border-brand/15 text-ink/70">
              <ToolGlyph tool={tool} blocked={false} />
            </div>
            <div className="min-w-0">
              <div className="truncate font-mono text-[11.5px] text-ink">{tool}</div>
              <div className="truncate text-[11px] text-ink/55">{system}</div>
            </div>
            <StatusChip status={status} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AgentFleetPanel({ live }: { live: LiveData | null }) {
  const rows = live
    ? live.agents.map((agent) => [
        agent.agent,
        `${agent.calls} tool calls`,
        agent.pending ? `${agent.pending} pending` : `${agent.denied} denied`,
        agent.pending ? "PENDING" : agent.denied ? "BLOCKED" : "APPROVED",
      ])
    : fleet;
  return (
    <Panel title="Agent Fleet">
      <div className="space-y-2">
        {live && rows.length === 0 ? <EmptyState>No agents have called tools in this time range.</EmptyState> : null}
        {rows.map(([name, calls, detail, status]) => (
          <div key={name} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-white/[0.06] bg-raised p-3">
            <div>
              <div className="font-mono text-sm font-semibold text-ink">{name}</div>
              <div className="mt-1 text-xs text-ink/55">{calls} - {detail}</div>
            </div>
            <StatusChip status={status} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MetricsPanel({ live, notify }: { live: LiveData | null; notify: (message: string) => void }) {
  function exportMetrics() {
    downloadJson("deskwarden-metrics.json", Object.fromEntries(operationalMetrics.map(([label, value]) => [label, value / 100])));
    notify("Metrics exported as JSON");
  }
  return (
    <Panel title="Operational Metrics" action="Export" actionTip="Download these metrics as JSON." onAction={exportMetrics} sample={!!live}>
      <div className="space-y-4">
        {operationalMetrics.map(([label, value, color]) => (
          <div key={label}>
            <div className="mb-2 flex justify-between text-xs text-ink/75">
              <span>{label}</span>
              <span className="font-mono">{value}%</span>
            </div>
            <SegBar value={value} color={color} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PolicyPanel({ live }: { live: LiveData | null }) {
  const rows = live
    ? [
        ...live.policies.map((policy) => [policy.description, policy.tool, actionLabel[policy.action]]),
        ["Unknown tools are denied", "*", actionLabel.block],
      ]
    : [
        ["Writes need approval", "write_file", "Enabled"],
        ["Downloads is read-only", "~/Downloads", "Enforced"],
        ["SSH keys are off-limits", "~/.ssh", "Enforced"],
        ["Deletes go to the trash", "delete_path", "Enabled"],
      ];
  return (
    <Panel
      title="Policy Rules"
      action="Edit"
      actionTip={live ? "Open the policy editor." : "Create an account to edit your own policies."}
      onAction={() => navigate(live ? "/app/policies" : "/signup")}
    >
      <div className="space-y-2">
        {rows.map(([rule, scope, status]) => (
          <div key={rule} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-raised p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{rule}</div>
              <div className="font-mono text-[11px] text-ink/55">{scope}</div>
            </div>
            <StatusChip status={live ? status : status === "Enforced" ? "POLICY CHECK" : "APPROVED"} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AuditDetailPanel({ live, notify }: { live: LiveData | null; notify: (message: string) => void }) {
  const latest = live?.audit[0];
  const evidence: Record<string, unknown> = live ? (latest ?? { events: "none in this time range" }) : staticEvidence;
  function download() {
    downloadJson("deskwarden-audit.json", live ? live.audit : staticEvidence);
    notify("Audit evidence downloaded");
  }
  return (
    <Panel title={live ? "Latest Audit Event" : "Audit Evidence"} action="Download" actionTip="Download the visible audit events as JSON." onAction={download}>
      <div className="border border-brand/10 bg-raised p-4 font-mono text-xs leading-6 text-ink/70">
        {Object.entries(evidence).map(([key, value]) => (
          <div key={key} className="truncate">
            <span className="text-brand/70">{key}:</span> {String(value ?? "null")}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ApprovalDecisionPanel({
  decisionStatus,
  onDecision,
  live,
}: {
  decisionStatus: DecisionStatus;
  onDecision: (status: DecisionStatus) => void;
  live: LiveData | null;
}) {
  const call = live?.queue[0];
  const idle = live !== null && !call;
  return (
    <Panel title="Decision Console">
      <div className="space-y-3">
        <div className="frame fill-stripes p-4 [--frame-line:rgba(245,158,11,.35)]">
          <div className="font-mono text-sm font-semibold">{live ? (call ? `Tool Call: ${call.tool}` : "Queue is empty") : "Tool Call: delete_path"}</div>
          <div className="mt-2 text-xs leading-5 text-ink/60">
            {live
              ? call ? `${call.agent} is waiting on this call. ${call.reason}.` : "New approval-gated tool calls will appear here."
              : "DeskAgent wants to delete notes/old-drafts. Deletes need your approval by policy, and anything deleted goes to the trash."}
          </div>
          <div className="mt-3 flex items-center justify-between border border-white/10 bg-raised px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink/60">Decision status</span>
            <StatusChip status={live ? capitalize(call?.status ?? "none") : decisionStatus} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TooltipButton
            tooltip="Allow this agent tool call to continue."
            placement="top"
            disabled={idle}
            onClick={() => onDecision("Approved")}
            className="border border-emerald-400/30 bg-emerald-400/10 px-3 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-400 transition hover:bg-emerald-400/20 active:scale-[0.98]"
          >
            Approve
          </TooltipButton>
          <TooltipButton
            tooltip="Block this pending action and record the rejection in audit logs."
            placement="top"
            disabled={idle}
            onClick={() => onDecision("Rejected")}
            className="border border-danger/35 bg-danger/10 px-3 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-danger transition hover:bg-danger/20 active:scale-[0.98]"
          >
            Reject
          </TooltipButton>
          <TooltipButton
            tooltip="Route this request to a senior operator or owner."
            placement="top"
            disabled={idle || call?.status === "escalated"}
            onClick={() => onDecision("Escalated")}
            className="border border-violet-400/30 bg-violet-400/10 px-3 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-300 transition hover:bg-violet-400/20 active:scale-[0.98]"
          >
            Escalate
          </TooltipButton>
        </div>
      </div>
    </Panel>
  );
}

function RiskFactorsPanel({ live }: { live: LiveData | null }) {
  return (
    <Panel title="Risk Breakdown" sample={!!live}>
      <div className="space-y-2">
        {[
          ["Destructive tool", "+20", "delete_path can remove whole folders."],
          ["Sensitive folders nearby", "+15", "The agent root contains ~/.ssh and ~/AppData."],
          ["Unverified output", "+10", "No evaluator pass has completed yet."],
          ["Policy coverage", "-8", "Approval gate reduces residual risk."],
        ].map(([label, score, copy]) => (
          <div key={label} className="rounded-xl border border-white/[0.06] bg-raised p-3">
            <div className="flex justify-between text-sm font-semibold">
              <span>{label}</span>
              <span className={`font-mono ${score.startsWith("-") ? "text-emerald-400" : "text-danger"}`}>{score}</span>
            </div>
            <div className="mt-1 text-xs text-ink/55">{copy}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
