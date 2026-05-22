-- Flux devis email (Agent Ola web) — champs optionnels sur devis
alter table public.devis add column if not exists pricing_status text default 'pending_admin';
alter table public.devis add column if not exists email_sent_at timestamptz;
alter table public.devis add column if not exists client_decision text;
alter table public.devis add column if not exists client_decision_at timestamptz;
