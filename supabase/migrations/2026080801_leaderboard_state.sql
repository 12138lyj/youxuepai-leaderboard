create table if not exists public.leaderboard_state (
  id text primary key check (id = 'main'),
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default timezone('utc', now()),
  owner_id uuid not null references auth.users(id)
);

alter table public.leaderboard_state enable row level security;

drop policy if exists "public leaderboard read" on public.leaderboard_state;
create policy "public leaderboard read"
on public.leaderboard_state for select
to anon, authenticated
using (true);

drop policy if exists "owner leaderboard update" on public.leaderboard_state;
create policy "owner leaderboard update"
on public.leaderboard_state for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

revoke all on public.leaderboard_state from anon, authenticated;
grant select on public.leaderboard_state to anon, authenticated;
grant update on public.leaderboard_state to authenticated;

create or replace function public.save_leaderboard_state(p_payload jsonb)
returns table(payload jsonb, revision bigint, updated_at timestamptz)
language sql
security invoker
set search_path = public
as $$
  update public.leaderboard_state
  set payload = p_payload,
      revision = leaderboard_state.revision + 1,
      updated_at = timezone('utc', now())
  where id = 'main' and auth.uid() = owner_id
  returning leaderboard_state.payload,
            leaderboard_state.revision,
            leaderboard_state.updated_at;
$$;

revoke all on function public.save_leaderboard_state(jsonb) from public;
grant execute on function public.save_leaderboard_state(jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leaderboard_state'
  ) then
    alter publication supabase_realtime add table public.leaderboard_state;
  end if;
end $$;
