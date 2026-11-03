# DeskWarden

Ultra-premium SaaS landing page and interactive product preview for an AI agent governance platform.

DeskWarden presents a control layer for AI agent workflows: secure tool access, policy enforcement, human approvals, audit logs, observability, risk scoring, and evaluation scorecards.

[Live demo](https://danieloza.github.io/deskwarden/)

![DeskWarden preview](docs/preview.png)

## Highlights

- Premium dark enterprise SaaS landing page
- Embedded interactive dashboard preview
- Sidebar-driven dashboard views for overview, agents, metrics, policies, audit, approvals, and risk
- Working time range selector, refresh action, panel actions, and approval decisions
- Tooltip guidance for dashboard controls
- Responsive React + TypeScript + Tailwind implementation

## Why It Matters

AI agents become operational systems once they can access tools, data, and business workflows. At that point, teams need more than a prompt interface: they need policy boundaries, human approval paths, audit logs, risk visibility, and evaluation signals.

DeskWarden demonstrates the product surface for that control layer. It shows how agent runs can be reviewed through approvals, secure tool access, incident signals, risk scoring, and evaluation scorecards before sensitive automation is trusted in production-like workflows.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- lucide-react

## Local Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Backend

`server/index.ts` is a multi-account tool-call gateway. Before an agent runs a tool, it asks the gateway. The gateway checks that account's policy, holds risky calls for a human, and writes every step to an append-only audit log. It uses only Node built-ins (`node:http`, `node:sqlite`, `node:crypto`) and requires Node 24.2+.

```
Your agent ──POST /api/tool-calls (agent key)──▶ your policy ──▶ allowed | blocked | pending
     ▲                                                                   │
     └──GET /api/tool-calls/:id (poll)◀── you, signed in: approve | reject | escalate
```

The workflow in the app (`/signup`, then `/app`):

1. **Create an account.** Passwords are hashed with scrypt; sessions are HttpOnly, SameSite=Strict cookies. Ten failed logins lock an email for 15 minutes.
2. **Add your OpenAI key** to `.env.local` as `OPENAI_API_KEY`. Only the server reads it; it never reaches the browser or the database.
3. **Set guardrails.** Tool rules (allow, ask first, block) decide what the agent may do; folder rules (read-only, ask first, off-limits) decide where. The stricter one wins, and tools without a rule are denied. New accounts start with `.ssh` and `AppData` off-limits and `Downloads` read-only. Every change is audited.
4. **Run and monitor.** Give DeskAgent a mission in Mission control, or generate an agent key in Settings and send calls from your own agent. Approve held calls as they arrive.

Every row (tool calls, runs, policies, audit events) belongs to one account and every query is scoped to it.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/signup`, `/login`, `/logout` | none | Create an account or start/end a session |
| `POST /api/tool-calls` `{agent, tool, args}` | agent key | Submit a call for a policy decision |
| `GET /api/tool-calls/:id` | agent key or session | Poll until `approved` / `rejected` |
| `POST /api/tool-calls/:id/decision` `{decision}` | session | `approved`, `rejected` or `escalated` |
| `GET /api/policies`, `PUT` / `DELETE /api/policies/:tool` | session | Read or change tool permissions |
| `GET /api/folders`, `PUT` / `DELETE /api/folders` `{path, action?}` | session | Protect a folder: `readonly`, `approve` or `block` |
| `POST /api/settings/agent-key` | session | Generate or rotate the agent key (shown once) |
| `POST /api/agent-runs` `{task}`, `GET /api/agent-runs/:id` | session | Run DeskAgent and read its steps |
| `GET /api/me`, `GET /api/dashboard?hours=168` | session | Account status; queue, audit, stats, latest run |

```bash
cp .env.example .env.local   # set OPENAI_API_KEY
npm run server               # API on 127.0.0.1:8787
npm run dev            # open http://localhost:5173/deskwarden/signup
npm test               # uses a scripted model, never calls OpenAI
```

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | to run DeskAgent | Server-side only. Never prefix it with `VITE_` |
| `OPENAI_MODEL` | no | Default `gpt-6-luna` |
| `AGENT_ROOT` | no | The only folder DeskAgent may touch. Default: your home folder |
| `SMTP_USER`, `SMTP_PASS` | no | When set, signup emails a 6-digit code (10 min, 5 tries, resend once a minute) and the account is created only after `POST /api/auth/verify` `{email, code}` |
| `SMTP_HOST`, `SMTP_PORT` | no | Default `smtp.gmail.com` and `465` (implicit TLS only) |
| `PORT`, `DB_PATH` | no | Default `8787` and `agentops.db` |

### DeskAgent

DeskAgent calls the OpenAI Responses API with five real file tools: `list_folder`, `read_file`, `write_file`, `move_path` and `delete_path`. Each call goes through the same policy path as `POST /api/tool-calls`, so approval-gated calls wait (up to 10 minutes, then auto-reject).

Safety rails that no rule can turn off:

- Paths outside `AGENT_ROOT`, the project folder and the trash are always refused.
- Links and junctions are resolved first, so a shortcut cannot reach a protected folder. Changing a parent (deleting `~`) counts as changing every protected folder inside it.
- `delete_path` moves things to `AGENT_ROOT/.agentops-trash`; restore by moving them back.
- The server listens on 127.0.0.1 only.

File names and contents DeskAgent reads are sent to OpenAI as part of the task.

The GitHub Pages build is the static landing page and demo console. Accounts and the app need the local backend.

## Project Intent

This project is part of a practical AI systems portfolio focused on agent operations, governance, approvals, auditability, observability, and production-oriented control layers.

## License

MIT
