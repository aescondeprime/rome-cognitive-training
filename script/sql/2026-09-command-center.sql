-- ═══════════════════════════════════════════════════════════════════════════
-- ROME · Command Center — threats on a map, directives in a chain, and the
-- links from either onto real work.
--
-- Run once, in the Supabase dashboard → SQL Editor → New query → Run.
-- The repo has no migration runner (drizzle is vestigial, see CLAUDE.md), so
-- this file is the record of what the database looks like, not something the
-- app executes.
--
-- Idempotent: safe to run twice. Non-destructive: nothing is dropped, every
-- new column is nullable or carries a default, so the Threats widget keeps
-- working exactly as it does today, before and after this runs.
--
-- What it does
--   1. Gives a threat a position on the tactical grid, and room for a body of
--      text the widget's one-line title has never had.
--   2. Adds directives — the other half of the board. A directive is an order
--      you have issued yourself; it has a status, and it can hang off another
--      directive, which is what makes the chain view a graph rather than a
--      list.
--   3. Adds command_links: an edge from a threat or a directive onto a board,
--      a Kronos item, or a Contingency Garden plan.
--
-- No foreign keys on purpose, matching every earlier migration: the two API
-- twins own referential cleanup, the id column types of the existing tables
-- are not guaranteed here, and a failed FK would abort the script. Deleting a
-- threat or a directive deletes its links in application code, in both twins.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Threats gain a position and a body ────────────────────────────────
--
-- NULL pos_x/pos_y means "not placed yet". The grid scatters those into free
-- space on first render and writes real numbers back, so a threat added from
-- the constellation widget — which knows nothing about the map — still turns
-- up somewhere sensible rather than stacked at the origin.

alter table public.threats add column if not exists pos_x double precision;
alter table public.threats add column if not exists pos_y double precision;
alter table public.threats add column if not exists detail text;

-- ── 2 · Directives ────────────────────────────────────────────────────────
--
-- A directive is a **goal**, not a reaction. It is something you have decided
-- to achieve; it stands on its own, and it is not filed under whatever threat
-- happened to prompt it. Threats and directives are two independent boards that
-- happen to attach to the same universe of work — see command_links below.
--
-- status is the goal's lifecycle and is deliberately not a boolean: a goal you
-- reached and a goal you dropped are different facts, and collapsing them into
-- `done` loses the one you want when you look back.
--
-- parent_id is another directive — a sub-goal. A NULL parent is a top-level
-- objective; the chain view lays the forest out top-down from those. It is not
-- enforced here, so application code is what stops a cycle — see the twins.
--
-- progress is 0–100 and is only ever hand-set on a **leaf**. A goal with
-- sub-goals shows the mean of theirs instead: a parent that claims 40% while
-- its three children are untouched is a contradiction, and the children are the
-- more honest source. Nothing here enforces that — the renderer derives it, and
-- the column simply goes unread on a parent.
--
-- target_date is a plain 'YYYY-MM-DD' string rather than a date type, matching
-- how Kronos Keep already stores every date it has. NULL means the goal has no
-- horizon, which is a legitimate thing for a goal to be.

create table if not exists public.directives (
  id          bigserial primary key,
  user_id     bigint      not null,
  title       text        not null default 'Untitled objective',
  detail      text                 default '',
  status      text        not null default 'planned',  -- planned | active | achieved | shelved
  priority    integer     not null default 1,          -- 1 low · 2 med · 3 high
  parent_id   bigint,
  progress    integer     not null default 0,          -- 0-100, leaves only
  target_date text                 default '',
  pos_x       double precision,
  pos_y       double precision,
  created_at  bigint      not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at  bigint      not null default (extract(epoch from now()) * 1000)::bigint
);

-- Added after the first draft of this file, which shaped a directive as a
-- response to a threat and gave it a threat_id. If that version was already
-- run, `create table if not exists` above did nothing and these two columns are
-- what is missing. threat_id is deliberately NOT dropped — dropping a column is
-- the one destructive thing this file could do, and an unread nullable column
-- costs nothing.

alter table public.directives add column if not exists progress integer not null default 0;
alter table public.directives add column if not exists target_date text default '';

create index if not exists directives_user_idx   on public.directives (user_id);
create index if not exists directives_parent_idx on public.directives (parent_id);

-- ── 3 · Links ─────────────────────────────────────────────────────────────
--
-- One edge table for both marker kinds, because the two sides of the board
-- link to the same universe of work and two tables would mean writing every
-- query twice. This is the *only* thing a threat and a directive share: a
-- threat attaches to the projects it endangers, a goal to the projects that
-- advance it, and neither is filed under the other.
--
-- target_ref is text, not bigint, and that is the whole reason this table is
-- shaped the way it is. A board is a row with an integer id; a Kronos item is
-- an integer id that only means something alongside its segment; a Contingency
-- Garden plan is a letter in localStorage and has no server id at all. One
-- text column addresses all three:
--
--   board target       target_kind = 'idea_workshop' | 'component_board'
--                                  | 'science_board' | 'experiment_board'
--                                  | 'taskboard'
--                      target_ref  = '<board id>'
--   Kronos item        target_kind = 'kronos_routine' | 'kronos_assignment'
--                                  | 'kronos_event'   | 'kronos_general'
--                      target_ref  = '<item id>'
--   Garden plan        target_kind = 'garden_plan'
--                      target_ref  = '<plan letter>'
--
-- target_label is a snapshot of the target's title at the moment it was
-- linked. It is denormalised on purpose: a board the user later deletes should
-- leave a legible dead edge on the map — "linked to Operation Kettle
-- (missing)" — rather than a numeric id nobody can identify.

create table if not exists public.command_links (
  id           bigserial primary key,
  user_id      bigint not null,
  source_kind  text   not null,                 -- threat | directive
  source_id    bigint not null,
  target_kind  text   not null,
  target_ref   text   not null,
  target_label text            default '',
  label        text            default '',      -- the relation, e.g. 'countered by'
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists command_links_user_idx   on public.command_links (user_id);
create index if not exists command_links_source_idx on public.command_links (source_kind, source_id);

-- One edge per source/target pair. Attaching the same board twice is a
-- mis-click, not a second relation, and the twins rely on this to make the
-- attach action idempotent.
create unique index if not exists command_links_unique_edge
  on public.command_links (user_id, source_kind, source_id, target_kind, target_ref);

-- ── Check ─────────────────────────────────────────────────────────────────
--
-- Expect three rows for threats, then the full column list of directives and
-- command_links.

select table_name, column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'threats' and column_name in ('pos_x','pos_y','detail'))
    or table_name in ('directives','command_links')
  )
order by table_name, ordinal_position;
