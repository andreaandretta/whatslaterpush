# Deploy Hetzner — artefatti

Compagni operativi del runbook [`docs/2026-06-12-runbook-migrazione-hetzner.md`](../../docs/2026-06-12-runbook-migrazione-hetzner.md).

| File | Uso |
|---|---|
| `cloud-init.yaml` | Campo "Cloud config" alla creazione del server (Fase 1) — installa Coolify al primo boot |
| `evolution-compose.yml` | Risorsa Docker Compose in Coolify (Fase 3) — Evolution v2.3.7 + Postgres 16 (niente Redis: cache locale, fix #2437) |

## Env da settare in Coolify sulla risorsa (mai nel repo: è pubblico)

| Variabile | Valore |
|---|---|
| `EVOLUTION_SERVER_URL` | `http://<IP-HETZNER>:8080` |
| `EVOLUTION_API_KEY` | fresca: `openssl rand -hex 32` — la stessa va poi su Vercel come `EVOLUTION_API_KEY` al cutover |
| `POSTGRES_PASSWORD` | fresca: `openssl rand -hex 24` — resta solo dentro Coolify |

## Firewall Hetzner (Fase 1.3)

| Porta | Da | Per |
|---|---|---|
| 80, 443/tcp | 0.0.0.0/0, ::/0 | Traefik/Coolify proxy (futuri domini) |
| 8000/tcp | 0.0.0.0/0, ::/0 | Coolify UI/API (token-auth; serve a Vercel/torre che non hanno IP fissi) |
| 8080/tcp | 0.0.0.0/0, ::/0 | Evolution API (apikey-auth; chiamata da Vercel) |
| ~~22~~ | chiusa | break-glass = console web Hetzner (password root via email) |

## Checklist post-deploy (Fase 3.3)

1. `curl http://<IP>:8080/` → `{"status":200,...,"version":"2.3.7"}`
2. Coolify → token API creato → `COOLIFY_API_URL`/`COOLIFY_API_TOKEN` pronti per il cutover
3. Fase 2 del runbook (test pairing diretto) PRIMA di toccare le env Vercel
