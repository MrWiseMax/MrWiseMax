-- ============================================================
-- MrWiseMax — Assistant: saved conversations and a strict daily allowance
-- ============================================================
-- Additive only: one new table, one new column on ai_chat_messages, and three
-- new functions. Nothing is dropped, and any message already stored is kept —
-- moved into a conversation of its own.
--
-- As before, only the ai-chat Edge Function (service_role) writes messages
-- and starts conversations. People can read, rename, pin and delete their own
-- conversations; deleting one deletes its messages with it.

-- ── Conversations ────────────────────────────────────────────
create table if not exists public.ai_chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  -- Set once the person names the chat themselves. Until then the function may
  -- replace a title taken from a bare "hi" with one from a later question.
  named       boolean not null default false,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  -- When the last message was added; the list is ordered by it.
  updated_at  timestamptz not null default now()
);

create index if not exists ai_chats_user_recent
  on public.ai_chats (user_id, updated_at desc);

-- One pinned chat per person.
create unique index if not exists ai_chats_one_pinned
  on public.ai_chats (user_id) where pinned;

alter table public.ai_chats enable row level security;

drop policy if exists "Read own chats" on public.ai_chats;
create policy "Read own chats" on public.ai_chats
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Edit own chats" on public.ai_chats;
create policy "Edit own chats" on public.ai_chats
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Delete own chats" on public.ai_chats;
create policy "Delete own chats" on public.ai_chats
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The browser may change a chat's name and pin, and nothing else about it.
revoke all on public.ai_chats from anon, authenticated, service_role;
grant select, delete                 on public.ai_chats to authenticated;
grant update (title, named, pinned)  on public.ai_chats to authenticated;
grant select, insert, update, delete on public.ai_chats to service_role;

-- ── Each message belongs to a conversation ───────────────────
alter table public.ai_chat_messages
  add column if not exists chat_id uuid references public.ai_chats (id) on delete cascade;

create index if not exists ai_chat_messages_chat_time
  on public.ai_chat_messages (chat_id, created_at);

-- Messages saved before conversations existed become one conversation per
-- person, named after the first thing they asked.
with earlier as (
  select user_id,
         min(created_at) as first_at,
         max(created_at) as last_at,
         (array_agg(content order by created_at) filter (where role = 'user'))[1] as first_question
    from public.ai_chat_messages
   where chat_id is null
   group by user_id
), made as (
  insert into public.ai_chats (user_id, title, created_at, updated_at)
  select user_id,
         coalesce(nullif(left(btrim(regexp_replace(first_question, '\s+', ' ', 'g')), 60), ''),
                  'Earlier conversation'),
         first_at, last_at
    from earlier
  returning id, user_id
)
update public.ai_chat_messages m
   set chat_id = made.id
  from made
 where m.user_id = made.user_id and m.chat_id is null;

alter table public.ai_chat_messages alter column chat_id set not null;

-- ── Pinning ──────────────────────────────────────────────────
-- Pinning one chat unpins whichever was pinned before, in one step. Runs as
-- the caller, so row security limits it to their own chats.
create or replace function public.ai_pin_chat(p_chat uuid, p_pinned boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_pinned then
    update public.ai_chats set pinned = false
     where user_id = (select auth.uid()) and pinned and id <> p_chat;
  end if;
  update public.ai_chats set pinned = p_pinned
   where id = p_chat and user_id = (select auth.uid());
end;
$$;

revoke all on function public.ai_pin_chat(uuid, boolean) from public, anon;
grant execute on function public.ai_pin_chat(uuid, boolean) to authenticated;

-- ── Daily allowance, taken up front ──────────────────────────
-- Takes one message from the day's allowance and returns the new count, or -1
-- when none is left. It is taken before the question is answered, in a single
-- guarded update, so two tabs asking at once cannot both slip past the limit.
create or replace function public.ai_take_message(p_user uuid, p_day date, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  insert into public.ai_usage (user_id, day, messages)
  values (p_user, p_day, 0)
  on conflict (user_id, day) do nothing;

  update public.ai_usage
     set messages = messages + 1
   where user_id = p_user and day = p_day and messages < p_limit
  returning messages into used;

  return coalesce(used, -1);
end;
$$;

-- Gives the message back when no answer came of it.
create or replace function public.ai_return_message(p_user uuid, p_day date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set messages = greatest(messages - 1, 0)
   where user_id = p_user and day = p_day;
$$;

revoke all on function public.ai_take_message(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.ai_return_message(uuid, date)        from public, anon, authenticated;
grant execute on function public.ai_take_message(uuid, date, integer) to service_role;
grant execute on function public.ai_return_message(uuid, date)        to service_role;
