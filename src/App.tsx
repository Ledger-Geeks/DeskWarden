import {
  ArrowRight,
  BarChart3,
  Check,
  CirclePlay,
  ClipboardCheck,
  Clock3,
  Database,
  Eye,
  Globe2,
  Layers3,
  Menu,
  Plug,
  RotateCcw,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { appUrl, useRoute, type LivePolicy, type RangeLabel } from "./api";
import { DashboardPreview } from "./Console";
import { Aurora, CopyButton, CountUp, LogoMark, Sparkline, StatusChip, stagger, useScrollReveal } from "./ui";
import { AppShell, AuthPage, PolicyTable } from "./Workspace";

const brands = ["Pioneer", "Northstar", "Arcadia", "Chainworks", "Vertex"];

const navLinks = [
  ["Platform", "#platform"],
  ["How it works", "#how-it-works"],
  ["Features", "#security"],
  ["Workspace", "#workspace"],
  ["Pricing", "#pricing"],
  ["Docs", "#docs"],
];

const approvalExamples = [
  ["write_file", "DeskAgent", "Pending"],
  ["move_path", "CleanupBot", "Pending"],
  ["delete_path", "DeskAgent", "Pending"],
  ["read_file ~/.ssh", "ResearchAgent", "Blocked"],
];

const features = [
  [Users, "Human Approvals", "Require human review for high-risk actions and tool calls before execution."],
  [ShieldCheck, "Policy Enforcement", "Enforce granular policies across agents, tools, data, and contexts."],
  [ClipboardCheck, "Auditability", "Complete, immutable audit logs for every run and every action."],
  [Database, "RAG Transparency", "Trace retrieval, sources and context for every generated response."],
  [RotateCcw, "Run Replay", "Replay any run step-by-step for debugging, review, and analysis."],
  [BarChart3, "Operational Metrics", "Deep observability into performance, reliability, cost, and risk."],
] as const;

const stats = [
  [Eye, "99.9%", "Workflow visibility"],
  [Layers3, "6", "Control layers"],
  [ShieldCheck, "100%", "Audit coverage"],
  [Clock3, "24/7", "Audit trail"],
  [Users, "1,000+", "Agents governed"],
  [Globe2, "Global", "Enterprise ready"],
] as const;

const flow = [
  [Send, "Ask", "The agent sends the tool name and arguments to DeskWarden before it runs anything.", "POST /api/tool-calls"],
  [ShieldCheck, "Decide", "Your policy allows, blocks or holds the call. Tools without a rule are denied.", "allowed | blocked | pending"],
  [Users, "Approve", "Held calls wait in the queue until you approve, reject or escalate them.", "POST /api/tool-calls/:id/decision"],
  [ClipboardCheck, "Record", "Every request and decision is appended to an audit log that cannot be edited.", "audit_log (append-only)"],
] as const;

const workspaceSteps = [
  [UserPlus, "Create an account", "Your policies, keys, runs and audit log are private to your account."],
  [Plug, "Add your OpenAI key", "One line in .env.local. It stays on the server and never reaches the browser."],
  [ShieldCheck, "Protect your folders", "Mark folders read-only, ask-first or off-limits. Change it any time."],
  [CirclePlay, "Run tasks and watch", "Give the agent a task and approve its risky calls as they happen."],
] as const;

// Mirrors the defaults a new account starts with (server/index.ts CATALOG).
const defaultPolicies: LivePolicy[] = [
  { tool: "list_folder", action: "allow", kind: "read", description: "List the files and folders inside a folder." },
  { tool: "read_file", action: "allow", kind: "read", description: "Read a text file (first 20,000 characters)." },
  { tool: "write_file", action: "approve", kind: "write", description: "Create or overwrite a text file. Missing folders are created." },
  { tool: "move_path", action: "approve", kind: "write", description: "Move or rename a file or folder. Fails if the destination exists." },
  { tool: "delete_path", action: "approve", kind: "delete", description: "Delete a file or folder (it is moved to the DeskWarden trash)." },
];

const quickstart = [
  ["Configure", "cp .env.example .env.local\n# then set your key:\nOPENAI_API_KEY=sk-..."],
  ["Run", "npm install\nnpm run server   # API on :8787\nnpm run dev      # open the app, create an account"],
  [
    "Connect your own agent",
    '# Settings -> Generate agent key, then:\ncurl -X POST localhost:8787/api/tool-calls \\\n  -H "authorization: Bearer $AGENT_KEY" \\\n  -d \'{"agent":"MyAgent","tool":"delete_path","args":{"path":"Downloads"}}\'',
  ],
];

const endpoints = [
  ["POST", "/api/auth/signup | login | logout", "none", "Create an account or start a session"],
  ["POST", "/api/tool-calls", "agent key", "Submit a tool call for a policy decision"],
  ["GET", "/api/tool-calls/:id", "agent key or session", "Poll until approved or rejected"],
  ["POST", "/api/tool-calls/:id/decision", "session", "Approve, reject or escalate"],
  ["PUT", "/api/policies/:tool", "session", "Set allow, approve or block"],
  ["PUT", "/api/folders", "session", "Protect a folder: readonly, approve or block"],
  ["POST", "/api/settings/agent-key", "session", "Generate or rotate the agent key"],
  ["POST", "/api/agent-runs", "session", "Give DeskAgent a task"],
  ["GET", "/api/dashboard?hours=", "session", "Queue, audit, stats, policies, latest run"],
];

const faqs = [
  [
    "Do I need an OpenAI API key?",
    "Only to run DeskAgent. Put it in .env.local as OPENAI_API_KEY; it stays on the server. Your own agents can use the gateway with just an agent key.",
  ],
  [
    "If I tell the agent \"don't delete Downloads\", is that enough?",
    "No. A sentence in the task is a request the model can misread or ignore. A folder rule is enforced by the server before anything runs, so mark Downloads read-only and the delete is blocked whatever the model decides.",
  ],
  [
    "Can an agent bypass the gateway?",
    "Yes, if the agent holds the tool's credentials itself. The gateway only protects tools whose keys live behind it, so keep integration credentials out of the agent.",
  ],
  [
    "Where is the data stored?",
    "In a local SQLite file (DB_PATH). Passwords are hashed with scrypt. The server listens on 127.0.0.1 only. File names and contents DeskAgent reads are sent to OpenAI as part of the task.",
  ],
  [
    "Is the audit log tamper-proof?",
    "It is append-only: database triggers abort every update and delete. Someone with direct access to the file could still drop the triggers. Hash-chaining rows is the next step.",
  ],
];


export default function App() {
  const route = useRoute();
  const page = route === "/login" || route === "/signup" ? route : route.startsWith("/app") ? "app" : "landing";
  useScrollReveal();

  useEffect(() => {
    if (page !== "landing") window.scrollTo(0, 0);
  }, [page]);

  return (
    <>
      <Aurora />
      {page === "/login" || page === "/signup" ? (
        <AuthPage mode={page === "/login" ? "login" : "signup"} />
      ) : page === "app" ? (
        <AppShell route={route} />
      ) : (
        <Landing />
      )}
    </>
  );
}

function Landing() {
  const [range, setRange] = useState<RangeLabel>("Last 7 days");
  return (
    <div className="min-h-[100dvh] overflow-x-clip">
      <Navbar />
      <main>
        <Hero>
          <DashboardPreview live={null} reload={() => undefined} range={range} onRangeChange={setRange} />
        </Hero>
        <BrandStrip />
        <HowItWorks />
        <FeatureGrid />
        <WorkspaceSection />
        <StatsStrip />
        <Pricing />
        <Docs />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}

export function IconTile({ icon: Icon, size = "md" }: { icon: LucideIcon; size?: "sm" | "md" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-brand/10 text-brand ring-1 ring-inset ring-brand/20 ${
        size === "sm" ? "h-10 w-10" : "h-12 w-12"
      }`}
    >
      <Icon className={size === "sm" ? "h-5 w-5" : "h-6 w-6"} strokeWidth={1.75} />
    </span>
  );
}

function Navbar() {
  const closeMenu = (event: MouseEvent<HTMLElement>) => event.currentTarget.closest("details")?.removeAttribute("open");
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-card/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-4 sm:px-8">
        <a className="flex items-center gap-3" href="#platform">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight">
            Desk<span className="text-gradient">Warden</span>
          </span>
        </a>
        <nav aria-label="Primary" className="hidden items-center gap-7 text-sm font-medium text-ink/70 xl:flex">
          {navLinks.map(([label, href]) => (
            <a key={href} className="nav-link transition hover:text-ink" href={href}>
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <a href={appUrl("/login")} className="nav-link hidden text-sm font-semibold text-ink/75 transition hover:text-ink sm:block">
            Sign in
          </a>
          <a href={appUrl("/signup")} className="btn-brand hidden !px-5 !py-2.5 sm:inline-flex">
            Create account <ArrowRight className="h-4 w-4" />
          </a>
          <details className="relative xl:hidden">
            <summary aria-label="Open menu" className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl border border-white/10 bg-card text-ink transition hover:border-brand/40 [&::-webkit-details-marker]:hidden">
              <Menu className="h-5 w-5" />
            </summary>
            <nav aria-label="Mobile" onClick={closeMenu} className="absolute right-0 top-12 flex w-60 flex-col rounded-2xl border border-white/10 bg-card p-2 text-sm font-medium shadow-xl shadow-red-600/10">
              {navLinks.map(([label, href]) => (
                <a key={href} className="rounded-lg px-3 py-2.5 text-ink/75 hover:bg-brand/10 hover:text-brand" href={href}>
                  {label}
                </a>
              ))}
              <a className="rounded-lg px-3 py-2.5 text-ink/75 hover:bg-brand/10 hover:text-brand sm:hidden" href={appUrl("/login")}>
                Sign in
              </a>
              <a className="rounded-lg px-3 py-2.5 font-semibold text-brand hover:bg-brand/10 sm:hidden" href={appUrl("/signup")}>
                Create account
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function Hero({ children }: { children: ReactNode }) {
  return (
    <section id="platform" className="scroll-mt-16">
      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-12 sm:px-8 lg:pt-20">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className="rise eyebrow" style={stagger(0)}>
              AI agent governance for your computer
            </p>
            <h1 className="rise mt-6 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl xl:text-[3.9rem]" style={stagger(1)}>
              Let AI work on your files
              <span className="text-gradient block pb-1">without losing a single one</span>
            </h1>
          </div>
          <div className="lg:col-span-4">
            <p className="rise max-w-[46ch] text-lg leading-8 text-ink/65" style={stagger(2)}>
              DeskAgent reads, writes and moves files for you. Every action passes your rules first: Downloads stays
              read-only, .ssh stays off-limits, and deletes wait for your click.
            </p>
            <div className="rise mt-7 flex flex-col gap-3 sm:flex-row" style={stagger(3)}>
              <a className="btn-brand" href={appUrl("/signup")}>
                Create account <ArrowRight className="h-4 w-4" />
              </a>
              <a className="btn-ghost" href="#demo">
                View Demo <CirclePlay className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
        <div className="tilt-in mt-14">{children}</div>
      </div>
    </section>
  );
}

function BrandStrip() {
  return (
    <section aria-label="Customers" className="pb-6">
      <p className="text-center text-sm font-medium text-ink/55">Trusted by leading teams building with AI</p>
      <div className="marquee mx-auto mt-6 max-w-[1100px] overflow-hidden">
        <ul className="flex w-max">
          {[...brands, ...brands].map((brand, index) => (
            <li key={index} aria-hidden={index >= brands.length} className="flex items-center gap-3 pr-16 text-lg font-semibold text-ink/50">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-red-600/15 to-orange-500/15 font-mono text-sm text-brand">
                {brand[0]}
              </span>
              {brand}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SectionHeading({ title, copy }: { title: string; copy?: string }) {
  return (
    <div className="reveal">
      <h2 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem]">{title}</h2>
      {copy ? <p className="mt-4 max-w-[62ch] text-lg leading-8 text-ink/60">{copy}</p> : null}
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <SectionHeading title="How a tool call is governed" copy="Agents never call a sensitive tool directly. They ask first, and the answer is recorded." />
        <ol className="mt-12 grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
          {flow.map(([Icon, title, copy, code], index) => (
            <li key={title} className="contents">
              {index > 0 ? (
                <div aria-hidden className="hidden items-center text-brand/60 lg:flex">
                  <ArrowRight className="nudge h-5 w-5" style={{ animationDelay: `${index * 0.3}s` }} />
                </div>
              ) : null}
              <div className="reveal lift frame frame-hover flex flex-col p-6" style={stagger(index)}>
                <IconTile icon={Icon} />
                <h3 className="mt-5 text-xl font-semibold">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-ink/60">{copy}</p>
                <code className="mt-5 block truncate rounded-lg bg-raised px-2.5 py-1.5 font-mono text-[11px] text-brand">{code}</code>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const [approvalsCell, policyCell, auditCell, ragCell, replayCell, metricsCell] = features;
  return (
    <section id="security" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <p className="reveal eyebrow">Why teams use DeskWarden</p>
        <div className="mt-5">
          <SectionHeading
            title="Built for safe, scalable and reliable AI systems"
            copy="From approvals to evaluations, every control you need to operate AI agents with confidence."
          />
        </div>
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FeatureCell index={0} feature={approvalsCell} className="fill-glow md:col-span-2 lg:row-span-2">
            <div className="space-y-2">
              {approvalExamples.map(([tool, agent, status]) => (
                <div key={tool} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-card/80 px-3 py-2.5 shadow-sm">
                  <span className="min-w-0 truncate font-mono text-[12px]">
                    <span className="text-ink">{tool}</span> <span className="text-ink/55">by {agent}</span>
                  </span>
                  <StatusChip status={status} />
                </div>
              ))}
            </div>
          </FeatureCell>
          <FeatureCell index={1} feature={policyCell} className="md:col-span-2 lg:col-span-2">
            <pre className="overflow-x-auto rounded-xl bg-black p-4 font-mono text-[12px] leading-6 text-slate-300">
              <span>list_folder      </span><span className="text-emerald-400">allow</span>{"\n"}
              <span>write_file       </span><span className="text-amber-300">require_approval</span>{"\n"}
              <span>~/Downloads      </span><span className="text-amber-300">read_only</span>{"\n"}
              <span>~/.ssh           </span><span className="text-rose-400">off_limits</span>{"\n"}
              <span className="text-slate-500">*                </span><span className="text-rose-400">deny</span>
            </pre>
          </FeatureCell>
          <FeatureCell index={2} feature={auditCell} className="fill-dots">
            <div className="font-mono text-[11px] text-ink/60">
              UPDATE audit_log <span className="text-ink/40">-&gt;</span> <span className="font-semibold text-danger">ABORT</span>
            </div>
          </FeatureCell>
          <FeatureCell index={3} feature={ragCell} className="fill-stripes" />
          <FeatureCell index={4} feature={replayCell} className="lg:col-span-2">
            <div className="relative pt-2">
              <div className="seg-track h-2">
                <div className="seg-fill h-full bg-gradient-to-r from-red-600 to-orange-500" style={{ width: "62%" }} />
              </div>
              <span className="absolute top-0.5 h-5 w-1.5 -translate-x-1/2 rounded-full bg-black ring-4 ring-brand/20" style={{ left: "62%" }} />
              <div className="mt-2 flex justify-between font-mono text-[10px] text-ink/55">
                <span>10:24:31</span>
                <span>10:24:45</span>
              </div>
            </div>
          </FeatureCell>
          <FeatureCell index={5} feature={metricsCell} className="md:col-span-2 lg:col-span-2">
            <Sparkline tone="blue" className="h-16 w-full" />
          </FeatureCell>
        </div>
      </div>
    </section>
  );
}

function FeatureCell({
  feature: [Icon, title, copy],
  index,
  className = "",
  children,
}: {
  feature: (typeof features)[number];
  index: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <article className={`reveal lift frame frame-hover flex flex-col p-6 ${className}`} style={stagger(index)}>
      <IconTile icon={Icon} />
      <h3 className="mt-5 text-xl font-semibold">{title}</h3>
      <p className="mt-2 max-w-[48ch] text-sm leading-6 text-ink/60">{copy}</p>
      {children ? <div className="mt-6 flex flex-1 flex-col justify-end">{children}</div> : null}
    </article>
  );
}

function WorkspaceSection() {
  return (
    <section id="workspace" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <div className="frame overflow-hidden bg-gradient-to-br from-red-600 via-rose-600 to-orange-500 p-px">
          <div className="grid gap-10 rounded-[19px] bg-card/95 p-6 sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <SectionHeading title="Your workspace, your rules" copy="Everything your agent may do is decided in one place, per account." />
              <ol className="mt-8 space-y-5">
                {workspaceSteps.map(([Icon, title, copy], index) => (
                  <li key={title} className="reveal flex gap-4" style={stagger(index)}>
                    <IconTile icon={Icon} size="sm" />
                    <div>
                      <h3 className="font-semibold">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-ink/60">{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <a href={appUrl("/signup")} className="btn-brand mt-8">
                Create account <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="reveal float rounded-2xl border border-white/[0.06] bg-card p-5 shadow-xl shadow-red-600/10" style={stagger(2)}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="font-semibold">Tool permissions</h3>
                <span className="rounded-full bg-raised px-2.5 py-1 text-[11px] font-medium text-ink/60">Default for new accounts</span>
              </div>
              <PolicyTable rows={defaultPolicies} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsStrip() {
  return (
    <section id="observability" aria-label="Platform stats" className="scroll-mt-16 pb-8">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map(([Icon, value, label], index) => (
            <div key={label} className="reveal lift frame frame-hover flex flex-col gap-3 p-6" style={stagger(index)}>
              <IconTile icon={Icon} size="sm" />
              <div className="text-gradient font-mono text-3xl font-bold">
                <CountUp value={value} />
              </div>
              <div className="text-sm text-ink/60">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <SectionHeading title="Free to self-host" copy="No tiers and no seat limits. You run it, you own the data." />
        <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="reveal frame fill-glow flex flex-col p-8 sm:p-10">
            <span className="self-start rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">Self-hosted</span>
            <p className="text-gradient mt-5 text-7xl font-bold">$0</p>
            <p className="mt-3 text-ink/60">MIT license. Run it on your laptop or your own server.</p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {["Accounts with private workspaces", "Per-tool permission editor", "Human approval queue", "Append-only audit log", "Protected folders", "DeskAgent for your files"].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-ink/80">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-red-600 to-orange-500 text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <a href="#docs" className="btn-ghost mt-10 self-start">
              Read the quickstart <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="reveal frame flex flex-col gap-8 p-8 sm:p-10" style={stagger(1)}>
            <div>
              <h3 className="text-xl font-semibold">What you pay for</h3>
              <p className="mt-2 leading-7 text-ink/60">Only your own model usage. The demo agent calls OpenAI with the key you connect, and OpenAI bills you directly.</p>
            </div>
            <div>
              <h3 className="text-xl font-semibold">What is not included</h3>
              <p className="mt-2 leading-7 text-ink/60">Hosted cloud, SSO, teams and roles. Each account is a single operator, so run it on a trusted network.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Docs() {
  return (
    <section id="docs" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-8">
        <SectionHeading title="Quickstart" copy="Three steps to a running gateway. Requires Node 24.2 or newer." />
        <div className="mt-12 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-4">
            {quickstart.map(([title, code], index) => (
              <div key={title} className="reveal frame p-5" style={stagger(index)}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">{title}</h3>
                  <CopyButton text={code} />
                </div>
                <pre className="overflow-x-auto rounded-xl bg-black p-4 font-mono text-[12px] leading-6 text-slate-200">{code}</pre>
              </div>
            ))}
          </div>
          <div id="api" className="reveal frame scroll-mt-20 p-5" style={stagger(1)}>
            <h3 className="font-semibold">API reference</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs font-medium text-ink/55">
                  <tr>
                    <th className="pb-3 font-medium">Endpoint</th>
                    <th className="pb-3 font-medium">Auth</th>
                    <th className="pb-3 font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map(([method, path, token, purpose]) => (
                    <tr key={method + path} className="border-t border-white/10 transition hover:bg-raised">
                      <td className="py-3 pr-4 font-mono text-[12px]">
                        <span className={`mr-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${method === "GET" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                          {method}
                        </span>
                        {path}
                      </td>
                      <td className="py-3 pr-4 text-xs text-ink/60">{token}</td>
                      <td className="py-3 text-ink/70">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 text-sm leading-6 text-ink/60">
              Agent keys can only submit and read tool calls. Approving, editing policies and running the demo agent need a signed-in session.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHeading title="Questions" copy="Straight answers, including the limits." />
        <div className="space-y-3">
          {faqs.map(([question, answer], index) => (
            <details key={question} className="reveal frame frame-hover group p-5" style={stagger(index)}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
                {question}
                <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand transition duration-300 group-open:rotate-45 group-open:bg-brand group-open:text-white">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-[65ch] text-sm leading-6 text-ink/65">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const columns = [
    ["Product", [["Console demo", "#demo"], ["Workspace", "#workspace"], ["Pricing", "#pricing"], ["Sign in", appUrl("/login")]]],
    ["Developers", [["Quickstart", "#docs"], ["API reference", "#api"], ["FAQ", "#faq"]]],
  ] as const;
  return (
    <footer className="mt-10 border-t border-white/[0.06] bg-card/60 backdrop-blur">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-12 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-8">
        <div>
          <a href="#platform" className="flex items-center gap-3">
            <LogoMark />
            <span className="text-lg font-bold tracking-tight">DeskWarden</span>
          </a>
          <p className="mt-4 max-w-xs text-sm leading-6 text-ink/60">Open-source governance for AI agent tool calls. MIT licensed.</p>
        </div>
        {columns.map(([title, links]) => (
          <div key={title}>
            <h3 className="text-sm font-semibold">{title}</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {links.map(([label, href]) => (
                <li key={href}>
                  <a className="text-ink/65 transition hover:text-brand" href={href}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1400px] justify-between border-t border-white/[0.06] px-4 py-6 text-xs text-ink/55 sm:px-8">
        <span>DeskWarden</span>
        <a className="transition hover:text-brand" href="#platform">
          Back to top
        </a>
      </div>
    </footer>
  );
}
