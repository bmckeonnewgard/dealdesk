-- Deal Desk — Supabase (Postgres) schema.
--
-- Paste this whole file into Supabase's SQL Editor (Project > SQL Editor > New query) and click
-- Run, once, right after creating your project. It creates one generic table that every part of
-- the app reads/writes through, sets up security rules, a small merge function, and turns on
-- realtime sync — everything Deal Desk needs on the database side.
--
-- =====================================================================================
-- Why one generic table? This app was originally built against a Firestore-style database
-- (collection(path)/doc(path), arbitrary nested JSON per document). Rather than design ~10 rigid
-- SQL tables and rewrite ~30 call sites in the app, this schema keeps one flexible table —
-- `docs(collection, id, data jsonb)` — and a small JS adapter (in deal-desk.html) reproduces the
-- collection/doc shape on top of it. Every "collection" the app uses (deals, tasks, brokers,
-- activity, agendaItems, settings, and each deal's checklist/criteria sub-lists) is just a
-- different value in the `collection` column.
-- =====================================================================================

create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- Row Level Security: every visitor is signed in anonymously (see below), which gives them
-- Supabase's standard "authenticated" role. These policies allow any authenticated visitor full
-- read/write access to the docs table — the same tradeoff the app's client-side password screen
-- already makes explicit (see "What changed, honestly" in SETUP.md): this is a backstop against
-- random bots and scanners finding an open database, not real per-user security. A stranger who
-- never loads the real app and its password screen has no way to sign in and therefore no access.
alter table public.docs enable row level security;

drop policy if exists "authenticated read" on public.docs;
create policy "authenticated read" on public.docs
  for select to authenticated using (true);

drop policy if exists "authenticated insert" on public.docs;
create policy "authenticated insert" on public.docs
  for insert to authenticated with check (true);

drop policy if exists "authenticated update" on public.docs;
create policy "authenticated update" on public.docs
  for update to authenticated using (true) with check (true);

drop policy if exists "authenticated delete" on public.docs;
create policy "authenticated delete" on public.docs
  for delete to authenticated using (true);

-- Atomic partial-update ("merge") function — mirrors what the app's db.doc(path).update(patch)
-- calls expect: merge the given fields into whatever's already there (or create the row if it
-- doesn't exist yet), all in one statement so two simultaneous edits can't clobber each other.
create or replace function public.merge_doc(p_collection text, p_id text, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.docs (collection, id, data, updated_at)
  values (p_collection, p_id, p_patch, now())
  on conflict (collection, id)
  do update set data = public.docs.data || excluded.data, updated_at = now();
end;
$$;

grant execute on function public.merge_doc(text, text, jsonb) to authenticated;

-- Realtime: stream every insert/update/delete on this table to subscribed clients, so an edit one
-- teammate makes shows up for everyone else within about a second — same as before.
alter publication supabase_realtime add table public.docs;
