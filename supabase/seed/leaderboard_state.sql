do $$
begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'Expected exactly one shared editor user before seeding';
  end if;
end $$;

with roster(name, position) as (
  values
    ('崔晟宸', 1),
    ('陆怡辰', 2),
    ('李梓玉', 3),
    ('李栩嘉', 4),
    ('韩宝锐', 5),
    ('杨晴雯', 6),
    ('刘洛扬', 7),
    ('王浩蕴', 8),
    ('孙亦康', 9),
    ('黄诗茹', 10)
), normalized as (
  select 's' || position as student_id, name, position
  from roster
), state_parts as (
  select
    jsonb_agg(
      jsonb_build_object(
        'id', student_id,
        'name', name,
        'notebook', 0,
        'errorBook', 0,
        'draft', 0,
        'module', 0,
        'totalPoints', 0,
        'badges', jsonb_build_object(
          'notebook', 'white',
          'errorBook', 'white',
          'draft', 'white',
          'module', 'white'
        )
      ) order by position
    ) as students,
    jsonb_object_agg(
      student_id,
      jsonb_build_object('notebook', 0, 'errorBook', 0, 'draft', 0, 'module', 0)
    ) as lesson_one,
    jsonb_object_agg(student_id, to_jsonb(0)) as carryover
  from normalized
), seed as (
  select jsonb_build_object(
    'activeClassId', 'class-1',
    'classes', jsonb_build_array(jsonb_build_object(
      'id', 'class-1',
      'name', '暑假学习技能训练',
      'lesson', 1,
      'students', students,
      'collectiveGoal', 15000,
      'previousScores', '{}'::jsonb,
      'honorEvents', '[]'::jsonb,
      'lessonRecords', jsonb_build_object('1', lesson_one),
      'carryoverPoints', carryover
    ))
  ) as payload
  from state_parts
), editor as (
  select id from auth.users limit 1
)
insert into public.leaderboard_state (id, payload, revision, owner_id)
select 'main', seed.payload, 1, editor.id
from seed cross join editor
on conflict (id) do update
set payload = excluded.payload,
    revision = public.leaderboard_state.revision + 1,
    owner_id = excluded.owner_id,
    updated_at = timezone('utc', now());
