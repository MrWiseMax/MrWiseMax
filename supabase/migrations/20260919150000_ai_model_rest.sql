-- ============================================================
-- MrWiseMax — Assistant: which Gemini models to leave alone for a while
-- ============================================================
-- Additive only. When a model says it is overloaded, or takes too long to start
-- answering, the ai-chat function notes it here and every request skips it
-- until the time passes — so one slow refusal spares everyone else the wait,
-- even across the function's cold starts.
--
-- Holds model names and times, nothing about any user. Only the function
-- (service_role) reads or writes it.

create table if not exists public.ai_model_rest (
  model  text primary key,
  until  timestamptz not null
);

alter table public.ai_model_rest enable row level security;

revoke all on public.ai_model_rest from anon, authenticated, service_role;
grant select, insert, update on public.ai_model_rest to service_role;
