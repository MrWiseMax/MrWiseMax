-- ============================================================
-- MrWiseMax — Assistant: conversation history and a daily allowance
-- ============================================================
-- Additive only: two new tables and one function. No existing table is
-- touched.
--
-- Only the ai-chat Edge Function writes here (as service_role), so what is
-- stored is exactly what was asked and answered, and the daily count cannot be
-- reset from the browser. People can read their own conversation, and clear it.

-- ── Conversation ─────────────────────────────────────────────
create table if not exists public.ai_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) <= 40000),
  -- Which Gemini model wrote an answer; empty on the user's own messages.
  model       text,
  created_at  timestamptz not null default now()
);

create index if not exists ai_chat_messages_user_time
  on public.ai_chat_messages (user_id, created_at);

alter table public.ai_chat_messages enable row level security;

drop policy if exists "Read own chat" on public.ai_chat_messages;
create policy "Read own chat" on public.ai_chat_messages
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Clear own chat" on public.ai_chat_messages;
create policy "Clear own chat" on public.ai_chat_messages
  for delete to authenticated using ((select auth.uid()) = user_id);

-- New tables in this project start with no read/write rights for anyone, so
-- each role gets exactly what it needs.
revoke all on public.ai_chat_messages from anon, authenticated, service_role;
grant select, delete         on public.ai_chat_messages to authenticated;
grant select, insert, delete on public.ai_chat_messages to service_role;

-- ── Daily allowance ─────────────────────────────────────────
create table if not exists public.ai_usage (
  user_id   uuid not null references auth.users (id) on delete cascade,
  day       date not null,
  messages  integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

drop policy if exists "Read own usage" on public.ai_usage;
create policy "Read own usage" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.ai_usage from anon, authenticated, service_role;
grant select                 on public.ai_usage to authenticated;
grant select, insert, update on public.ai_usage to service_role;

-- Counts one answered question and returns the day's new total. One statement,
-- so two answers finishing at once cannot both read the same old count.
create or replace function public.ai_count_message(p_user uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (user_id, day, messages)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
    do update set messages = public.ai_usage.messages + 1
  returning messages;
$$;

revoke all on function public.ai_count_message(uuid) from public, anon, authenticated;
grant execute on function public.ai_count_message(uuid) to service_role;
