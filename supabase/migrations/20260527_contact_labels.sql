-- Migration: contact_labels + contact_label_assignments
-- Custom per-user contact labeling (Professional tier killer feature).
-- Allows users to group contacts (e.g. "U12 Squadra", "Genitori", "Fornitori")
-- and filter ContactPicker by label.
-- Date: 2026-05-27

create table if not exists public.contact_labels (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null,
  name text not null,
  color text not null default '#25D366',
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Case-insensitive unique label name per user. Pattern: a single user can't
-- have two labels "Genitori" and "genitori".
create unique index if not exists uq_contact_labels_user_lowername
  on public.contact_labels(user_phone, lower(name));

create index if not exists idx_contact_labels_user_order
  on public.contact_labels(user_phone, display_order);

create table if not exists public.contact_label_assignments (
  label_id uuid not null references public.contact_labels(id) on delete cascade,
  user_phone text not null,
  contact_number text not null,
  assigned_at timestamptz not null default now(),
  primary key (label_id, contact_number)
);

create index if not exists idx_contact_label_assignments_lookup
  on public.contact_label_assignments(user_phone, contact_number);

create index if not exists idx_contact_label_assignments_label
  on public.contact_label_assignments(label_id);

alter table public.contact_labels enable row level security;
alter table public.contact_label_assignments enable row level security;
