insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rankup-audio',
  'rankup-audio',
  true,
  10485760,
  array[
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'application/ogg'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public rankup audio read" on storage.objects;
create policy "public rankup audio read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'rankup-audio');

drop policy if exists "leaderboard owner rankup audio insert" on storage.objects;
create policy "leaderboard owner rankup audio insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'rankup-audio'
  and (storage.foldername(name))[1] = 'main'
  and exists (
    select 1
    from public.leaderboard_state
    where id = 'main' and owner_id = auth.uid()
  )
);

drop policy if exists "leaderboard owner rankup audio delete" on storage.objects;
create policy "leaderboard owner rankup audio delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'rankup-audio'
  and (storage.foldername(name))[1] = 'main'
  and exists (
    select 1
    from public.leaderboard_state
    where id = 'main' and owner_id = auth.uid()
  )
);
