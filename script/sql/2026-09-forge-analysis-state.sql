-- ═══════════════════════════════════════════════════════════════════════════
-- ROME · Analysis State, caseboard items, flashcard intervals
--
-- Run once, in the Supabase dashboard → SQL Editor → New query → Run.
-- The repo has no migration runner (drizzle is vestigial, see CLAUDE.md), so
-- this file is the record of what the database looks like, not something the
-- app executes.
--
-- Idempotent: safe to run twice. Non-destructive: nothing is dropped, every
-- new column is nullable or carries a default, so the current build keeps
-- working before and after it runs.
--
-- What it does
--   1. Gives component_pins somewhere to put a capture from the Analysis
--      State: an image, and the page it was taken from.
--   2. Teaches component_pins about attachment, which is what makes a sticky
--      note follow the card it belongs to rather than sit near it.
--   3. Adds a data column for items whose content is structure rather than
--      prose — the venn item's sets and its overlap labels.
--   4. Lets a flashcard have no schedule at all. Until now every card was due
--      the moment it was written, because next_review_at defaulted to now.
--
-- No foreign keys on purpose, matching the earlier migrations: the two API
-- twins already own referential cleanup, the id column types of the existing
-- tables are not guaranteed here, and a failed FK would abort the script.
-- Deleting a pin deletes the notes attached to it in application code, in
-- both twins.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Captures ──────────────────────────────────────────────────────────
--
-- A capture is a region of a document, stored as a data URL. It lives on the
-- pin rather than in its own table because a capture is never anything but
-- one pin's face, and a join to fetch a board would buy nothing.

alter table public.component_pins add column if not exists image text;
alter table public.component_pins add column if not exists source_label text;

-- ── 2 · Attachment ────────────────────────────────────────────────────────
--
-- attached_to is another pin's id. The offsets are relative to that pin's
-- top-left, so the note moves with the card by construction rather than by a
-- drag handler remembering to move it. NULL attached_to is an ordinary pin,
-- which is every row that exists today.

alter table public.component_pins add column if not exists attached_to bigint;
alter table public.component_pins add column if not exists offset_x double precision;
alter table public.component_pins add column if not exists offset_y double precision;

create index if not exists component_pins_attached_to_idx
  on public.component_pins (attached_to);

-- ── 3 · Structured items ──────────────────────────────────────────────────
--
-- The venn item's sets and overlap labels. jsonb rather than more columns
-- because the shape belongs to the item type, and a second structured item
-- later should not cost another migration.

alter table public.component_pins add column if not exists data jsonb;

-- ── 4 · A card may have no schedule ───────────────────────────────────────
--
-- next_review_at defaulted to the moment of insert, so a card was due as soon
-- as it was written and there was no way to say "never surface this on its
-- own". NULL is now that answer, and the default is dropped so a card written
-- without a schedule stays unscheduled.
--
-- The /due endpoints filter on next_review_at <= now, and NULL fails that
-- comparison, so an unscheduled card is simply never due. Nothing else has to
-- know about it.

alter table public.recall_items alter column next_review_at drop not null;
alter table public.recall_items alter column next_review_at drop default;
alter table public.recall_items alter column interval_days drop not null;

-- ── Check ─────────────────────────────────────────────────────────────────
--
-- Expect six rows for component_pins and, for recall_items, next_review_at
-- with is_nullable = YES and no column_default.

select table_name, column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'component_pins'
      and column_name in ('image','source_label','attached_to','offset_x','offset_y','data'))
    or (table_name = 'recall_items' and column_name in ('next_review_at','interval_days'))
  )
order by table_name, column_name;
