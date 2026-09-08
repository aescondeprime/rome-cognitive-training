-- Kronos alerts — the notification a calendar fires before an item starts.
--
-- Run once in the Supabase SQL editor. Idempotent: re-running it changes
-- nothing, and it is safe to run on a database that already has the column.
--
-- One text column per item table, holding minutes-before as a comma-separated
-- list: '15' is fifteen minutes before, '15,1440' adds one day before, '0' is
-- at the time of the item, and '' (the default) is no alert at all. Everything
-- that already exists reads as "no alert" without a data migration, which is
-- both correct and the only safe default — a migration that invented alerts
-- would start notifying a phone about events nobody asked to be reminded of.
--
-- Deliberately not a jsonb array or a child table. The value is at most two
-- small integers, it is written by the renderer and read by the sync engine,
-- and a format the three of them can agree on without a library is worth more
-- here than a shape that could hold something richer.

alter table if exists public.kronos_routines   add column if not exists alerts text default '';
alter table if exists public.kronos_assignments add column if not exists alerts text default '';
alter table if exists public.kronos_events      add column if not exists alerts text default '';
alter table if exists public.kronos_generals    add column if not exists alerts text default '';

-- Existing rows get '' rather than NULL, so the engine never has to decide
-- what a null alert list means.
update public.kronos_routines    set alerts = '' where alerts is null;
update public.kronos_assignments set alerts = '' where alerts is null;
update public.kronos_events      set alerts = '' where alerts is null;
update public.kronos_generals    set alerts = '' where alerts is null;

-- What you should see: four columns, all text, all defaulting to ''.
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and column_name = 'alerts'
  and table_name in ('kronos_routines','kronos_assignments','kronos_events','kronos_generals')
order by table_name;
