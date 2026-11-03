import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  CirclePlay,
  Eye,
  FilePen,
  FileText,
  FolderOpen,
  FolderPlus,
  Hand,
  KeyRound,
  Lock,
  LogOut,
  Plug,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  appUrl,
  auth,
  decide,
  folders as foldersApi,
  navigate,
  policies,
  RANGES,
  settings,
  startRun,
  useLive,
  type Account,
  type ApiError,
  type FolderAction,
  type LiveData,
  type LiveFolder,
  type LivePolicy,
  type LiveStep,
  type PolicyAction,
  type RangeLabel,
} from "./api";
import { DashboardPreview } from "./Console";
import { CopyButton, CountUp, LogoMark, stagger, StatusChip } from "./ui";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const inputClass =
  "w-full rounded-xl border border-white/10 bg-card px-3.5 py-2.5 text-sm text-ink shadow-sm placeholder:text-ink/50 transition duration-200 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15";
const labelClass = "text-sm font-medium text-ink/80";

const kindStyle: Record<LivePolicy["kind"], string> = {
  read: "bg-red-500/10 text-red-400 ring-red-500/25",
  write: "bg-amber-500/10 text-amber-400 ring-amber-500/25",
  delete: "bg-rose-500/10 text-rose-400 ring-rose-500/20",
  custom: "bg-raised text-ink/60 ring-ink/10",
};

const toolIcon: Record<string, LucideIcon> = {
  list_folder: FolderOpen,
  read_file: FileText,
  write_file: FilePen,
  move_path: ArrowRightLeft,
  delete_path: Trash2,
};

// [value, label, pill color]
const toolOptions: Array<[PolicyAction, string, string]> = [
  ["allow", "Allow", "bg-emerald-500 shadow-md shadow-emerald-500/30"],
  ["approve", "Ask first", "bg-amber-500 shadow-md shadow-amber-500/30"],
  ["block", "Block", "bg-red-600 shadow-[0_0_16px_rgba(255,45,32,0.6)]"],
];
const folderOptions: Array<[FolderAction, string, string]> = [
  ["readonly", "Read-only", "bg-zinc-600 shadow-md shadow-black/40"],
  ["approve", "Ask first", "bg-amber-500 shadow-md shadow-amber-500/30"],
  ["block", "Off-limits", "bg-red-600 shadow-[0_0_16px_rgba(255,45,32,0.6)]"],
];
// Laravel-style tinted circles; "danger" is solid and glowing so it never reads as the brand red.
type Tone = "brand" | "warn" | "danger";
const toneClass: Record<Tone, string> = {
  brand: "bg-brand/10 text-brand ring-1 ring-inset ring-brand/20",
  warn: "bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/25",
  danger: "bg-gradient-to-br from-red-600 to-rose-500 text-white shadow-[0_0_18px_rgba(255,45,32,0.55)]",
};
const folderLook: Record<FolderAction, [LucideIcon, Tone]> = {
  readonly: [Eye, "brand"],
  approve: [Hand, "warn"],
  block: [Lock, "danger"],
};

const taskExamples = [
  ["Tidy Downloads", "Delete the old installers (.exe and .msi files) in my Downloads folder."],
  ["Write a note", "Create notes/deskwarden-demo.txt with a short todo list for today."],
  ["Look around", "List my Desktop folder and summarise what is on it in three bullets."],
  ["Peek at keys", "Read my SSH private key in .ssh and tell me what it is."],
];

function Field({ id, label, help, children }: { id: string; label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {help ? (
        <p id={`${id}-help`} className="text-xs leading-5 text-ink/55">
          {help}
        </p>
      ) : null}
    </div>
  );
}

function Notice({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return (
      <p role="alert" className="text-xs leading-5 text-danger">
        {error}
      </p>
    );
  }
  return success ? (
    <p role="status" className="text-xs leading-5 text-emerald-400">
      {success}
    </p>
  ) : null;
}

// Radio group with a pill that slides to the chosen option.
function Segmented<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: T;
  options: Array<[T, string, string]>;
  onChange?: (value: T) => void;
}) {
  const index = options.findIndex(([option]) => option === value);
  return (
    <fieldset className="seg" disabled={!onChange} style={{ "--i": index, "--n": options.length } as CSSProperties}>
      <legend className="sr-only">{label}</legend>
      {index >= 0 ? <span aria-hidden className={`seg-pill ${options[index][2]}`} /> : null}
      {options.map(([option, text]) => (
        <label
          key={option}
          className={`relative z-[1] whitespace-nowrap rounded-full px-3 py-1.5 text-center text-xs font-semibold transition-colors duration-300 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
            option === value ? "text-white" : "text-ink/55 hover:text-ink"
          } ${onChange ? "cursor-pointer" : "cursor-default"}`}
        >
          <input type="radio" name={name} value={option} checked={option === value} onChange={() => onChange?.(option)} className="sr-only" />
          {text}
        </label>
      ))}
    </fieldset>
  );
}

function IconTile({ icon: Icon, tone = "brand" }: { icon: LucideIcon; tone?: Tone }) {
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${toneClass[tone]}`}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </span>
  );
}

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set once the server has emailed a signup code to this address.
  const [codeFor, setCodeFor] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState("");
  const signup = mode === "signup";

  // Already signed in: skip the form. Anything other than 401 means the backend is not usable.
  useEffect(() => {
    auth.me().then(
      () => navigate("/app"),
      (err: ApiError) => {
        if (err.status !== 401) setError(err.message);
      },
    );
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (codeFor) {
        await auth.verify(codeFor, code);
        return navigate("/app/playground");
      }
      const result = await (signup ? auth.signup : auth.login)(email, password);
      if ("verify" in result) {
        setCodeFor(result.email);
        setSent(`We sent a 6-digit code to ${result.email}. It expires in 10 minutes.`);
        return;
      }
      navigate(signup ? "/app/playground" : "/app");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // Signing up again with the same details sends a fresh code.
  async function resend() {
    setBusy(true);
    setError("");
    setSent("");
    try {
      await auth.signup(email, password);
      setCode("");
      setSent(`New code sent to ${codeFor}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-[100dvh] max-w-[1100px] items-center gap-12 px-4 py-12 sm:px-8 lg:grid-cols-2">
      <div>
        <a href={appUrl("/")} className="inline-flex items-center gap-3">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight">
            Desk<span className="text-brand">Warden</span>
          </span>
        </a>
        <h1 className="rise mt-10 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{signup ? "Create your workspace" : "Welcome back"}</h1>
        <p className="mt-4 max-w-[46ch] leading-7 text-ink/60">
          {signup
            ? "Give DeskAgent tasks on your computer, decide which folders it may touch, and watch every call it makes."
            : "Sign in to run DeskAgent, approve its changes and edit your guardrails."}
        </p>
      </div>
      {codeFor ? (
        <form onSubmit={submit} className="tilt-in frame holo hud flex flex-col gap-5 p-6 sm:p-8" noValidate>
          <Field id="code" label="Verification code">
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} font-mono tracking-[0.4em]`}
            />
          </Field>
          <Notice success={sent} />
          <button type="submit" disabled={busy || code.length !== 6} className="btn-brand disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "Please wait" : "Verify and create account"} <ArrowRight className="h-4 w-4" />
          </button>
          <Notice error={error} />
          <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink/60">
            <button type="button" disabled={busy} onClick={resend} className="text-brand underline-offset-2 hover:underline disabled:opacity-40">
              Resend code
            </button>
            <button
              type="button"
              onClick={() => {
                setCodeFor("");
                setCode("");
                setSent("");
                setError("");
              }}
              className="text-ink/60 underline-offset-2 hover:underline"
            >
              Use a different email
            </button>
          </p>
        </form>
      ) : (
      <form onSubmit={submit} className="tilt-in frame holo hud flex flex-col gap-5 p-6 sm:p-8" noValidate>
        <Field id="email" label="Email">
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field id="password" label="Password" help={signup ? "At least 8 characters." : undefined}>
          <input
            id="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={signup ? "password-help" : undefined}
            className={inputClass}
          />
        </Field>
        <button type="submit" disabled={busy} className="btn-brand disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "Please wait" : signup ? "Create account" : "Sign in"} <ArrowRight className="h-4 w-4" />
        </button>
        <Notice error={error} />
        <p className="text-sm text-ink/60">
          {signup ? "Already have an account? " : "No account yet? "}
          <a className="text-brand underline-offset-2 hover:underline" href={appUrl(signup ? "/login" : "/signup")}>
            {signup ? "Sign in" : "Create account"}
          </a>
        </p>
      </form>
      )}
    </div>
  );
}

const tabs = [
  ["console", "Console"],
  ["playground", "Mission control"],
  ["policies", "Guardrails"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof tabs)[number][0];

export function AppShell({ route }: { route: string }) {
  const tab = (tabs.find(([id]) => route === `/app/${id}`)?.[0] ?? "console") as Tab;
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<RangeLabel>("Last 7 days");
  const toLogin = useCallback(() => navigate("/login"), []);
  const { live, reload } = useLive(RANGES[range], toLogin);

  useEffect(() => {
    auth.me().then(setAccount, (err: ApiError) => (err.status === 401 ? toLogin() : setError(err.message)));
  }, [toLogin]);

  async function signOut() {
    await auth.logout().catch(() => undefined);
    navigate("/login");
  }

  // On narrow screens the tab bar scrolls; keep the active tab visible.
  useEffect(() => {
    document.querySelector('nav[aria-label="Workspace"] [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-danger">{error}</p>
        <a className="btn-ghost mt-6" href={appUrl("/")}>
          Back to the homepage
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-8">
          <a href={appUrl("/")} aria-label="DeskWarden homepage">
            <LogoMark />
          </a>
          <nav aria-label="Workspace" className="flex flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map(([id, label]) => (
              <a
                key={id}
                href={appUrl(`/app/${id}`)}
                aria-current={tab === id ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition duration-300 ${
                  tab === id ? "bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-md shadow-red-600/25" : "text-ink/60 hover:bg-raised hover:text-ink"
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
          {live?.run?.status === "running" ? (
            <span className="hidden items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-red-400 ring-1 ring-red-500/25 sm:inline-flex">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-red-500" /> Agent active
            </span>
          ) : null}
          <span className="hidden truncate rounded-full bg-raised px-3 py-1.5 text-xs font-medium text-ink/65 md:block">{account?.user.email}</span>
          <button type="button" onClick={signOut} aria-label="Sign out" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-card text-ink/70 transition hover:border-brand/40 hover:text-brand">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8">
        {account ? <Onboarding account={account} live={live} /> : null}
        {/* Keyed so each tab switch replays the enter animation. */}
        <div key={tab} className="view-enter">
          {tab === "console" ? (
            live ? (
              <DashboardPreview live={live} reload={reload} range={range} onRangeChange={setRange} />
            ) : (
              <div className="frame h-[520px] animate-pulse bg-card/60" aria-label="Loading console" />
            )
          ) : null}
          {tab === "playground" ? <Playground live={live} reload={reload} root={account?.root ?? ""} /> : null}
          {tab === "policies" ? <PoliciesPage root={account?.root ?? ""} /> : null}
          {tab === "settings" && account ? <SettingsPage account={account} onAccount={setAccount} /> : null}
        </div>
      </main>
    </div>
  );
}

function Onboarding({ account, live }: { account: Account; live: LiveData | null }) {
  const steps = [
    ["Add your OpenAI key", account.openai.configured, appUrl("/app/settings"), Plug],
    // Reviewing has no state of its own; it counts as done once a run shows the rules in action.
    ["Check your guardrails", Boolean(live?.run), appUrl("/app/policies"), ShieldCheck],
    ["Give DeskAgent a mission", Boolean(live?.run), appUrl("/app/playground"), CirclePlay],
  ] as const;
  if (steps.every(([, done]) => done)) return null;
  return (
    <section aria-label="Getting started" className="frame hud fill-glow mb-6 p-5">
      <h2 className="hud-label">Getting started</h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map(([label, done, href, Icon], index) => (
          <li key={label}>
            <a href={href} className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-card/80 p-3 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${done ? "bg-emerald-500/10 text-emerald-400" : "bg-brand/10 text-brand"}`}>
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className="font-mono text-[10px] text-ink/40">0{index + 1}</span>
              <span className={`text-sm ${done ? "text-ink/55 line-through" : "font-medium text-ink"}`}>{label}</span>
              {done ? null : <ArrowRight className="ml-auto h-4 w-4 text-ink/30 transition group-hover:translate-x-1 group-hover:text-brand" />}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PageHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: ReactNode }) {
  return (
    <div className="mb-6">
      <p className="hud-label rise">{eyebrow}</p>
      <h1 className="rise mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={stagger(1)}>
        {/* White, not the red gradient: headings sit on the red glow, and red on red disappears. */}
        <span className="text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.6)]">{title}</span>
      </h1>
      <p className="rise mt-2 max-w-[72ch] leading-7 text-ink/80" style={stagger(2)}>
        {copy}
      </p>
    </div>
  );
}

// What a step touched, in one line: "Downloads/setup.exe" or "notes/a.txt -> archive/a.txt".
function target(args: LiveStep["args"]) {
  if (typeof args.from === "string") return `${args.from} -> ${String(args.to)}`;
  if (typeof args.path === "string") return args.path;
  return JSON.stringify(args);
}

const stampLook: Record<string, [string, string]> = {
  allowed: ["Allowed", "border-emerald-500 text-emerald-400"],
  approved: ["Approved", "border-emerald-500 text-emerald-400"],
  blocked: ["Blocked", "border-rose-500 text-rose-400"],
  rejected: ["Rejected", "border-rose-500 text-rose-400"],
  pending: ["Awaiting you", "border-amber-500 text-amber-400"],
  escalated: ["Escalated", "border-violet-400 text-violet-300"],
};

function Playground({ live, reload, root }: { live: LiveData | null; reload: () => void; root: string }) {
  const [task, setTask] = useState(taskExamples[0][1]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = live?.run;
  const running = run?.status === "running";
  const blocker: ReactNode = !live ? (
    "Loading your workspace..."
  ) : !live.agentEnabled ? (
    <>
      Add OPENAI_API_KEY to .env.local and restart the server.{" "}
      <a className="underline" href={appUrl("/app/settings")}>
        How
      </a>
    </>
  ) : running ? (
    "DeskAgent is on a mission."
  ) : null;
  // Folders the latest run bumped into light up on the shield panel.
  const hits = new Set(
    (run?.steps ?? []).filter((step) => step.status === "blocked").flatMap((step) => (live?.folders ?? []).filter((f) => step.reason.startsWith(f.label)).map((f) => f.path)),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await startRun(task);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      reload();
    }
  }

  async function act(id: number, decision: "approved" | "rejected") {
    setError("");
    try {
      await decide(id, decision);
    } catch (err) {
      setError(errorText(err));
    }
    reload();
  }

  return (
    <>
      <PageHeading
        eyebrow="DeskAgent / OpenAI"
        title="Mission control"
        copy={
          <>
            Give DeskAgent a task on your computer. It works inside <code className="break-all rounded bg-black/40 px-1 font-mono text-sm text-white">{root || "your home folder"}</code>, and
            every call it makes passes your guardrails before anything happens.
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr] [&>*]:min-w-0">
        <div className="space-y-4">
          <form onSubmit={submit} className="frame hud flex flex-col gap-4 p-6">
            <Field id="task" label="Mission" help={`${task.length}/500 characters`}>
              <textarea
                id="task"
                value={task}
                onChange={(event) => setTask(event.target.value)}
                maxLength={500}
                rows={4}
                aria-describedby="task-help"
                className={`${inputClass} resize-none leading-6`}
              />
            </Field>
            <div>
              <p className="hud-label mb-2">Try</p>
              <div className="flex flex-wrap gap-2">
                {taskExamples.map(([label, text]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setTask(text)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition duration-300 hover:-translate-y-0.5 ${
                      task === text ? "border-brand/40 bg-brand/10 text-brand" : "border-white/10 bg-card text-ink/70 hover:border-brand/40 hover:text-brand"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button type="submit" disabled={Boolean(blocker) || busy || !task.trim()} className="btn-brand mt-auto disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? "Launching" : "Run mission"} <CirclePlay className="h-4 w-4" />
            </button>
            {blocker ? <p className="text-xs leading-5 text-amber-400">{blocker}</p> : null}
            <Notice error={error} />
          </form>

          <section className="frame p-6" aria-label="Protected folders">
            <div className="flex items-center justify-between gap-3">
              <h2 className="hud-label">Shields up</h2>
              <a href={appUrl("/app/policies")} className="text-xs font-semibold text-brand hover:underline">
                Edit guardrails
              </a>
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              {(live?.folders ?? []).map((folder) => {
                const [Icon, tone] = folderLook[folder.action];
                return (
                  <li
                    key={folder.path}
                    title={folder.path}
                    className={`flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-xs ${hits.has(folder.path) ? "hit border-rose-500/30" : "border-white/10"}`}
                  >
                    <span className={`grid h-6 w-6 place-items-center rounded-full ${toneClass[tone]}`}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <span className="font-mono">{folder.label}</span>
                    <span className="text-ink/45">{folderOptions.find(([value]) => value === folder.action)?.[1]}</span>
                  </li>
                );
              })}
              {live && live.folders.length === 0 ? <li className="text-xs text-ink/55">No protected folders. Every folder in the agent root follows the tool rules only.</li> : null}
            </ul>
          </section>
        </div>

        <section className="frame holo hud scan p-6" aria-live="polite" aria-label="Live monitor">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="radar h-9 w-9" aria-hidden />
              <div>
                <h2 className="hud-label text-ink/80">Live monitor</h2>
                <p className="font-mono text-[11px] text-ink/45">{running ? "Watching every tool call" : "Standing by"}</p>
              </div>
            </div>
            {run ? <StatusChip status={run.status} /> : null}
          </div>
          {!run ? (
            <div className="mt-6 grid place-items-center rounded-2xl border border-dashed border-white/15 px-4 py-16 text-center">
              <span className="radar h-20 w-20" aria-hidden />
              <p className="mt-5 text-sm text-ink/60">No missions yet. Pick one on the left and press Run mission.</p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="rounded-xl bg-raised px-4 py-3 text-sm leading-6 text-ink/75">
                <span className="hud-label mr-2">Mission</span>
                {run.task}
              </p>
              {run.steps.length === 0 && running ? <p className="font-mono text-[11px] text-ink/55">DeskAgent is thinking...</p> : null}
              <ol className="space-y-2.5">
                {run.steps.map((step) => {
                  const waiting = step.status === "pending" || step.status === "escalated";
                  const denied = step.status === "blocked" || step.status === "rejected";
                  const [stamp, stampTone] = stampLook[step.status] ?? [step.status, "border-ink/30 text-ink/60"];
                  const Icon = toolIcon[step.tool] ?? Wrench;
                  return (
                    <li
                      key={step.id}
                      className={`rounded-2xl border bg-card/85 p-4 ${denied ? "shake glow-danger border-rose-500/30" : waiting ? "step-in glow-warn border-amber-500/30" : "step-in border-white/[0.06]"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <IconTile icon={Icon} tone={denied ? "danger" : waiting ? "warn" : "brand"} />
                          <div className="min-w-0">
                            <p className="font-mono text-[13px] font-semibold text-ink">{step.tool}</p>
                            <p className="truncate font-mono text-[11.5px] text-ink/55">{target(step.args)}</p>
                          </div>
                        </div>
                        {/* Keyed by status so the stamp slams in again when a decision lands. */}
                        <span key={step.status} className={`stamp ${stampTone}`}>
                          {stamp}
                        </span>
                      </div>
                      <p className={`mt-2 text-xs ${denied ? "font-medium text-rose-400" : "text-ink/55"}`}>{step.reason}</p>
                      {waiting ? (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => act(step.id, "approved")}
                            className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-500/30 transition hover:-translate-y-0.5 active:scale-95"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => act(step.id, "rejected")}
                            className="rounded-full border border-rose-500/30 bg-card px-4 py-1.5 text-xs font-semibold text-rose-400 transition hover:-translate-y-0.5 hover:bg-rose-500/10 active:scale-95"
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {run.output ? (
                <div className={`step-in rounded-2xl border-l-4 p-4 text-sm leading-6 ${run.status === "failed" ? "border-rose-500 bg-rose-500/10 text-rose-400" : "border-brand bg-red-500/10 text-ink"}`}>
                  <p className="hud-label mb-1">Mission report</p>
                  {run.output}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// Shared by the editor and the read-only preview on the landing page.
export function PolicyTable({
  rows,
  onChange,
  onRemove,
  saving,
}: {
  rows: LivePolicy[];
  onChange?: (tool: string, action: PolicyAction) => void;
  onRemove?: (tool: string) => void;
  saving?: string;
}) {
  return (
    <ul className="space-y-2">
      {rows.map((row, index) => (
        <li
          key={row.tool}
          style={stagger(index)}
          className="step-in grid gap-3 rounded-2xl border border-white/[0.06] bg-card/80 p-3 transition hover:border-brand/30 hover:shadow-md md:grid-cols-[1fr_auto] md:items-center"
        >
          <div className="flex min-w-0 items-center gap-3">
            <IconTile icon={toolIcon[row.tool] ?? Wrench} tone={row.kind === "delete" ? "danger" : row.kind === "write" ? "warn" : "brand"} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-ink">{row.tool}</span>
                <span className={`status-chip ${kindStyle[row.kind]}`}>{row.kind}</span>
                {saving === row.tool ? <span className="font-mono text-[10px] text-ink/55">Saving...</span> : null}
              </div>
              <p className="mt-0.5 text-xs text-ink/55">{row.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Segmented<PolicyAction> name={`policy-${row.tool}`} label={`Policy for ${row.tool}`} value={row.action} options={toolOptions} onChange={onChange && ((action) => onChange(row.tool, action))} />
            {onRemove ? (
              <button type="button" onClick={() => onRemove(row.tool)} aria-label={`Remove rule for ${row.tool}`} className="grid h-8 w-8 place-items-center rounded-full text-ink/40 transition hover:bg-rose-500/10 hover:text-danger">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function FolderRules({ rows, root, onSet, onRemove, saving }: { rows: LiveFolder[]; root: string; onSet: (path: string, action: FolderAction) => Promise<boolean>; onRemove: (path: string) => void; saving: string }) {
  const [path, setPath] = useState("");
  const [action, setAction] = useState<FolderAction>("readonly");
  const suggestions = ["Desktop", "Documents", "Pictures", "Downloads"].filter((name) => !rows.some((row) => row.label === name));

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await onSet(path.trim(), action)) setPath("");
  }

  return (
    <section className="frame holo hud p-5 sm:p-6" aria-label="Protected folders">
      <div className="flex items-center gap-3">
        <IconTile icon={ShieldCheck} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Protected folders</h2>
          <p className="truncate font-mono text-[11px] text-ink/50">Agent root: {root}</p>
        </div>
      </div>
      <ul className="mt-5 space-y-2">
        {rows.map((row, index) => {
          const [Icon, tone] = folderLook[row.action];
          return (
            <li key={row.path} style={stagger(index)} className="step-in flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.06] bg-card/80 p-3 transition hover:border-brand/30 hover:shadow-md">
              <IconTile icon={Icon} tone={tone} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm font-semibold">{row.label}</p>
                <p className="truncate text-[11px] text-ink/45">{saving === row.path ? "Saving..." : row.path}</p>
              </div>
              <Segmented<FolderAction> name={`folder-${row.path}`} label={`Rule for ${row.label}`} value={row.action} options={folderOptions} onChange={(next) => onSet(row.path, next)} />
              <button type="button" onClick={() => onRemove(row.path)} aria-label={`Stop protecting ${row.label}`} className="grid h-8 w-8 place-items-center rounded-full text-ink/40 transition hover:bg-rose-500/10 hover:text-danger">
                <X className="h-4 w-4" />
              </button>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-ink/55">No folders protected yet.</li> : null}
      </ul>
      <form onSubmit={add} className="mt-5 grid gap-3 rounded-2xl bg-raised p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field id="folder-path" label="Protect a folder">
          <input id="folder-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Documents/Taxes" spellCheck={false} className={inputClass} />
        </Field>
        <select aria-label="Rule" value={action} onChange={(e) => setAction(e.target.value as FolderAction)} className={inputClass}>
          {folderOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!path.trim()} className="btn-brand py-2.5 disabled:cursor-not-allowed disabled:opacity-40">
          <FolderPlus className="h-4 w-4" /> Protect
        </button>
        {suggestions.length ? (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
            <span className="text-xs text-ink/50">Quick add:</span>
            {suggestions.map((name) => (
              <button key={name} type="button" onClick={() => setPath(name)} className="rounded-full border border-white/10 bg-card px-2.5 py-1 font-mono text-[11px] text-ink/70 transition hover:border-brand/40 hover:text-brand">
                {name}
              </button>
            ))}
          </div>
        ) : null}
      </form>
    </section>
  );
}

function PoliciesPage({ root }: { root: string }) {
  const [rows, setRows] = useState<LivePolicy[] | null>(null);
  const [folderRows, setFolderRows] = useState<LiveFolder[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [newTool, setNewTool] = useState("");
  const [newAction, setNewAction] = useState<PolicyAction>("approve");

  useEffect(() => {
    policies.list().then(setRows, (err) => setError(errorText(err)));
    foldersApi.list().then(setFolderRows, (err) => setError(errorText(err)));
  }, []);

  async function save<T>(task: () => Promise<T>, apply: (value: T) => void, key: string) {
    setSaving(key);
    setError("");
    try {
      apply(await task());
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setSaving("");
    }
  }

  const savePolicy = (task: () => Promise<LivePolicy[]>, tool: string) => save(task, setRows, tool);
  const saveFolder = (task: () => Promise<LiveFolder[]>, path: string) => save(task, setFolderRows, path);

  async function add(event: FormEvent) {
    event.preventDefault();
    const tool = newTool.trim();
    if (await savePolicy(() => policies.set(tool, newAction), tool)) setNewTool("");
  }

  const count = (action: PolicyAction) => String(rows?.filter((row) => row.action === action).length ?? 0);
  const tiles = [
    ["Tools allowed", count("allow"), "from-emerald-500 to-teal-400"],
    ["Ask first", count("approve"), "from-amber-400 to-orange-500"],
    ["Tools blocked", count("block"), "from-rose-500 to-pink-600"],
    ["Protected folders", String(folderRows?.length ?? 0), "from-red-600 to-orange-500"],
  ] as const;

  return (
    <>
      <PageHeading
        eyebrow="Policy engine"
        title="Guardrails"
        copy="Two layers judge every call. Tool rules decide what DeskAgent may do, folder rules decide where. The stricter one wins, and a tool with no rule is denied."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value, gradient], index) => (
          <div key={label} style={stagger(index)} className="rise frame hud p-4">
            <p className="hud-label">{label}</p>
            <p className={`mt-2 bg-gradient-to-r ${gradient} bg-clip-text text-4xl font-bold text-transparent`}>{rows && folderRows ? <CountUp value={value} /> : "-"}</p>
          </div>
        ))}
      </div>
      <Notice error={error} />
      <div className="mt-3 grid gap-4 xl:grid-cols-[1.05fr_1fr] [&>*]:min-w-0">
        <div className="space-y-4">
          {folderRows ? (
            <FolderRules
              rows={folderRows}
              root={root}
              saving={saving}
              onSet={(path, action) => saveFolder(() => foldersApi.set(path, action), path)}
              onRemove={(path) => saveFolder(() => foldersApi.remove(path), path)}
            />
          ) : (
            <div className="frame h-80 animate-pulse" aria-label="Loading folders" />
          )}
          <div className="frame fill-glow hud p-5 sm:p-6">
            <h2 className="text-lg font-semibold">A prompt is a request. A rule is a guarantee.</h2>
            <p className="mt-2 text-sm leading-6 text-ink/60">
              Writing "don't delete Downloads" in the mission asks the model nicely, and models misread. Marking Downloads read-only makes the server refuse the
              delete before it runs, whatever the model decides. Links and parent folders cannot get around it: deleting <code className="font-mono text-brand">~</code> is
              refused because Downloads lives inside it.
            </p>
          </div>
        </div>
        <div className="frame p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <IconTile icon={Wrench} />
            <h2 className="text-lg font-semibold">Tool permissions</h2>
          </div>
          <div className="mt-5">
            {rows ? (
              <PolicyTable rows={rows} saving={saving} onChange={(tool, action) => savePolicy(() => policies.set(tool, action), tool)} onRemove={(tool) => savePolicy(() => policies.remove(tool), tool)} />
            ) : (
              <div className="h-64 animate-pulse rounded-xl bg-raised" aria-label="Loading policies" />
            )}
            {rows?.length === 0 ? <p className="font-mono text-[11px] text-ink/55">No rules. Every tool call will be denied.</p> : null}
          </div>
          <details className="mt-5 rounded-2xl bg-raised p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink/80">Add a rule for your own agent's tool</summary>
            <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <Field id="new-tool" label="Tool name">
                <input id="new-tool" value={newTool} onChange={(e) => setNewTool(e.target.value)} placeholder="query_customers" pattern="[a-z][a-z0-9_]{1,63}" className={inputClass} />
              </Field>
              <select aria-label="Action" value={newAction} onChange={(e) => setNewAction(e.target.value as PolicyAction)} className={inputClass}>
                {toolOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!newTool.trim()} className="btn-ghost py-2.5 disabled:cursor-not-allowed disabled:opacity-40">
                Add rule
              </button>
            </form>
          </details>
        </div>
      </div>
    </>
  );
}

function SettingsPage({ account, onAccount }: { account: Account; onAccount: (account: Account) => void }) {
  const [newKey, setNewKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const configured = account.openai.configured;

  async function rotate() {
    setKeyError("");
    try {
      const { key, ...next } = await settings.rotateAgentKey();
      setNewKey(key);
      onAccount(next);
    } catch (err) {
      setKeyError(errorText(err));
    }
  }

  const envLines = "# .env.local in the project folder\nOPENAI_API_KEY=sk-...\n\n# then restart the API\nnpm run server";
  const curl = `curl -X POST 127.0.0.1:8787/api/tool-calls \\\n  -H "authorization: Bearer ${newKey || "$AGENT_KEY"}" \\\n  -d '{"agent":"MyAgent","tool":"delete_path","args":{"path":"Downloads"}}'`;

  return (
    <>
      <PageHeading eyebrow="Workspace" title="Settings" copy="The model DeskAgent thinks with, the folder it works in, and the key your own agents use to ask for permission." />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <section className="frame holo hud flex flex-col gap-5 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-3 text-lg font-semibold">
              <IconTile icon={Plug} /> OpenAI
            </h2>
            <StatusChip status={configured ? "Connected" : "Not configured"} />
          </div>
          <p className="text-sm leading-6 text-ink/60">
            The key lives in <code className="font-mono text-brand">.env.local</code> on this computer. Only the server reads it; it never reaches the browser or the
            database.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              ["Model", account.openai.model],
              ["Agent folder", account.root],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-raised p-3">
                <dt className="hud-label">{label}</dt>
                <dd className="mt-1 break-all font-mono text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {configured ? null : (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className={labelClass}>Set it up</span>
                <CopyButton text={envLines} />
              </div>
              <pre className="overflow-x-auto rounded-xl bg-black p-4 font-mono text-[11.5px] leading-6 text-slate-200">{envLines}</pre>
            </div>
          )}
          <p className="text-xs leading-5 text-ink/50">Change the model with OPENAI_MODEL and the folder with AGENT_ROOT in the same file.</p>
        </section>

        <div className="space-y-4">
          <section className="frame flex flex-col gap-4 p-6">
            <h2 className="flex items-center gap-3 text-lg font-semibold">
              <IconTile icon={KeyRound} /> Agent API key
            </h2>
            <p className="text-sm leading-6 text-ink/60">
              Your own agents send this key with every tool call. It can submit and read tool calls only; it cannot approve them or change guardrails.
            </p>
            <p className="font-mono text-sm text-ink/75">{account.agentKey.hint ? `Current key: ${account.agentKey.hint}` : "No key yet."}</p>
            {newKey ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-amber-400">Copy it now. It will not be shown again.</p>
                  <CopyButton text={newKey} />
                </div>
                <code className="mt-2 block break-all font-mono text-xs text-ink">{newKey}</code>
              </div>
            ) : null}
            <button type="button" onClick={rotate} className="btn-ghost self-start">
              {account.agentKey.hint ? "Rotate key" : "Generate key"}
            </button>
            {account.agentKey.hint ? <p className="text-xs text-ink/55">Rotating stops the old key immediately.</p> : null}
            <Notice error={keyError} />
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className={labelClass}>Try it</span>
                <CopyButton text={curl} />
              </div>
              <pre className="overflow-x-auto rounded-xl bg-black p-4 font-mono text-[11.5px] leading-6 text-slate-200">{curl}</pre>
            </div>
          </section>
          <section className="frame flex items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-lg font-semibold">Account</h2>
              <p className="mt-1 font-mono text-sm text-ink/60">{account.user.email}</p>
            </div>
            <button type="button" onClick={() => auth.logout().finally(() => navigate("/login"))} className="btn-ghost">
              Sign out
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
