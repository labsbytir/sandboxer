import { z } from "zod";
export const identifier = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
export const environmentId = z.string().regex(/^env-[a-f0-9]{16}$/);
export const presetSizes = [
  { cores: 2, memory: 4096 },
  { cores: 2, memory: 8192 },
  { cores: 4, memory: 8192 },
  { cores: 4, memory: 16384 },
];
export const settingsSchema = z.object({
  zone: z.string().default("us-nyc1"),
  domain: z.literal("tirbox.site").default("tirbox.site"),
  idleMinutes: z.number().int().min(0).max(10080).default(30),
  vaultPath: z.string().default(""),
  controllerUrl: z
    .union([z.literal(""), z.url().startsWith("https://")])
    .default(""),
  cloudflareZoneId: z.string().default(""),
  r2AccountId: z.string().default(""),
  r2Bucket: z.string().default("sandboxer-workspaces"),
});
export type Settings = z.infer<typeof settingsSchema>;
export interface Environment {
  id: string;
  serverId: string;
  name: string;
  zone: string;
  plan: string;
  createdAt: string;
  idleMinutes: number;
  host?: string;
  sshUser: string;
  credentialId: string;
  childTokenId?: string;
}
export interface Server {
  uuid: string;
  title: string;
  state: string;
  zone: string;
  plan?: string;
  ip_addresses?: {
    ip_address: { address: string; access: string; family: string }[];
  };
}
export interface Plan {
  name: string;
  core_number: number;
  memory_amount: number;
  storage_size: number;
}
export interface Template {
  id: string;
  name: string;
  description: string;
  cloudInit: string;
  digest: string;
  source: string;
}
export interface PluginManifest {
  apiVersion: 1;
  id: string;
  version: string;
  kind: "cloud" | "observability" | "agent" | "chat" | "templates" | "storage";
  entry: string;
  capabilities: string[];
  credentialFields: { id: string; secret: boolean }[];
}
export interface CloudProvider {
  listServers(): Promise<Server[]>;
  listPlans(): Promise<Plan[]>;
  action(id: string, action: "start" | "stop" | "restart"): Promise<unknown>;
}
export interface ObservabilityProvider {
  ingest(events: Telemetry[]): Promise<void>;
  query(sql: string): Promise<unknown>;
  report(environmentId: string, from: string, to: string): Promise<string>;
}
export interface Telemetry {
  environment_id: string;
  run_id?: string;
  timestamp: string;
  kind: string;
  message?: string;
  cpu_load?: number;
  memory_used_pct?: number;
  disk_used_pct?: number;
}
export interface AgentRuntime {
  id: string;
  installScript(): string;
  startScript(projectPath: string): string;
  healthCommand(): string;
}
export interface TemplateSource {
  list(): Promise<Template[]>;
}
export interface StorageProvider {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}
export interface Activity {
  lastSeen: number;
  lastActivity: number;
  activeJobs: number;
  activeConnections: number;
  idleMinutes: number;
  stopAt?: number;
}
export function shouldStop(a: Activity, now = Date.now()): boolean {
  if (a.stopAt && now >= a.stopAt) return true;
  return (
    a.idleMinutes > 0 &&
    now - a.lastSeen <= 120_000 &&
    now >= a.lastSeen &&
    a.activeJobs === 0 &&
    a.activeConnections === 0 &&
    now - a.lastActivity >= a.idleMinutes * 60_000
  );
}
export function newEnvironmentId() {
  return "env-" + crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}
