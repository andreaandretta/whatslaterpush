-- Migration: full_sync_slots — distributed concurrency limiter for the Baileys
-- full-sync at first pairing (Task 5, opzione b).
--
-- WHY: syncFullHistory=true makes Baileys buffer app-state/history in RAM at
-- link time. On the single Hetzner node, 3-4 concurrent first-pairings each
-- triggering a full-sync can OOM the box (signup-burst). Simply disabling the
-- full-sync is NOT an option: it kills the CONTACTS_SET/UPSERT burst that
-- populates the address book, and hardcoding it false already caused
-- "contatti spariti su ogni nuovo pairing" (commit 6d3fb6b). This semaphore
-- caps how many full-syncs run at once WITHOUT disabling the contact burst.
--
-- HOW: N pre-seeded slots. A pairing acquires a free-or-expired slot before
-- setting syncFullHistory=true; if all slots are held it waits briefly, then
-- proceeds anyway (fail-open — never break contact loading; the brief wait
-- already staggers the burst and lowers the simultaneous RAM peak). The
-- handler returns before the out-of-band sync finishes and cannot explicitly
-- release, so slots auto-expire after a TTL that approximates the sync window.

create table if not exists public.full_sync_slots (
  slot_no int primary key,
  holder text,
  acquired_at timestamptz
);

-- Two concurrent full-syncs is the cap. Adjust the seeded rows to change it.
insert into public.full_sync_slots (slot_no, holder, acquired_at)
  values (1, null, null), (2, null, null)
  on conflict (slot_no) do nothing;

-- RLS on, no policy: service-role only (same posture as ops_commands / rate_limit_state).
alter table public.full_sync_slots enable row level security;

-- Atomically acquire a free (or TTL-expired) slot. Returns the slot_no on
-- success, or NULL when every slot is currently held within the TTL window.
-- FOR UPDATE SKIP LOCKED makes concurrent acquirers pick different slots
-- instead of racing on the same one.
create or replace function public.acquire_full_sync_slot(p_holder text, p_ttl_seconds int)
returns int
language plpgsql
as $$
declare
  acquired int;
begin
  update public.full_sync_slots
     set holder = p_holder, acquired_at = now()
   where slot_no = (
     select slot_no from public.full_sync_slots
      where holder is null
         or acquired_at < now() - make_interval(secs => p_ttl_seconds)
      order by slot_no
      limit 1
      for update skip locked
   )
  returning slot_no into acquired;
  return acquired; -- NULL if none free
end;
$$;
