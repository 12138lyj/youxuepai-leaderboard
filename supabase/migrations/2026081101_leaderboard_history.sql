create table if not exists public.leaderboard_state_history (
  id bigint generated always as identity primary key,
  state_id text not null references public.leaderboard_state(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  revision bigint not null check (revision > 0),
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (state_id, revision)
);

create index if not exists leaderboard_state_history_latest_idx
on public.leaderboard_state_history (state_id, revision desc);

alter table public.leaderboard_state_history enable row level security;

drop policy if exists "owner leaderboard history read" on public.leaderboard_state_history;
create policy "owner leaderboard history read"
on public.leaderboard_state_history for select
to authenticated
using (auth.uid() = owner_id);

revoke all on public.leaderboard_state_history from anon, authenticated;
grant select on public.leaderboard_state_history to authenticated;

insert into public.leaderboard_state_history (state_id, owner_id, revision, payload, created_at)
select id, owner_id, revision, payload, updated_at
from public.leaderboard_state
on conflict (state_id, revision) do nothing;

create or replace function public.capture_leaderboard_state_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.leaderboard_state_history (state_id, owner_id, revision, payload, created_at)
  values (new.id, new.owner_id, new.revision, new.payload, new.updated_at)
  on conflict (state_id, revision) do nothing;

  delete from public.leaderboard_state_history history
  where history.state_id = new.id
    and history.id not in (
      select kept.id
      from public.leaderboard_state_history kept
      where kept.state_id = new.id
      order by kept.revision desc, kept.id desc
      limit 50
    );
  return new;
end;
$$;

revoke all on function public.capture_leaderboard_state_history() from public, anon, authenticated;

drop trigger if exists capture_leaderboard_state_history on public.leaderboard_state;
create trigger capture_leaderboard_state_history
after update of payload, revision on public.leaderboard_state
for each row
when (old.payload is distinct from new.payload or old.revision is distinct from new.revision)
execute function public.capture_leaderboard_state_history();

create or replace function public.restore_leaderboard_snapshot(p_snapshot_id bigint)
returns table(payload jsonb, revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  restored_payload jsonb;
begin
  select history.payload
  into restored_payload
  from public.leaderboard_state_history history
  join public.leaderboard_state state on state.id = history.state_id
  where history.id = p_snapshot_id
    and history.state_id = 'main'
    and history.owner_id = auth.uid()
    and state.owner_id = auth.uid();

  if restored_payload is null then
    raise exception 'Snapshot not found or access denied' using errcode = 'P0002';
  end if;

  return query
  update public.leaderboard_state state
  set payload = restored_payload,
      revision = state.revision + 1,
      updated_at = timezone('utc', now())
  where state.id = 'main' and state.owner_id = auth.uid()
  returning state.payload, state.revision, state.updated_at;
end;
$$;

revoke all on function public.restore_leaderboard_snapshot(bigint) from public, anon;
grant execute on function public.restore_leaderboard_snapshot(bigint) to authenticated;
