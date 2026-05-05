-- ─────────────────────────────────────────────────────────────────────────
-- OLA FLIGHT — audit trail agent IA (Supabase / Postgres)
-- À exécuter dans Supabase SQL editor (project → SQL → New query).
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  actor text not null default 'agent', -- agent | user | system
  channel text not null default 'web', -- web | whatsapp | instagram | backoffice
  conversation_id uuid null,
  lead_id uuid null references public.leads(id) on delete set null,
  action text not null,
  status text not null default 'ok', -- ok | error
  input jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_actions_created_at_idx on public.agent_actions (created_at desc);
create index if not exists agent_actions_lead_id_idx on public.agent_actions (lead_id, created_at desc);
create index if not exists agent_actions_conv_id_idx on public.agent_actions (conversation_id, created_at desc);

