-- Host-metrics push (runbook §8.2): il cron sul server Hetzner POSTa RAM/disk/
-- load a /api/ops/host-metrics ogni 60s; fetchDropletMetrics legge l'ultima
-- riga quando HOST_METRICS_SOURCE=push. Sostituisce l'API monitoring di
-- DigitalOcean (droplet distrutto il 2026-07-05; l'API Hetzner non espone la
-- memoria). Provider-agnostic: qualunque host con curl può alimentarla.

create table if not exists public.host_metrics (
  id bigint generated always as identity primary key,
  host text not null default 'hetzner',
  ram_percent integer not null check (ram_percent between 0 and 100),
  cpu_percent integer check (cpu_percent between 0 and 100),
  disk_percent integer check (disk_percent between 0 and 100),
  load1 real,
  uptime_seconds bigint,
  created_at timestamptz not null default now()
);

-- Letture: "ultima riga" (limit 1 desc) + finestra 24h per lo storico RAM.
create index if not exists host_metrics_created_at_idx
  on public.host_metrics (created_at desc);

-- Stessa postura delle altre tabelle ops (20260602_enable_rls_exposed_tables):
-- RLS ON senza policy = accesso solo via service-role; una anon key leakkata
-- non legge né scrive nulla.
alter table public.host_metrics enable row level security;
