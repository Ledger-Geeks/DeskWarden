import { useCallback, useEffect, useState } from "react";

export type LiveCall = { id: number; agent: string; tool: string; status: string; reason: string; created_at: string };
export type LiveAudit = { at: string; actor: string; event: string; detail: string | null; tool: string | null };
export type LiveStep = { id: number; tool: string; args: Record<string, unknown>; status: string; reason: string; created_at: string };
export type LiveRun = { id: number; agent: string; task: string; status: string; output: string | null; created_at: string; steps: LiveStep[] };
export type PolicyAction = "allow" | "approve" | "block";
export type LivePolicy = { tool: string; action: PolicyAction; kind: "read" | "write" | "delete" | "custom"; description: string };
export type FolderAction = "readonly" | "approve" | "block";
export type LiveFolder = { path: string; label: string; action: FolderAction };
export type LiveAgent = { agent: string; calls: number; pending: number; denied: number };
export type LiveData = {
  hours: number;
  pending: number;
  queue: LiveCall[];
  audit: LiveAudit[];
  auditEvents: number;
  stats: Record<string, number>;
  agents: LiveAgent[];
  policies: LivePolicy[];
  folders: LiveFolder[];
  run: LiveRun | null;
  agentEnabled: boolean;
};
export type Account = {
  user: { id: number; email: string };
  openai: { configured: boolean; model: string };
  /** The only folder DeskAgent may touch. */
  root: string;
  agentKey: { hint: string | null };
};

export const RANGES = { "Last 24 hours": 24, "Last 7 days": 168, "Last 30 days": 720 } as const;
export type RangeLabel = keyof typeof RANGES;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UNREACHABLE = "Backend not reachable. Start it with npm run server (see the quickstart).";

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  const data = await res.json().catch(() => null);
  // No JSON body means the response did not come from the DeskWarden server (static host or a dead proxy target).
  if (data === null) throw new ApiError(res.status, UNREACHABLE);
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

export const auth = {
  me: () => api<Account>("/api/me"),
  // With SMTP on the server, signup emails a code instead of creating the account.
  signup: (email: string, password: string) => api<Account | { verify: true; email: string }>("/api/auth/signup", "POST", { email, password }),
  verify: (email: string, code: string) => api<Account>("/api/auth/verify", "POST", { email, code }),
  login: (email: string, password: string) => api<Account>("/api/auth/login", "POST", { email, password }),
  logout: () => api("/api/auth/logout", "POST"),
};

export const settings = {
  rotateAgentKey: () => api<Account & { key: string }>("/api/settings/agent-key", "POST"),
};

export const policies = {
  list: () => api<LivePolicy[]>("/api/policies"),
  set: (tool: string, action: PolicyAction) => api<LivePolicy[]>(`/api/policies/${encodeURIComponent(tool)}`, "PUT", { action }),
  remove: (tool: string) => api<LivePolicy[]>(`/api/policies/${encodeURIComponent(tool)}`, "DELETE"),
};

export const folders = {
  list: () => api<LiveFolder[]>("/api/folders"),
  set: (path: string, action: FolderAction) => api<LiveFolder[]>("/api/folders", "PUT", { path, action }),
  remove: (path: string) => api<LiveFolder[]>("/api/folders", "DELETE", { path }),
};

export const decide = (id: number, decision: string) => api(`/api/tool-calls/${id}/decision`, "POST", { decision });
export const startRun = (task: string) => api<{ id: number }>("/api/agent-runs", "POST", { task });

// Polls the signed-in account's dashboard; faster while an agent run is in flight.
export function useLive(hours: number, onUnauthorized: () => void) {
  const [live, setLive] = useState<LiveData | null>(null);
  const reload = useCallback(() => {
    api<LiveData>(`/api/dashboard?hours=${hours}`).then(setLive, (error: ApiError) => {
      if (error.status === 401) onUnauthorized();
    });
  }, [hours, onUnauthorized]);
  const running = live?.run?.status === "running";

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, running ? 1500 : 5000);
    return () => window.clearInterval(timer);
  }, [reload, running]);

  return { live, reload };
}

const BASE = import.meta.env.BASE_URL; // "/deskwarden/"

/** The URL of an app route: appUrl("/signup") is "/deskwarden/signup". */
export const appUrl = (route: string) => BASE + route.replace(/^\//, "");

const readRoute = () => {
  // Old hash links (#/signup) still open the right page, on load or when clicked later.
  if (window.location.hash.startsWith("#/")) window.history.replaceState(null, "", appUrl(window.location.hash.slice(1)));
  const path = window.location.pathname;
  return `/${path.startsWith(BASE) ? path.slice(BASE.length).replace(/\/$/, "") : ""}`;
};

export const navigate = (route: string) => {
  window.history.pushState(null, "", appUrl(route));
  window.dispatchEvent(new PopStateEvent("popstate"));
};

// Path routes ("/login", "/app/policies") under the Vite base; plain anchors like "#docs" stay on the landing page.
// ponytail: refreshing a deep link needs the host to serve index.html for every path. Vite dev/preview do; GitHub Pages needs a 404.html copy.
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    // Links inside the app change the route without reloading the page.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a");
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith(BASE)) return;
      if (url.hash && url.pathname === window.location.pathname) return; // "#docs": let the browser scroll
      event.preventDefault();
      navigate(url.pathname.slice(BASE.length - 1));
    };
    window.addEventListener("popstate", onChange);
    window.addEventListener("hashchange", onChange);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("hashchange", onChange);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return route;
}
