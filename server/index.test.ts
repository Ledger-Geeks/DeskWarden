import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp, openDb, type OpenAi } from "./index.ts";

type Auth = { cookie?: string; bearer?: string };

// A throwaway "home folder" with a Downloads file and a notes folder.
function makeRoot(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "agentops-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "Downloads"));
  writeFileSync(join(root, "Downloads", "setup.exe"), "binary");
  mkdirSync(join(root, "notes"));
  writeFileSync(join(root, "notes", "old.txt"), "stale");
  return root;
}

async function start(t: TestContext, options: { openai?: OpenAi; openaiKey?: string; sendOtp?: (to: string, code: string) => Promise<void> } = {}) {
  const db = openDb(":memory:");
  const root = makeRoot(t);
  const server = createApp({ db, root, ...options }).listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, auth: Auth = {}, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (auth.cookie) headers.cookie = auth.cookie;
    if (auth.bearer) headers.authorization = `Bearer ${auth.bearer}`;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json(), setCookie: res.headers.get("set-cookie") };
  };

  // Sign up, then hand back a session cookie and a fresh agent key for that account.
  const account = async (email: string) => {
    const signup = await call("POST", "/api/auth/signup", {}, { email, password: "correct horse battery" });
    assert.equal(signup.status, 201);
    const session = { cookie: signup.setCookie!.split(";")[0] };
    const { body } = await call("POST", "/api/settings/agent-key", session);
    return { session, agent: { bearer: body.key as string } };
  };

  return { db, root, call, account };
}

async function until<T>(check: () => Promise<T | undefined | false>) {
  for (let i = 0; i < 60; i++) {
    const value = await check();
    if (value) return value;
    await sleep(100);
  }
  throw new Error("Timed out waiting for condition");
}

test("accounts: signup, login, logout, lockout", async (t) => {
  const { call, account } = await start(t);
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("POST", "/api/auth/signup", {}, { email: "bad", password: "correct horse battery" })).status, 400);
  assert.equal((await call("POST", "/api/auth/signup", {}, { email: "a@b.co", password: "short" })).status, 400);

  const { session } = await account("Dana@Example.com");
  const me = await call("GET", "/api/me", session);
  assert.equal(me.body.user.email, "dana@example.com", "emails are normalized");
  assert.equal(me.body.openai.configured, false);
  assert.match((await call("POST", "/api/auth/signup", {}, { email: "dana@example.com", password: "another password" })).body.error, /already exists/);

  const signupCookie = (await call("POST", "/api/auth/login", {}, { email: "dana@example.com", password: "correct horse battery" })).setCookie!;
  assert.match(signupCookie, /HttpOnly; SameSite=Strict/);

  await call("POST", "/api/auth/logout", session);
  assert.equal((await call("GET", "/api/me", session)).status, 401, "logout kills the session");

  for (let i = 0; i < 10; i++) {
    assert.equal((await call("POST", "/api/auth/login", {}, { email: "dana@example.com", password: "wrong password" })).status, 401);
  }
  assert.equal((await call("POST", "/api/auth/login", {}, { email: "dana@example.com", password: "correct horse battery" })).status, 429);
});

test("signup with an email code: no account until the code matches", async (t) => {
  const sent: Array<{ to: string; code: string }> = [];
  const { call } = await start(t, { sendOtp: async (to, code) => void sent.push({ to, code }) });
  const creds = { email: "Lee@Example.com", password: "correct horse battery" };

  const signup = await call("POST", "/api/auth/signup", {}, creds);
  assert.equal(signup.status, 202);
  assert.deepEqual(signup.body, { verify: true, email: "lee@example.com" });
  assert.equal(signup.setCookie, null, "no session before the code");
  assert.equal(sent.length, 1);
  assert.match(sent[0].code, /^\d{6}$/);
  assert.equal((await call("POST", "/api/auth/login", {}, creds)).status, 401, "the account does not exist yet");
  assert.equal((await call("POST", "/api/auth/signup", {}, creds)).status, 429, "resend is rate limited");

  const wrong = sent[0].code === "000000" ? "111111" : "000000";
  const miss = await call("POST", "/api/auth/verify", {}, { email: creds.email, code: wrong });
  assert.equal(miss.status, 400);
  assert.match(miss.body.error, /4 tries left/);

  const ok = await call("POST", "/api/auth/verify", {}, { email: creds.email, code: sent[0].code });
  assert.equal(ok.status, 201);
  assert.equal((await call("GET", "/api/me", { cookie: ok.setCookie!.split(";")[0] })).body.user.email, "lee@example.com");
  assert.equal((await call("POST", "/api/auth/verify", {}, { email: creds.email, code: sent[0].code })).status, 400, "a code works once");

  // Five wrong codes burn the code.
  await call("POST", "/api/auth/signup", {}, { email: "kim@example.com", password: "correct horse battery" });
  const kim = sent[1];
  for (let i = 0; i < 5; i++) await call("POST", "/api/auth/verify", {}, { email: kim.to, code: kim.code === "000000" ? "111111" : "000000" });
  assert.equal((await call("POST", "/api/auth/verify", {}, { email: kim.to, code: kim.code })).status, 400);

  // A failing mailer creates nothing and says so.
  const broken = await start(t, { sendOtp: async () => Promise.reject(new Error("535 bad password")) });
  assert.equal((await broken.call("POST", "/api/auth/signup", {}, creds)).status, 502);
});

test("tool calls are gated by each account's own policies", async (t) => {
  const { db, call, account } = await start(t);
  const dana = await account("dana@example.com");
  const omar = await account("omar@example.com");
  const submit = (who: Auth, tool: string, args: object = { path: "notes/todo.txt", content: "hi" }) =>
    call("POST", "/api/tool-calls", who, { agent: "SupportAgent", tool, args });

  assert.equal((await submit({ bearer: "aok_wrong" }, "list_folder")).status, 401);
  assert.equal((await submit(dana.session, "list_folder")).status, 403, "sessions do not submit tool calls");
  assert.equal((await call("GET", "/api/dashboard", dana.agent)).status, 403, "agent keys cannot read the dashboard");

  assert.equal((await submit(dana.agent, "list_folder")).body.status, "allowed");
  assert.equal((await submit(dana.agent, "delete_path", { path: "Downloads" })).body.status, "blocked");
  assert.equal((await submit(dana.agent, "rm_rf_everything")).body.status, "blocked", "unknown tools are denied");

  const { body: pending } = await submit(dana.agent, "write_file");
  assert.equal(pending.status, "pending");
  const decide = (who: Auth, decision: string) => call("POST", `/api/tool-calls/${pending.id}/decision`, who, { decision });
  assert.equal((await decide(dana.agent, "approved")).status, 403, "an agent cannot approve its own call");
  assert.equal((await decide(omar.session, "approved")).status, 404, "other accounts cannot see the call");
  assert.equal((await call("GET", `/api/tool-calls/${pending.id}`, omar.agent)).status, 404);
  assert.equal((await decide(dana.session, "escalated")).status, 200);
  assert.equal((await decide(dana.session, "approved")).status, 200);
  assert.equal((await decide(dana.session, "rejected")).status, 409, "decided calls stay decided");
  assert.equal((await call("GET", `/api/tool-calls/${pending.id}`, dana.agent)).body.status, "approved");

  // Read stays open, write gets locked down: the editor changes behaviour immediately.
  assert.equal((await call("PUT", "/api/policies/write_file", dana.session, { action: "block" })).status, 200);
  assert.equal((await submit(dana.agent, "write_file")).body.status, "blocked");
  assert.equal((await submit(omar.agent, "write_file")).body.status, "pending", "policies are per account");
  assert.equal((await call("PUT", "/api/policies/query_db", dana.session, { action: "allow" })).body.find((p: { tool: string }) => p.tool === "query_db").kind, "custom");
  assert.equal((await submit(dana.agent, "query_db")).body.status, "allowed");
  await call("DELETE", "/api/policies/query_db", dana.session);
  assert.equal((await submit(dana.agent, "query_db")).body.status, "blocked", "removing a rule falls back to deny");
  assert.equal((await call("PUT", "/api/policies/Bad-Name", dana.session, { action: "allow" })).status, 400);
  assert.equal((await call("PUT", "/api/policies/write_file", dana.session, { action: "maybe" })).status, 400);

  const dashboard = await call("GET", "/api/dashboard?hours=24", dana.session);
  assert.deepEqual(dashboard.body.stats, { allowed: 2, blocked: 4, approved: 1 });
  assert.ok(dashboard.body.audit.some((row: { event: string }) => row.event === "POLICY REMOVED"));
  assert.equal((await call("GET", "/api/dashboard", omar.session)).body.stats.approved, undefined, "dashboards are per account");

  assert.throws(() => db.exec("DELETE FROM audit_log"), /append-only/);
  assert.throws(() => db.exec("UPDATE audit_log SET actor = 'x'"), /append-only/);
});

test("folder rules: read-only, off-limits, approval, and no way around them", async (t) => {
  const { root, call, account } = await start(t);
  const { session, agent } = await account("dana@example.com");
  const check = async (tool: string, args: object) => (await call("POST", "/api/tool-calls", agent, { agent: "Script", tool, args })).body;

  assert.deepEqual(
    (await call("GET", "/api/folders", session)).body.map((f: { label: string; action: string }) => [f.label, f.action]),
    [[".ssh", "block"], ["AppData", "block"], ["Downloads", "readonly"]],
    "new accounts start with sensitive folders protected",
  );
  assert.equal((await check("list_folder", { path: "Downloads" })).status, "allowed", "read-only still allows reads");
  const blocked = await check("delete_path", { path: "~/Downloads/setup.exe" });
  assert.deepEqual([blocked.status, blocked.reason], ["blocked", "Downloads is read-only"]);
  assert.equal((await check("delete_path", { path: "~" })).status, "blocked", "deleting a parent would delete Downloads");
  assert.equal((await check("move_path", { from: "notes/old.txt", to: "Downloads/old.txt" })).status, "blocked", "moving into it is a change too");
  assert.equal((await check("read_file", { path: ".ssh/id_rsa" })).reason, ".ssh is off-limits");
  assert.equal((await check("list_folder", { path: "~" })).status, "allowed", "listing a parent does not read .ssh");
  assert.match((await check("read_file", { path: "../../etc/passwd" })).reason, /Outside the agent folder/);
  assert.equal((await check("delete_path", { path: ".agentops-trash" })).status, "blocked", "the trash is fenced");
  assert.equal((await check("write_file", { content: "no path" })).reason, "Missing path");
  if (process.platform === "win32") assert.equal((await check("delete_path", { path: "DOWNLOADS/setup.exe" })).status, "blocked", "case does not matter on Windows");

  // A link inside the root that points at Downloads resolves to Downloads.
  symlinkSync(join(root, "Downloads"), join(root, "shortcut"), "junction");
  assert.equal((await check("delete_path", { path: "shortcut/setup.exe" })).reason, "Downloads is read-only");

  assert.equal((await call("PUT", "/api/folders", session, { path: "Downloads", action: "approve" })).status, 200);
  assert.equal((await check("delete_path", { path: "Downloads/setup.exe" })).status, "pending");
  assert.equal((await call("PUT", "/api/folders", session, { path: "/somewhere/else", action: "block" })).status, 400);
  assert.equal((await call("PUT", "/api/folders", session, { path: "notes", action: "nuke" })).status, 400);
  const afterDelete = (await call("DELETE", "/api/folders", session, { path: "~/.ssh" })).body;
  assert.ok(!afterDelete.some((f: { label: string }) => f.label === ".ssh"));
});

test("the desk agent uses the env OpenAI key and only touches files the rules allow", async (t) => {
  const usedKeys: string[] = [];
  const turns = [
    {
      id: "resp_1",
      output: [
        { type: "function_call", call_id: "c1", name: "list_folder", arguments: '{"path":"Downloads"}' },
        { type: "function_call", call_id: "c2", name: "delete_path", arguments: '{"path":"Downloads/setup.exe"}' },
        { type: "function_call", call_id: "c3", name: "write_file", arguments: '{"path":"notes/todo.txt","content":"buy milk"}' },
        { type: "function_call", call_id: "c4", name: "delete_path", arguments: '{"path":"notes/old.txt"}' },
      ],
    },
    { id: "resp_2", output: [{ type: "message", content: [{ type: "output_text", text: "Downloads is protected, so I left it. Wrote the todo." }] }] },
  ];
  const openai: OpenAi = {
    respond: (key) => {
      usedKeys.push(key);
      return async () => turns.shift()!;
    },
  };

  const offline = await start(t);
  const nobody = await offline.account("omar@example.com");
  assert.equal((await offline.call("POST", "/api/agent-runs", nobody.session, { task: "Tidy up" })).status, 409, "no key, no agent");

  const { root, call, account } = await start(t, { openai, openaiKey: "sk-env-key" });
  const { session } = await account("dana@example.com");
  assert.deepEqual((await call("GET", "/api/me", session)).body.openai, { configured: true, model: "gpt-6-luna" });

  const { body: run } = await call("POST", "/api/agent-runs", session, { task: "Delete my Downloads installer and note what to buy" });
  for (let i = 0; i < 2; i++) {
    const pendingId = await until(async () => (await call("GET", "/api/dashboard", session)).body.queue[0]?.id);
    await call("POST", `/api/tool-calls/${pendingId}/decision`, session, { decision: "approved" });
  }
  const done = await until(async () => {
    const { body } = await call("GET", `/api/agent-runs/${run.id}`, session);
    return body.status !== "running" && body;
  });
  assert.equal(done.status, "completed");
  assert.deepEqual(done.steps.map((s: { status: string }) => s.status), ["allowed", "blocked", "approved", "approved"]);
  assert.ok(existsSync(join(root, "Downloads", "setup.exe")), "the protected file is untouched");
  assert.equal(readFileSync(join(root, "notes", "todo.txt"), "utf8"), "buy milk");
  assert.ok(!existsSync(join(root, "notes", "old.txt")));
  assert.match(readdirSync(join(root, ".agentops-trash"))[0], /-old\.txt$/, "deletes are recoverable from the trash");
  assert.deepEqual(usedKeys, ["sk-env-key"]);
});

test("accounts from before the file tools get the default rules once", (t) => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('old@example.com', 'x:y', '2026-01-01')").run();
  db.prepare("INSERT INTO policies (user_id, tool, action) VALUES (1, 'search_orders', 'allow')").run();
  createApp({ db, root: makeRoot(t) });
  createApp({ db, root: makeRoot(t) });
  const tools = (db.prepare("SELECT tool FROM policies ORDER BY tool").all() as Array<{ tool: string }>).map((row) => row.tool);
  assert.deepEqual(tools, ["delete_path", "list_folder", "move_path", "read_file", "search_orders", "write_file"], "old rules are kept");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM protected_paths").get() as { n: number }).n, 3, "seeded once, not twice");
});
