-- ═══════════════════════════════════════════════════════════════════════════
-- ROME · check the v2 migration, then clear the routines
--
-- Supabase dashboard → SQL Editor. Steps 1 and 2 only read; step 3 is
-- destructive and is commented out on purpose, because this editor runs the
-- whole buffer when you press Run.
--
-- Do this BEFORE the sync engine exists. Nothing here has ever been sent to
-- iCloud, so deleting a routine now is purely local. Once the engine is
-- running, deleting a synced routine deletes it from Apple Calendar too.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Has 2026-08-kronos-v2.sql been applied? ───────────────────────────
--
-- Expect FOUR rows. Each should report sync_cols = 6, and kronos_routines
-- should also report window_cols = 2. A missing kronos_generals row, or any
-- zero, means the migration has not run — run it first, then come back.

select
  table_name,
  count(*) filter (
    where column_name in ('ical_uid','ical_href','ical_etag','ical_raw','synced_at','sync_state')
  ) as sync_cols,
  count(*) filter (where column_name in ('start_date','end_date')) as window_cols
from information_schema.columns
where table_schema = 'public'
  and table_name in ('kronos_routines','kronos_assignments','kronos_events','kronos_generals')
group by table_name
order by table_name;

-- And the link table the engine records itself in:
select to_regclass('public.kronos_sync_links') as sync_links_table;   -- null = not created


-- ── 2 · What is about to be deleted ───────────────────────────────────────
--
-- Look at this before running step 3. `saved = true` rows are library
-- templates; `saved = false` rows are the copies sitting on days.

select
  id, title, recurrence, days_of_week, saved,
  coalesce(nullif(start_date, ''), '—') as starts,
  coalesce(nullif(end_date,   ''), '—') as ends
from public.kronos_routines
order by saved desc, id;

select count(*) as routines_to_delete from public.kronos_routines;


-- ── 3 · The delete ────────────────────────────────────────────────────────
--
-- Routines only. Assignments, events and general items are untouched, and so
-- is everything on iCloud.
--
-- Remove the two dashes below, select just that line, and run it.

-- delete from public.kronos_routines;


-- ── 4 · Confirm ───────────────────────────────────────────────────────────
-- select count(*) as remaining from public.kronos_routines;   -- expect 0
