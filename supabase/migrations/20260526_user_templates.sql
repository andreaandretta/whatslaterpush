-- Migration: user_templates
-- User-owned personal templates. Created when user edits a seed template and
-- chooses to save it, OR creates a new template from scratch in the future
-- "manage templates" UI (v2, not built yet).
--
-- RLS pattern same as whatsapp_contacts: service-role bypass; app code
-- enforces authorization via verifyCookie -> user_phone WHERE filter.
-- Date: 2026-05-26

create table if not exists public.user_templates (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null,
  category text,
  emoji text,
  title text not null,
  body text not null,
  source_template_id uuid references public.message_templates(id) on delete set null,
  use_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_templates_user_phone
  on public.user_templates(user_phone, created_at desc);

-- Surface "most used" first within a user's library.
create index if not exists idx_user_templates_use_count
  on public.user_templates(user_phone, use_count desc, updated_at desc);

alter table public.user_templates enable row level security;

-- Atomic counter increment when a user_template is used in a schedule.
-- Returns the updated row so the API can confirm the increment landed.
create or replace function public.user_template_increment_use(p_template_id uuid)
returns public.user_templates
language plpgsql
as $$
declare
  result public.user_templates;
begin
  update public.user_templates
  set use_count = use_count + 1, updated_at = now()
  where id = p_template_id
  returning * into result;
  return result;
end;
$$;
