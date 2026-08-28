-- ═══════════════════════════════════════════════════════════════════════════
-- ROME · Kronos Keep v2
--
-- Run once, in the Supabase dashboard → SQL Editor → New query → Run.
-- The repo has no migration runner (drizzle is vestigial, see CLAUDE.md), so
-- this file is the record of what the database looks like, not something the
-- app executes.
--
-- Idempotent: safe to run twice. Non-destructive: nothing is dropped, every
-- new column is nullable. The current build keeps working the moment this
-- runs and before any application code lands.
--
-- What it does
--   1. Gives routines a date window, so a routine stops at the end of its
--      month instead of repeating forever in both directions.
--   2. Adds a fourth item type, "General".
--   3. Adds dormant columns for the iCloud CalDAV sync, plus its link table.
--      Added now so there is only one trip to the SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · Routine month window ──────────────────────────────────────────────
--
-- itemsForDate() places a routine on every matching weekday with no bound at
-- all. These two columns are that bound. Both inclusive; NULL or '' means
-- unbounded, which is exactly the pre-v2 behaviour, so existing rows keep
-- doing what they do today until they are edited.

alter table public.kronos_routines
  add column if not exists start_date text,
  add column if not exists end_date   text;

comment on column public.kronos_routines.start_date is
  'YYYY-MM-DD, inclusive. NULL/empty = unbounded (pre-v2 behaviour).';
comment on column public.kronos_routines.end_date is
  'YYYY-MM-DD, inclusive. NULL/empty = unbounded (pre-v2 behaviour).';


-- ── 2 · The General item type ─────────────────────────────────────────────
--
-- Structurally identical to kronos_events, so it is cloned from it rather
-- than hand-written: LIKE ... INCLUDING ALL copies the exact column types,
-- defaults, identity, primary key and indexes, which means this file cannot
-- drift from whatever those tables actually are.

create table if not exists public.kronos_generals
  (like public.kronos_events including all);

-- Rename the two columns whose names were specific to events. Guarded, so a
-- second run is a no-op.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'kronos_generals'
               and column_name = 'event_date') then
    alter table public.kronos_generals rename column event_date to item_date;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'kronos_generals'
               and column_name = 'preparations') then
    alter table public.kronos_generals rename column preparations to notes;
  end if;
end $$;

-- INCLUDING ALL copies column DEFAULTS verbatim. If kronos_events.id is a
-- bigserial, the clone inherits `nextval('kronos_events_id_seq')` and the two
-- tables would then SHARE one sequence — interleaved ids, and dropping one
-- table breaks the other. Give the clone its own. (An identity column needs
-- no fix: INCLUDING IDENTITY already makes a fresh sequence.)
do $$
declare
  id_default text;
begin
  select pg_get_expr(ad.adbin, ad.adrelid)
    into id_default
    from pg_attrdef ad
    join pg_attribute a
      on a.attrelid = ad.adrelid and a.attnum = ad.adnum
   where ad.adrelid = 'public.kronos_generals'::regclass
     and a.attname  = 'id';

  if id_default is not null and id_default like '%kronos_events_id_seq%' then
    create sequence if not exists public.kronos_generals_id_seq
      owned by public.kronos_generals.id;
    perform setval('public.kronos_generals_id_seq', 1, false);
    alter table public.kronos_generals
      alter column id set default nextval('public.kronos_generals_id_seq');
  end if;
end $$;

-- Row-level security is not copied by LIKE. Mirror whatever kronos_events
-- has, so the new table is never quietly more permissive than its siblings.
-- (The server uses the service key, which bypasses RLS — but the anon key is
-- a documented fallback in server/storage.ts:288, so this matters.)
do $$
declare
  p record;
begin
  if (select relrowsecurity from pg_class where oid = 'public.kronos_events'::regclass) then
    execute 'alter table public.kronos_generals enable row level security';

    for p in
      select * from pg_policies
       where schemaname = 'public' and tablename = 'kronos_events'
    loop
      if not exists (select 1 from pg_policies
                      where schemaname = 'public'
                        and tablename  = 'kronos_generals'
                        and policyname = p.policyname) then
        execute format(
          'create policy %I on public.kronos_generals as %s for %s to %s %s %s',
          p.policyname,
          p.permissive,
          p.cmd,
          array_to_string(p.roles, ','),
          case when p.qual       is not null then 'using ('      || p.qual       || ')' else '' end,
          case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end
        );
      end if;
    end loop;
  end if;
end $$;

comment on table public.kronos_generals is
  'Fourth Kronos item type: a neutral one-shot with a date, a time and notes.';


-- ── 3 · iCloud CalDAV sync columns (dormant until the sync ships) ─────────
--
-- ical_href is stored PATH-ONLY, never as an absolute URL: iCloud serves each
-- account from a partition host (pNN-caldav.icloud.com) that can move, and a
-- stored absolute URL 404s the day it does.
--
-- ical_raw holds the last-seen .ics body. Pushing an edit patches the ROME
-- lines inside that body rather than regenerating it, which is what keeps a
-- user's alarms, invitees and X-APPLE-* properties from being silently
-- stripped on every round trip.
--
-- sync_state: '' | linked | local_dirty | remote_deleted | conflict | foreign

do $$
declare
  t text;
begin
  foreach t in array array[
    'kronos_routines', 'kronos_assignments', 'kronos_events', 'kronos_generals'
  ] loop
    execute format($f$
      alter table public.%I
        add column if not exists ical_uid   text,
        add column if not exists ical_href  text,
        add column if not exists ical_etag  text,
        add column if not exists ical_raw   text,
        add column if not exists synced_at  bigint,
        add column if not exists sync_state text
    $f$, t);

    execute format(
      'create index if not exists %I on public.%I (ical_uid)',
      t || '_ical_uid_idx', t);
  end loop;
end $$;


-- ── 4 · The sync link ─────────────────────────────────────────────────────
--
-- One Kronos calendar ↔ one iCloud calendar. The sync-token lives here rather
-- than in a file in the Electron data directory so it survives a reinstall
-- and cannot drift from the rows it describes.

create table if not exists public.kronos_sync_links (
  id                bigint generated always as identity primary key,
  user_id           bigint  not null,
  calendar_id       bigint  not null,
  provider          text    not null default 'icloud',
  account_email     text    not null default '',
  dav_calendar_url  text    not null default '',
  dav_calendar_name text    not null default '',
  sync_token        text,
  last_sync_at      bigint,
  last_error        text,
  enabled           boolean not null default true,
  created_at        bigint  not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at        bigint  not null default (extract(epoch from now()) * 1000)::bigint
);

create unique index if not exists kronos_sync_links_calendar_idx
  on public.kronos_sync_links (calendar_id);

-- Same RLS treatment: mirror kronos_calendars rather than inventing a policy.
do $$
declare
  p record;
begin
  if (select relrowsecurity from pg_class where oid = 'public.kronos_calendars'::regclass) then
    execute 'alter table public.kronos_sync_links enable row level security';

    for p in
      select * from pg_policies
       where schemaname = 'public' and tablename = 'kronos_calendars'
    loop
      if not exists (select 1 from pg_policies
                      where schemaname = 'public'
                        and tablename  = 'kronos_sync_links'
                        and policyname = p.policyname) then
        execute format(
          'create policy %I on public.kronos_sync_links as %s for %s to %s %s %s',
          p.policyname,
          p.permissive,
          p.cmd,
          array_to_string(p.roles, ','),
          case when p.qual       is not null then 'using ('      || p.qual       || ')' else '' end,
          case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end
        );
      end if;
    end loop;
  end if;
end $$;

commit;

-- ── Check ─────────────────────────────────────────────────────────────────
-- Expect four rows, each reporting 6 sync columns; kronos_routines also
-- reporting its 2 window columns.
--
--   select table_name,
--          count(*) filter (where column_name like 'ical\_%'
--                              or column_name in ('synced_at','sync_state')) as sync_cols,
--          count(*) filter (where column_name in ('start_date','end_date'))  as window_cols
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('kronos_routines','kronos_assignments','kronos_events','kronos_generals')
--    group by table_name
--    order by table_name;
