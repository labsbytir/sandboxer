import type { CloudProvider, Plan, Server } from "../core/contracts";
export class UpCloud implements CloudProvider {
  constructor(
    private token: string,
    private transport: typeof fetch = fetch,
  ) {}
  async request<T = unknown>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const res = await this.transport("https://api.upcloud.com/1.3" + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(18000),
    });
    if (!res.ok)
      throw new Error(`UpCloud ${method} ${path}: HTTP ${res.status}`);
    return (res.status === 204 ? null : await res.json()) as T;
  }
  async listServers() {
    return (await this.request<{ servers: { server: Server[] } }>("/server"))
      .servers.server;
  }
  async listPlans() {
    return (await this.request<{ plans: { plan: Plan[] } }>("/plan")).plans
      .plan;
  }
  action(id: string, action: "start" | "stop" | "restart") {
    return this.request(
      `/server/${encodeURIComponent(id)}/${action}`,
      "POST",
      action === "start"
        ? undefined
        : { [action + "_server"]: { stop_type: "soft", timeout: 120 } },
    );
  }
  create(body: unknown) {
    return this.request<{ server: Server }>("/server", "POST", {
      server: body,
    });
  }
  listClusters() {
    return this.request<
      Array<{
        uuid: string;
        name: string;
        state: string;
        zone: string;
        node_groups: Array<{ name: string; count: number }>;
      }>
    >("/kubernetes");
  }
  cluster(id: string, suffix = "", method = "GET", body?: unknown) {
    return this.request(
      `/kubernetes/${encodeURIComponent(id)}${suffix}`,
      method,
      body,
    );
  }
  createServerToken(id: string, ip: string) {
    return this.request<{ id: string; token: string }>(
      "/account/tokens",
      "POST",
      {
        name: `sandboxer-${id}`,
        expires_in: "720h",
        can_create_tokens: false,
        allowed_ip_ranges: [ip + "/32"],
      },
    );
  }
}
