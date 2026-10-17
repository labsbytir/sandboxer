# Basin telemetry and reports

Data path: server collector → authenticated controller → Basin Pipeline → Catalog Iceberg table in R2 → Basin SQL → Markdown reports in the report bucket.

Configure an HTTP ingestion pipeline using Cloudflare’s current [Basin getting-started guide](https://developers.cloudflare.com/basin/get-started/guide/). Bind its destination to a catalog-enabled R2 bucket. Use the installed CLI’s `wrangler basin --help` to inspect available commands before provisioning; product and command names have recently changed.

The JSON records have these fields:

```json
{
  "timestamp": "2026-10-17T12:00:00Z",
  "environment_id": "env-0123456789abcdef",
  "run_id": "optional identifier",
  "kind": "host.metrics",
  "message": "optional application event",
  "cpu_load": 0.5,
  "memory_used_pct": 31.2,
  "disk_used_pct": 12.4
}
```

Use timestamp-compatible storage for `timestamp`, strings for identity/kind/message, and nullable doubles for the three metrics. The controller overwrites `environment_id` from the authenticated enrollment, never trusting the caller’s value. Requests support up to 100 events and 256 KB. Restrict direct ingestion to your intended producers using the pipeline’s supported authentication configuration.

The host collector reports load average (not CPU utilization percentage), memory use, and root-disk use. Each minute’s collection has its own sample identifier. Application events can POST the same record array to `/environments/{id}/telemetry` using the environment token. Automatic application log tailing and trace collection are not yet included; never forward secrets or full prompts by default.

The controller cron queries a 15-minute overlapping window every five minutes for environments with recent heartbeats. Reports include sample count, newest event, mean load, peak memory/disk, and scanned bytes. Reports are stored under `{environment-id}/{timestamp}.md` plus `latest.md`, visible through **Latest report**. These are deterministic metric summaries, not AI diagnoses. Reports explicitly warn that missing/delayed data is not evidence of health.

No automatic retention policy is configured. Set R2 lifecycle and D1 audit retention for your needs. Configure the Basin SQL token with the documented SQL, catalog, and bucket permissions. Controller request logs and traces are enabled independently of Basin ingestion.
