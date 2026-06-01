-- Migration: retroactive parity for the contact_labels color palette gate.
-- Already applied manually in Supabase prod after Sprint 5 Cluster C
-- (PR #6, dede0db). Committed here so repo↔prod stay in sync and any
-- future env (preview branches, local Supabase, fresh restore) gets the
-- same constraint without manual intervention.
-- Idempotent: UPDATE is a no-op when everything is already in palette,
-- and the constraint add is guarded by a pg_constraint lookup.
-- Date: 2026-06-01

-- Step 1: remap legacy out-of-palette colors to the nearest safe value.
-- Maps the high-saturation reds/oranges to the new orange, dark blues to
-- the new blue, everything else falls back to neutral gray. Rows already
-- in palette are untouched.
update public.contact_labels
   set color = case
     when color ~* '^#(F|E)[A-F0-9]{5}$' then '#E65100'
     when color ~* '^#[0-9A-F]{2}([8-9A-F])' then '#1976D2'
     else '#546E7A'
   end
 where color not in (
   '#DB4437','#E65100','#827717','#0F9D58',
   '#00897B','#1976D2','#7E57C2','#546E7A'
 );

-- Step 2: enforce the palette at the DB level so out-of-palette writes
-- fail loudly regardless of which API path attempts them. Guarded with
-- pg_constraint check so the migration is re-runnable.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'color_in_palette'
       and conrelid = 'public.contact_labels'::regclass
  ) then
    alter table public.contact_labels
      add constraint color_in_palette check (
        color in (
          '#DB4437','#E65100','#827717','#0F9D58',
          '#00897B','#1976D2','#7E57C2','#546E7A'
        )
      );
  end if;
end $$;
