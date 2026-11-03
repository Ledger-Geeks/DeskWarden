import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { sendMail } from "./mail.ts";

type Action = "allow" | "approve" | "block";
type Guard = "readonly" | "approve" | "block";
type Json = Record<string, unknown>;
type Identity = { userId: number; email: string; role: "operator" | "agent" };
type OutputItem = { type: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ type: string; text?: string }> };
export type Respond = (request: { input: unknown[]; previousResponseId?: string }) => Promise<{ id: string; output: OutputItem[] }>;
export type OpenAi = { respond: (apiKey: string, model: string, instructions: string) => Respond };

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const ACTIONS: Action[] = ["allow", "approve", "block"];
const GUARDS: Guard[] = ["readonly", "approve", "block"];
const STATUS: Record<Action, string> = { allow: "allowed", approve: "pending", block: "blocked" };
const REASON: Record<Action, string> = { allow: "Allowed by your policy", approve: "Needs your approval", block: "Blocked by your policy" };
const STRICTNESS: Action[] = ["allow", "approve", "block"];
// decision -> statuses it may be applied from
const DECISIONS: Record<string, string[]> = {
  approved: ["pending", "escalated"],
  rejected: ["pending", "escalated"],
  escalated: ["pending"],
};
const SESSION_MS = 7 * 24 * 3_600_000;
const MAX_READ = 20_000;
const OTP_MS = 10 * 60_000;
const OTP_RESEND_MS = 60_000;
const OTP_TRIES = 5;

// The desk agent's tools. `paths` names the arguments that are file paths; `action` is a new account's default policy.
const CATALOG: Record<string, { kind: "read" | "write" | "delete"; description: string; params: Record<string, "string">; paths: string[]; action: Action }> = {
  list_folder: { kind: "read", description: "List the files and folders inside a folder.", params: { path: "string" }, paths: ["path"], action: "allow" },
  read_file: { kind: "read", description: "Read a text file (first 20,000 characters).", params: { path: "string" }, paths: ["path"], action: "allow" },
  write_file: { kind: "write", description: "Create or overwrite a text file. Missing folders are created.", params: { path: "string", content: "string" }, paths: ["path"], action: "approve" },
  move_path: { kind: "write", description: "Move or rename a file or folder. Fails if the destination exists.", params: { from: "string", to: "string" }, paths: ["from", "to"], action: "approve" },
  delete_path: { kind: "delete", description: "Delete a file or folder (it is moved to the DeskWarden trash).", params: { path: "string" }, paths: ["path"], action: "approve" },
};

// Folders a new account starts with protected, relative to the agent root.
const DEFAULT_GUARDS: Array<[string, Guard]> = [
  [".ssh", "block"],
  ["AppData", "block"],
  ["Downloads", "readonly"],
];

// Strict function tools: every property required, no extras (OpenAI strict-mode rules).
const TOOLS = Object.entries(CATALOG).map(([name, { description, params }]) => ({
  type: "function",
  name,
  description,
  strict: true,
  parameters: {
    type: "object",
    properties: Object.fromEntries(Object.entries(params).map(([key, type]) => [key, { type }])),
    required: Object.keys(params),
    additionalProperties: false,
  },
}));

const AGENT_NAME = "DeskAgent";
const MAX_TURNS = 12;
const instructionsFor = (root: string) =>
  `You are DeskAgent, an assistant that works with files on the user's computer. Paths are relative to ${root} unless absolute. ` +
  "Look before you change anything: list a folder before moving or deleting inside it. " +
  "Every tool call passes through the DeskWarden governance gateway. If a call comes back blocked or rejected, do not retry it or work around it; " +
  "explain what happened instead. Keep the final answer under 80 words.";

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

export const openAi: OpenAi = {
  respond: (apiKey, model, instructions) => async ({ input, previousResponseId }) => {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, instructions, input, tools: TOOLS, previous_response_id: previousResponseId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message ?? `OpenAI request failed (${res.status})`);
    return body;
  },
};

// True when `child` is `parent` or inside it. path.win32.relative compares case-insensitively, matching NTFS.
const within = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

// Resolves symlinks and junctions on the part of the path that exists, so a link cannot smuggle a call past a folder rule.
function realish(path: string) {
  let head = path;
  const tail: string[] = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) return path;
    tail.unshift(basename(head));
    head = up;
  }
  return join(realpathSync.native(head), ...tail);
}

const outputText = (output: OutputItem[]) =>
  output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim() || "(The model returned no text.)";

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      llm_key_enc TEXT,
      llm_key_hint TEXT,
      llm_model TEXT,
      agent_key_hash TEXT UNIQUE,
      agent_key_hint TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policies (
      user_id INTEGER NOT NULL REFERENCES users(id),
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      PRIMARY KEY (user_id, tool)
    );
    CREATE TABLE IF NOT EXISTS protected_paths (
      user_id INTEGER NOT NULL REFERENCES users(id),
      path TEXT NOT NULL,
      action TEXT NOT NULL,
      PRIMARY KEY (user_id, path)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY,
      agent TEXT NOT NULL,
      tool TEXT NOT NULL,
      args TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      event TEXT NOT NULL,
      tool_call_id INTEGER REFERENCES tool_calls(id),
      detail TEXT
    );
    -- ponytail: append-only via triggers; anyone with the DB file can still drop them. Hash-chain rows if tamper-evidence matters.
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
  `);
  // Columns added after the first schema; databases from older versions get them here.
  // Rows written before accounts existed keep user_id NULL and belong to no one.
  for (const [table, column] of [
    ["tool_calls", "run_id INTEGER REFERENCES runs(id)"],
    ["tool_calls", "user_id INTEGER REFERENCES users(id)"],
    ["runs", "user_id INTEGER REFERENCES users(id)"],
    ["audit_log", "user_id INTEGER REFERENCES users(id)"],
  ]) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    } catch (error) {
      if (!String(error).includes("duplicate column")) throw error;
    }
  }
  // A run cannot survive a restart: its in-memory loop is gone.
  db.exec("UPDATE runs SET status = 'failed', output = 'Server restarted before the run finished' WHERE status = 'running'");
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return db;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await scryptAsync(password, salt, 64)).toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(await scryptAsync(password, Buffer.from(salt, "hex"), 64), Buffer.from(hash, "hex"));
}

async function readJson(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw fail(413, "Body too large");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw fail(400, "Invalid JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

// ponytail: no Secure flag so it works on http://localhost; add `; Secure` once this is served over HTTPS.
const cookie = (value: string, maxAgeSeconds: number) => `session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;

const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100;
const isToolName = (v: string) => /^[a-z][a-z0-9_]{1,63}$/.test(v);
const isEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function createApp({
  db,
  root: rootDir,
  openaiKey,
  model = "gpt-6-luna",
  openai = openAi,
  approvalTimeoutMs = 10 * 60_000,
  sendOtp,
}: {
  db: DatabaseSync;
  /** The only folder the desk agent may touch. */
  root: string;
  openaiKey?: string;
  model?: string;
  openai?: OpenAi;
  approvalTimeoutMs?: number;
  /** Emails a signup code. Without it, signup creates the account at once (no email check). */
  sendOtp?: (to: string, code: string) => Promise<void>;
}) {
  const root = realish(resolve(rootDir));
  const trash = join(root, ".agentops-trash");
  // Off-limits whatever the rules say: the trash, and this app's own folder (its database decides every approval).
  // ponytail: assumes the server runs from the project folder (npm run server does); fence DB_PATH's folder too if you move the DB.
  const fenced = [trash, realish(process.cwd())];

  const q = {
    insertUser: db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)"),
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    userByAgentKey: db.prepare("SELECT id, email FROM users WHERE agent_key_hash = ?"),
    setAgentKey: db.prepare("UPDATE users SET agent_key_hash = ?, agent_key_hint = ? WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
    sessionUser: db.prepare("SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    policy: db.prepare("SELECT action FROM policies WHERE user_id = ? AND tool = ?"),
    policies: db.prepare("SELECT tool, action FROM policies WHERE user_id = ? ORDER BY tool"),
    upsertPolicy: db.prepare("INSERT INTO policies (user_id, tool, action) VALUES (?, ?, ?) ON CONFLICT (user_id, tool) DO UPDATE SET action = excluded.action"),
    deletePolicy: db.prepare("DELETE FROM policies WHERE user_id = ? AND tool = ?"),
    guards: db.prepare("SELECT path, action FROM protected_paths WHERE user_id = ? ORDER BY path"),
    guard: db.prepare("SELECT action FROM protected_paths WHERE user_id = ? AND path = ?"),
    upsertGuard: db.prepare("INSERT INTO protected_paths (user_id, path, action) VALUES (?, ?, ?) ON CONFLICT (user_id, path) DO UPDATE SET action = excluded.action"),
    deleteGuard: db.prepare("DELETE FROM protected_paths WHERE user_id = ? AND path = ?"),
    insertCall: db.prepare("INSERT INTO tool_calls (user_id, agent, tool, args, status, reason, created_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    getCall: db.prepare("SELECT * FROM tool_calls WHERE id = ? AND user_id = ?"),
    setStatus: db.prepare("UPDATE tool_calls SET status = ? WHERE id = ?"),
    audit: db.prepare("INSERT INTO audit_log (user_id, at, actor, event, tool_call_id, detail) VALUES (?, ?, ?, ?, ?, ?)"),
    insertRun: db.prepare("INSERT INTO runs (user_id, agent, task, status, created_at) VALUES (?, ?, ?, 'running', ?)"),
    setRun: db.prepare("UPDATE runs SET status = ?, output = ? WHERE id = ?"),
    getRun: db.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?"),
    latestRun: db.prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT 1"),
    activeRun: db.prepare("SELECT id FROM runs WHERE user_id = ? AND status = 'running' LIMIT 1"),
    runSteps: db.prepare("SELECT id, tool, args, status, reason, created_at FROM tool_calls WHERE run_id = ? ORDER BY id"),
    pendingCount: db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE user_id = ? AND status IN ('pending', 'escalated')"),
    queue: db.prepare("SELECT id, agent, tool, status, reason, created_at FROM tool_calls WHERE user_id = ? AND status IN ('pending', 'escalated') ORDER BY id DESC LIMIT 6"),
    statusCounts: db.prepare("SELECT status, COUNT(*) AS n FROM tool_calls WHERE user_id = ? AND created_at >= ? GROUP BY status"),
    auditCount: db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND at >= ?"),
    recentAudit: db.prepare(
      "SELECT a.at, a.actor, a.event, a.detail, c.tool FROM audit_log a LEFT JOIN tool_calls c ON c.id = a.tool_call_id WHERE a.user_id = ? AND a.at >= ? ORDER BY a.id DESC LIMIT 8",
    ),
    agents: db.prepare(`
      SELECT agent, COUNT(*) AS calls,
        SUM(status IN ('pending', 'escalated')) AS pending,
        SUM(status IN ('blocked', 'rejected')) AS denied
      FROM tool_calls WHERE user_id = ? AND created_at >= ? GROUP BY agent ORDER BY calls DESC LIMIT 6
    `),
  };

  function tx<T>(fn: () => T): T {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const now = () => new Date().toISOString();
  const audit = (userId: number, actor: string, event: string, callId: number | null, detail: string | null) =>
    q.audit.run(userId, now(), actor, event, callId, detail);

  // ponytail: in-memory and per process, so it resets on restart; move to the DB or Redis when running more than one instance.
  const failures = new Map<string, { count: number; until: number }>();
  const dummyHash = hashPassword(randomBytes(16).toString("hex"));
  // ponytail: in memory, so a restart drops unverified signups (they just sign up again). Move to the DB for more than one instance.
  const pendingSignups = new Map<string, { passwordHash: string; code: string; sentAt: number; tries: number }>();

  function startSession(res: ServerResponse, userId: number) {
    const token = randomBytes(32).toString("hex");
    q.insertSession.run(hashToken(token), userId, new Date(Date.now() + SESSION_MS).toISOString());
    res.setHeader("set-cookie", cookie(token, SESSION_MS / 1000));
  }

  function sessionToken(req: IncomingMessage) {
    const pair = req.headers.cookie?.split(";").map((part) => part.trim().split("=")).find(([key]) => key === "session");
    return pair?.[1];
  }

  function identify(req: IncomingMessage): Identity | null {
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    if (bearer?.startsWith("aok_")) {
      const user = q.userByAgentKey.get(hashToken(bearer)) as { id: number; email: string } | undefined;
      return user ? { userId: user.id, email: user.email, role: "agent" } : null;
    }
    const token = sessionToken(req);
    const user = token ? (q.sessionUser.get(hashToken(token), now()) as { id: number; email: string } | undefined) : undefined;
    return user ? { userId: user.id, email: user.email, role: "operator" } : null;
  }

  function policyList(userId: number) {
    return (q.policies.all(userId) as Array<{ tool: string; action: Action }>).map(({ tool, action }) => ({
      tool,
      action,
      kind: CATALOG[tool]?.kind ?? "custom",
      description: CATALOG[tool]?.description ?? "Custom tool for your own agents",
    }));
  }

  // "~/Downloads", "Downloads" and an absolute path all land on the same real path.
  const locate = (path: string) => realish(resolve(root, path.replace(/^~(?=$|[\\/])/, ".")));
  const shown = (path: string) => (within(root, path) ? relative(root, path) || "~" : path);

  function seedDefaults(userId: number) {
    for (const [tool, { action }] of Object.entries(CATALOG)) q.upsertPolicy.run(userId, tool, action);
    for (const [path, action] of DEFAULT_GUARDS) q.upsertGuard.run(userId, locate(path), action);
  }
  // Accounts from before the file tools get the defaults once (a missing list_folder rule marks them). Their old rules stay.
  for (const { id } of db.prepare("SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM policies WHERE tool = 'list_folder')").all() as Array<{ id: number }>) {
    tx(() => seedDefaults(id));
  }

  function guardList(userId: number) {
    return (q.guards.all(userId) as Array<{ path: string; action: Guard }>).map((row) => ({ ...row, label: shown(row.path) }));
  }

  // Tool policy first, then folder rules can only make the answer stricter.
  function judge(userId: number, toolName: string, args: Json): { action: Action; reason: string } {
    const action = (q.policy.get(userId, toolName) as { action: Action } | undefined)?.action;
    if (!action) return { action: "block", reason: "No policy for this tool (default deny)" };
    const spec = CATALOG[toolName];
    if (!spec) return { action, reason: REASON[action] };

    let verdict = { action, reason: REASON[action] };
    const stricter = (next: Action, reason: string) => {
      if (STRICTNESS.indexOf(next) > STRICTNESS.indexOf(verdict.action)) verdict = { action: next, reason };
    };
    for (const key of spec.paths) {
      const raw = args[key];
      if (typeof raw !== "string" || !raw.trim()) return { action: "block", reason: `Missing ${key}` };
      const target = locate(raw.trim());
      if (!within(root, target)) return { action: "block", reason: `Outside the agent folder (${root})` };
      // A read only touches what is inside a folder; a change to a parent (deleting ~) would take the folder with it.
      const touches = (folder: string) => within(folder, target) || (spec.kind !== "read" && within(target, folder));
      if (fenced.some(touches)) return { action: "block", reason: "DeskWarden's own files are off-limits" };
      for (const guard of q.guards.all(userId) as Array<{ path: string; action: Guard }>) {
        const name = shown(guard.path);
        if (!touches(guard.path)) continue;
        if (guard.action === "block") stricter("block", `${name} is off-limits`);
        else if (spec.kind !== "read") {
          stricter(guard.action === "readonly" ? "block" : "approve", guard.action === "readonly" ? `${name} is read-only` : `Changes in ${name} need your approval`);
        }
      }
    }
    return verdict;
  }

  // The one path every tool call takes, whether it comes over HTTP or from the desk agent.
  function submit(userId: number, agent: string, toolName: string, args: Json, runId: number | null) {
    const verdict = judge(userId, toolName, args);
    const status = STATUS[verdict.action];
    const reason = verdict.reason;
    const at = now();
    const id = tx(() => {
      const callId = Number(q.insertCall.run(userId, agent, toolName, JSON.stringify(args), status, reason, at, runId).lastInsertRowid);
      audit(userId, agent, "REQUESTED", callId, null);
      audit(userId, "policy", status.toUpperCase(), callId, reason);
      return callId;
    });
    return { id, status, reason };
  }

  function decide(userId: number, id: number, decision: string, actor: string, detail: string | null) {
    const allowedFrom = DECISIONS[decision];
    if (!allowedFrom) throw fail(400, "decision must be approved, rejected or escalated");
    const call = q.getCall.get(id, userId) as { status: string } | undefined;
    if (!call) throw fail(404, "Tool call not found");
    if (!allowedFrom.includes(call.status)) throw fail(409, `Cannot ${decision} a ${call.status} call`);
    tx(() => {
      q.setStatus.run(decision, id);
      audit(userId, actor, decision.toUpperCase(), id, detail);
    });
  }

  // ponytail: polls SQLite every 500ms per waiting call. Fine for a handful of agents; use an event emitter if many wait at once.
  async function waitForDecision(userId: number, id: number) {
    const deadline = Date.now() + approvalTimeoutMs;
    for (;;) {
      const { status } = q.getCall.get(id, userId) as { status: string };
      if (status !== "pending" && status !== "escalated") return status;
      if (Date.now() > deadline) {
        decide(userId, id, "rejected", "system", "Approval timed out");
        return "rejected";
      }
      await sleep(500);
    }
  }

  async function useTool(userId: number, runId: number, call: OutputItem) {
    let args: Json;
    try {
      args = JSON.parse(call.arguments ?? "{}");
    } catch {
      return { error: "Arguments were not valid JSON" };
    }
    const submitted = submit(userId, AGENT_NAME, call.name ?? "", args, runId);
    const status = submitted.status === "pending" ? await waitForDecision(userId, submitted.id) : submitted.status;
    if (status !== "allowed" && status !== "approved") return { error: `DeskWarden ${status} this call (${submitted.reason}). Do not retry it.` };
    try {
      return execute(call.name!, args);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  // Runs only after judge() said yes, so paths are known to be strings inside the root.
  function execute(toolName: string, args: Json): Json {
    const path = (key: string) => locate(String(args[key]).trim());
    switch (toolName) {
      case "list_folder": {
        const entries = readdirSync(path("path"), { withFileTypes: true });
        return { entries: entries.slice(0, 200).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)), total: entries.length };
      }
      case "read_file": {
        if (statSync(path("path")).size > 5_000_000) return { error: "File is larger than 5 MB" };
        const text = readFileSync(path("path"), "utf8");
        return { content: text.slice(0, MAX_READ), truncated: text.length > MAX_READ };
      }
      case "write_file": {
        mkdirSync(dirname(path("path")), { recursive: true });
        writeFileSync(path("path"), String(args.content));
        return { written: shown(path("path")) };
      }
      case "move_path": {
        // rename() would silently replace an existing file on Windows.
        if (existsSync(path("to"))) return { error: "Destination already exists" };
        mkdirSync(dirname(path("to")), { recursive: true });
        renameSync(path("from"), path("to"));
        return { moved: shown(path("from")), to: shown(path("to")) };
      }
      case "delete_path": {
        // ponytail: a rename into a trash folder, restore by moving it back. Fails across drives (EXDEV); copy+remove if the root spans volumes.
        mkdirSync(trash, { recursive: true });
        const target = path("path");
        renameSync(target, join(trash, `${Date.now()}-${basename(target)}`));
        return { deleted: shown(target), recoverableFrom: trash };
      }
      default:
        // A custom policy can allow a name the desk agent does not implement.
        return { error: `${toolName} is not available to ${AGENT_NAME}` };
    }
  }

  function finishRun(userId: number, runId: number, status: "completed" | "failed", output: string) {
    tx(() => {
      q.setRun.run(status, output, runId);
      audit(userId, AGENT_NAME, status === "completed" ? "RUN COMPLETED" : "RUN FAILED", null, output);
    });
  }

  async function runAgent(userId: number, runId: number, task: string, model: Respond) {
    try {
      let response = await model({ input: [{ role: "user", content: task }] });
      for (let turn = 1; turn <= MAX_TURNS; turn++) {
        const calls = response.output.filter((item) => item.type === "function_call");
        if (calls.length === 0) return finishRun(userId, runId, "completed", outputText(response.output));
        const outputs = [];
        for (const call of calls) {
          outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(await useTool(userId, runId, call)) });
        }
        response = await model({ input: outputs, previousResponseId: response.id });
      }
      finishRun(userId, runId, "failed", `Stopped after ${MAX_TURNS} model turns`);
    } catch (error) {
      finishRun(userId, runId, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  function withSteps(run: Json | undefined) {
    if (!run) return null;
    const steps = (q.runSteps.all(run.id as number) as Array<{ args: string }>).map((step) => ({ ...step, args: JSON.parse(step.args) }));
    return { ...run, steps };
  }

  function account(userId: number) {
    const user = q.userById.get(userId) as Json;
    return {
      user: { id: user.id, email: user.email },
      openai: { configured: Boolean(openaiKey), model },
      root,
      agentKey: { hint: user.agent_key_hint ?? null },
    };
  }

  async function handleAuth(req: IncomingMessage, res: ServerResponse, path: string) {
    if (path === "/api/auth/logout") {
      const token = sessionToken(req);
      if (token) q.deleteSession.run(hashToken(token));
      res.setHeader("set-cookie", cookie("", 0));
      return send(res, 200, { ok: true });
    }

    const { email: rawEmail, password, code } = await readJson(req);
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;
    if (!isEmail(email)) throw fail(400, "Enter a valid email address");

    const createAccount = (hash: string) => {
      if (q.userByEmail.get(email)) throw fail(409, "An account with this email already exists");
      const userId = tx(() => {
        const id = Number(q.insertUser.run(email, hash, now()).lastInsertRowid);
        seedDefaults(id);
        audit(id, email, "ACCOUNT CREATED", null, null);
        return id;
      });
      startSession(res, userId);
      return send(res, 201, account(userId));
    };

    // Step two of signup: the 6-digit code from the email creates the account.
    if (path === "/api/auth/verify") {
      const pending = pendingSignups.get(email);
      if (!pending || Date.now() - pending.sentAt > OTP_MS) {
        pendingSignups.delete(email);
        throw fail(400, "This code has expired. Request a new one.");
      }
      if (typeof code !== "string" || code.trim() !== pending.code) {
        pending.tries += 1;
        if (pending.tries < OTP_TRIES) throw fail(400, `Wrong code. ${OTP_TRIES - pending.tries} tries left.`);
        pendingSignups.delete(email);
        throw fail(400, "Too many wrong codes. Request a new one.");
      }
      pendingSignups.delete(email);
      return createAccount(pending.passwordHash);
    }

    if (typeof password !== "string" || password.length < 8 || password.length > 200) throw fail(400, "Password must be 8-200 characters");

    if (path === "/api/auth/signup") {
      if (q.userByEmail.get(email)) throw fail(409, "An account with this email already exists");
      const hash = await hashPassword(password);
      if (!sendOtp) return createAccount(hash);
      // Signing up again resends a code, at most once a minute so this cannot be used to flood an inbox.
      const previous = pendingSignups.get(email);
      if (previous && Date.now() - previous.sentAt < OTP_RESEND_MS) throw fail(429, "A code was just sent. Wait a minute before asking for another.");
      const otp = randomInt(1_000_000).toString().padStart(6, "0");
      try {
        await sendOtp(email, otp);
      } catch (error) {
        console.error("Could not send the signup code:", error);
        throw fail(502, "Could not send the verification email. Check the SMTP settings on the server.");
      }
      pendingSignups.set(email, { passwordHash: hash, code: otp, sentAt: Date.now(), tries: 0 });
      return send(res, 202, { verify: true, email });
    }

    const failure = failures.get(email);
    if (failure && failure.count >= 10 && failure.until > Date.now()) throw fail(429, "Too many failed attempts. Try again in 15 minutes.");
    const user = q.userByEmail.get(email) as { id: number; password_hash: string } | undefined;
    // Hash against a dummy when the email is unknown so response time does not reveal which emails exist.
    const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
    if (!user || !ok) {
      const fresh = !failure || failure.until < Date.now();
      failures.set(email, fresh ? { count: 1, until: Date.now() + 15 * 60_000 } : { ...failure, count: failure.count + 1 });
      throw fail(401, "Invalid email or password");
    }
    failures.delete(email);
    startSession(res, user.id);
    return send(res, 200, account(user.id));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "POST" && ["/api/auth/signup", "/api/auth/verify", "/api/auth/login", "/api/auth/logout"].includes(path)) return handleAuth(req, res, path);

    const who = identify(req);
    if (!who) throw fail(401, "Unauthorized");
    const { userId } = who;
    const operatorOnly = () => {
      if (who.role !== "operator") throw fail(403, "Sign in to the console to do this; agent keys can only submit and read tool calls");
    };
    const callMatch = path.match(/^\/api\/tool-calls\/(\d+)(\/decision)?$/);
    const runMatch = path.match(/^\/api\/agent-runs\/(\d+)$/);
    const policyMatch = path.match(/^\/api\/policies\/([^/]+)$/);

    if (req.method === "POST" && path === "/api/tool-calls") {
      if (who.role !== "agent") throw fail(403, "Only agents submit tool calls; use an agent key from Settings");
      const { agent, tool: toolName, args = {} } = await readJson(req);
      if (!isName(agent) || !isName(toolName) || typeof args !== "object" || args === null) {
        throw fail(400, "Expected { agent: string, tool: string, args?: object }");
      }
      return send(res, 201, submit(userId, agent, toolName, args, null));
    }

    if (req.method === "GET" && callMatch && !callMatch[2]) {
      const call = q.getCall.get(Number(callMatch[1]), userId) as { args: string } | undefined;
      if (!call) throw fail(404, "Tool call not found");
      return send(res, 200, { ...call, args: JSON.parse(call.args) });
    }

    // Everything below is for the signed-in operator, not for agent keys.
    operatorOnly();

    if (req.method === "GET" && path === "/api/me") return send(res, 200, account(userId));

    if (req.method === "POST" && callMatch?.[2]) {
      const { decision } = await readJson(req);
      const id = Number(callMatch[1]);
      decide(userId, id, decision, who.email, null);
      return send(res, 200, { id, status: decision });
    }

    if (req.method === "POST" && path === "/api/settings/agent-key") {
      const key = `aok_${randomBytes(24).toString("hex")}`;
      q.setAgentKey.run(hashToken(key), `aok_...${key.slice(-4)}`, userId);
      audit(userId, who.email, "AGENT KEY ROTATED", null, null);
      // The only time the full key leaves the server: only its hash is stored.
      return send(res, 201, { key, ...account(userId) });
    }

    if (req.method === "GET" && path === "/api/policies") return send(res, 200, policyList(userId));

    if (policyMatch && (req.method === "PUT" || req.method === "DELETE")) {
      const toolName = decodeURIComponent(policyMatch[1]);
      if (!isToolName(toolName)) throw fail(400, "Tool names use lowercase letters, digits and underscores (2-64 characters)");
      const before = (q.policy.get(userId, toolName) as { action: Action } | undefined)?.action ?? "deny";
      if (req.method === "DELETE") {
        q.deletePolicy.run(userId, toolName);
        audit(userId, who.email, "POLICY REMOVED", null, `${toolName}: ${before} -> deny`);
      } else {
        const { action } = await readJson(req);
        if (!ACTIONS.includes(action)) throw fail(400, "action must be allow, approve or block");
        q.upsertPolicy.run(userId, toolName, action);
        audit(userId, who.email, "POLICY CHANGED", null, `${toolName}: ${before} -> ${action}`);
      }
      return send(res, 200, policyList(userId));
    }

    if (path === "/api/folders" && ["GET", "PUT", "DELETE"].includes(req.method!)) {
      if (req.method !== "GET") {
        const { path: raw, action } = await readJson(req);
        if (typeof raw !== "string" || !raw.trim() || raw.length > 500) throw fail(400, "Enter a folder path");
        const target = locate(raw.trim());
        if (!within(root, target)) throw fail(400, `Pick a folder inside ${root}`);
        const before = (q.guard.get(userId, target) as { action: Guard } | undefined)?.action ?? "none";
        if (req.method === "DELETE") {
          q.deleteGuard.run(userId, target);
          audit(userId, who.email, "FOLDER RULE REMOVED", null, `${shown(target)}: ${before} -> none`);
        } else {
          if (!GUARDS.includes(action)) throw fail(400, "action must be readonly, approve or block");
          q.upsertGuard.run(userId, target, action);
          audit(userId, who.email, "FOLDER RULE CHANGED", null, `${shown(target)}: ${before} -> ${action}`);
        }
      }
      return send(res, 200, guardList(userId));
    }

    if (req.method === "POST" && path === "/api/agent-runs") {
      if (!openaiKey) throw fail(409, "Add OPENAI_API_KEY to .env.local and restart the server");
      const { task } = await readJson(req);
      if (typeof task !== "string" || !task.trim() || task.length > 500) throw fail(400, "task must be 1-500 characters");
      // One run at a time per account keeps model spend predictable.
      if (q.activeRun.get(userId)) throw fail(409, "An agent run is already in progress");
      const llm = openai.respond(openaiKey, model, instructionsFor(root));
      const id = tx(() => {
        const runId = Number(q.insertRun.run(userId, AGENT_NAME, task.trim(), now()).lastInsertRowid);
        audit(userId, AGENT_NAME, "RUN STARTED", null, task.trim());
        return runId;
      });
      void runAgent(userId, id, task.trim(), llm);
      return send(res, 201, { id });
    }

    if (req.method === "GET" && runMatch) {
      const run = withSteps(q.getRun.get(Number(runMatch[1]), userId) as Json | undefined);
      if (!run) throw fail(404, "Run not found");
      return send(res, 200, run);
    }

    if (req.method === "GET" && path === "/api/dashboard") {
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 168, 1), 24 * 365);
      const since = new Date(Date.now() - hours * 3_600_000).toISOString();
      const counts = q.statusCounts.all(userId, since) as Array<{ status: string; n: number }>;
      return send(res, 200, {
        hours,
        pending: (q.pendingCount.get(userId) as { n: number }).n,
        queue: q.queue.all(userId),
        audit: q.recentAudit.all(userId, since),
        auditEvents: (q.auditCount.get(userId, since) as { n: number }).n,
        stats: Object.fromEntries(counts.map(({ status, n }) => [status, n])),
        agents: q.agents.all(userId, since),
        policies: policyList(userId),
        folders: guardList(userId),
        run: withSteps(q.latestRun.get(userId) as Json | undefined),
        agentEnabled: Boolean(openaiKey),
      });
    }

    throw fail(404, "Not found");
  }

  return createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = typeof error.status === "number" ? error.status : 500;
      if (status === 500) console.error(error);
      send(res, status, { error: status === 500 ? "Internal error" : error.message });
    });
  });
}

if (import.meta.main) {
  const { OPENAI_API_KEY, OPENAI_MODEL, PORT = "8787", DB_PATH = "agentops.db" } = process.env;
  const AGENT_ROOT = process.env.AGENT_ROOT || homedir();
  if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY is not set: the gateway works, but DeskAgent cannot run (see .env.example).");
  const { SMTP_USER, SMTP_PASS, SMTP_HOST = "smtp.gmail.com", SMTP_PORT = "465" } = process.env;
  const smtp = SMTP_USER && SMTP_PASS ? { host: SMTP_HOST, port: Number(SMTP_PORT), user: SMTP_USER, pass: SMTP_PASS } : null;
  if (!smtp) console.warn("SMTP_USER / SMTP_PASS are not set: signup creates accounts without an email code (see .env.example).");
  const sendOtp = smtp
    ? (to: string, code: string) =>
        sendMail(smtp, to, `${code} is your DeskWarden code`, `Your DeskWarden verification code is ${code}.\r\nIt expires in 10 minutes. If you did not sign up, ignore this email.`)
    : undefined;
  const app = createApp({ db: openDb(DB_PATH), root: AGENT_ROOT, openaiKey: OPENAI_API_KEY, model: OPENAI_MODEL || undefined, sendOtp });
  // Loopback only: this server can change files on this computer, so nothing else on the network may reach it.
  app.listen(Number(PORT), "127.0.0.1", () => console.log(`DeskWarden API on http://127.0.0.1:${PORT}, agent folder ${AGENT_ROOT}`));
}
