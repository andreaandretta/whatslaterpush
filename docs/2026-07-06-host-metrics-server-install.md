# Host-metrics push — installazione sul server (runbook §8.2)

Il server Hetzner POSTa RAM/disk/load a `POST /api/ops/host-metrics` ogni 60s
(cron di sistema). Vercel le salva in `host_metrics` (Supabase) e
`fetchDropletMetrics` le legge quando `HOST_METRICS_SOURCE=push` → watchdog
`droplet_ram`, stress-index, `/admin/droplet` e daily-report tornano a vedere
RAM/disk. Provider-agnostic: serve solo `curl` + cron.

⚠️ **Il repo è pubblico: il segreto NON va mai committato.** Qui sotto c'è il
placeholder `<OPS_SECRET>`; il valore vero va incollato solo sul server
(file `/etc/whatslater-metrics.env`, root-only 600).

## Install (una volta, da root — console web Hetzner, SSH chiuso)

```bash
cat > /usr/local/bin/whatslater-host-metrics.sh <<'EOF'
#!/bin/sh
# WhatsLater host-metrics push (runbook §8.2) — RAM/disk/load → Vercel ops.
[ -f /etc/whatslater-metrics.env ] && . /etc/whatslater-metrics.env
[ -n "$OPS_SECRET" ] || exit 0
RAM=$(free | awk '/^Mem:/ {printf "%d", (1-$7/$2)*100}')   # 1 - available/total (semantica DO memory_available)
DISK=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
LOAD1=$(cut -d' ' -f1 /proc/loadavg)
UP=$(cut -d. -f1 /proc/uptime)
curl -fsS -m 10 -X POST "https://whatslaterpush.vercel.app/api/ops/host-metrics" \
  -H "Authorization: Bearer $OPS_SECRET" -H "Content-Type: application/json" \
  --data "{\"host\":\"hetzner-cx23\",\"ram_percent\":$RAM,\"disk_percent\":$DISK,\"load1\":$LOAD1,\"uptime_seconds\":$UP}" \
  >/dev/null 2>&1
EOF
chmod 755 /usr/local/bin/whatslater-host-metrics.sh

cat > /etc/whatslater-metrics.env <<'EOF'
OPS_SECRET=<OPS_SECRET>
EOF
chmod 600 /etc/whatslater-metrics.env

cat > /etc/cron.d/whatslater-metrics <<'EOF'
* * * * * root /usr/local/bin/whatslater-host-metrics.sh
EOF
chmod 644 /etc/cron.d/whatslater-metrics

# primo push subito (senza aspettare il minuto)
/usr/local/bin/whatslater-host-metrics.sh
```

## Verifica

- `SELECT * FROM host_metrics ORDER BY created_at DESC LIMIT 3;` → righe fresche ogni ~60s.
- `GET /api/ops/droplet/metrics?secret=…` → `ok:true` con ram/disk.
- Stress-index → sezione `droplet` popolata; watchdog `droplet_ram` torna attivo.
- Feed fermo >5 min → `droplet_ram` = warning "cron push fermo?" (fail-loud voluto).

## Note

- Staleness: righe più vecchie di 5 min = feed morto → `fetchDropletMetrics`
  ritorna `null` (mai dati vecchi spacciati per buoni).
- Retention: prune >48h ad ogni write (tabella ~2.8k righe max).
- `cpu_percent` non inviato (un campione shell non è affidabile); `load1` è il
  segnale CPU. Il campo resta nullable per un futuro two-sample.
- Rotazione `OPS_SECRET`: aggiornare Vercel env + `/etc/whatslater-metrics.env`.
