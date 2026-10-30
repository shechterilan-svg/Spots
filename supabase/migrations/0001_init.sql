-- Spots – initial schema (phase 2)
-- 8 tables, Row Level Security, helper functions.
-- Access model: only invited emails (table members) can read; only the owner writes places.

-- ---------- helpers ----------
create or replace function public.current_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- members ----------
create table if not exists public.members (
  email       text primary key check (email = lower(email)),
  name        text,
  role        text not null default 'friend' check (role in ('owner','friend')),
  invited_at  timestamptz not null default now(),
  last_seen   timestamptz
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.current_email())
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.current_email() and role = 'owner')
$$;

-- Friends see other members' names only, never their emails.
create or replace function public.member_names() returns table (name text, role text)
language sql stable security definer set search_path = public as $$
  select coalesce(m.name, split_part(m.email, '@', 1)), m.role
  from public.members m where public.is_member()
$$;

insert into public.members (email, name, role)
values ('shechter.ilan@gmail.com', 'אילן', 'owner')
on conflict (email) do update set role = 'owner';

-- ---------- places ----------
create table if not exists public.places (
  id               text primary key,
  name             text not null,
  name_en          text,
  type             text not null default 'מסעדה',
  cuisine          text[] not null default '{}',
  address          text,
  neighborhood     text,
  city             text,
  lat              double precision,
  lng              double precision,
  google_place_id  text unique,
  phone            text,
  instagram        text,
  website          text,
  booking_url      text,
  kosher           text,
  price            smallint check (price between 0 and 4),
  status           text not null default 'רוצה לנסות',
  hours            jsonb not null default '{}'::jsonb,
  hours_checked_at date,
  hours_source     text,
  dishes           text[] not null default '{}',
  notes            text,
  needs_review     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists places_city_idx on public.places (city);
create index if not exists places_type_idx on public.places (type);
drop trigger if exists places_touch on public.places;
create trigger places_touch before update on public.places
  for each row execute function public.touch_updated_at();

-- ---------- suggestions ----------
create table if not exists public.suggestions (
  id            uuid primary key default gen_random_uuid(),
  origin        text not null check (origin in ('friend','influencer','article','import','share')),
  suggested_by  text not null default public.current_email(),
  url           text,
  payload       jsonb not null default '{}'::jsonb,   -- proposed place fields
  confidence    real,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  place_id      text references public.places(id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists suggestions_status_idx on public.suggestions (status);

-- ---------- influencers ----------
create table if not exists public.influencers (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null default 'instagram' check (platform in ('instagram','tiktok','facebook','web')),
  handle          text not null,
  display_name    text,
  followers       integer,
  active          boolean not null default true,
  last_scanned_at timestamptz,
  unique (platform, handle)
);

-- ---------- sources ----------
create table if not exists public.sources (
  id             uuid primary key default gen_random_uuid(),
  place_id       text references public.places(id) on delete cascade,
  suggestion_id  uuid references public.suggestions(id) on delete cascade,
  influencer_id  uuid references public.influencers(id) on delete set null,
  url            text,
  platform       text,
  publisher      text,
  posted_at      date,
  caption        text,
  created_at     timestamptz not null default now(),
  check (place_id is not null or suggestion_id is not null)
);
create index if not exists sources_place_idx on public.sources (place_id);
create unique index if not exists sources_place_url_uq on public.sources (place_id, url);

-- ---------- outings & votes ----------
create table if not exists public.outings (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  starts_at        timestamptz,
  place_ids        text[] not null default '{}',
  chosen_place_id  text references public.places(id) on delete set null,
  status           text not null default 'open' check (status in ('open','closed')),
  created_by       text not null default public.current_email(),
  created_at       timestamptz not null default now()
);

create table if not exists public.votes (
  outing_id  uuid not null references public.outings(id) on delete cascade,
  voter      text not null default public.current_email(),
  place_id   text not null references public.places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (outing_id, voter)
);

-- ---------- visits ----------
create table if not exists public.visits (
  id          uuid primary key default gen_random_uuid(),
  place_id    text not null references public.places(id) on delete cascade,
  visited_on  date not null default current_date,
  rating      smallint check (rating between 1 and 5),
  ordered     text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists visits_place_idx on public.visits (place_id);

-- ---------- Row Level Security ----------
alter table public.members     enable row level security;
alter table public.places      enable row level security;
alter table public.suggestions enable row level security;
alter table public.influencers enable row level security;
alter table public.sources     enable row level security;
alter table public.outings     enable row level security;
alter table public.votes       enable row level security;
alter table public.visits      enable row level security;

-- members: owner manages; a member can see their own row.
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (public.is_owner() or email = public.current_email());
drop policy if exists members_owner_write on public.members;
create policy members_owner_write on public.members for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- places / sources / visits / outings: members read, owner writes.
do $$
declare t text;
begin
  foreach t in array array['places','sources','visits','outings'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.is_member())', t);
    execute format('drop policy if exists %1$s_owner_write on public.%1$s', t);
    execute format('create policy %1$s_owner_write on public.%1$s for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

-- suggestions: owner sees all; a friend sees and creates only their own pending ones.
drop policy if exists suggestions_read on public.suggestions;
create policy suggestions_read on public.suggestions for select to authenticated
  using (public.is_owner() or (public.is_member() and suggested_by = public.current_email()));
drop policy if exists suggestions_insert on public.suggestions;
create policy suggestions_insert on public.suggestions for insert to authenticated
  with check (public.is_member() and suggested_by = public.current_email() and status = 'pending');
drop policy if exists suggestions_owner_update on public.suggestions;
create policy suggestions_owner_update on public.suggestions for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists suggestions_owner_delete on public.suggestions;
create policy suggestions_owner_delete on public.suggestions for delete to authenticated
  using (public.is_owner());

-- influencers: owner only.
drop policy if exists influencers_owner on public.influencers;
create policy influencers_owner on public.influencers for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- votes: members read all votes; each member casts/changes/removes only their own vote on an open outing.
drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes for select to authenticated using (public.is_member());
drop policy if exists votes_own_insert on public.votes;
create policy votes_own_insert on public.votes for insert to authenticated
  with check (public.is_member() and voter = public.current_email()
    and exists (select 1 from public.outings o where o.id = outing_id and o.status = 'open' and place_id = any(o.place_ids)));
drop policy if exists votes_own_update on public.votes;
create policy votes_own_update on public.votes for update to authenticated
  using (voter = public.current_email())
  with check (voter = public.current_email()
    and exists (select 1 from public.outings o where o.id = outing_id and o.status = 'open' and place_id = any(o.place_ids)));
drop policy if exists votes_own_delete on public.votes;
create policy votes_own_delete on public.votes for delete to authenticated
  using (voter = public.current_email());

-- No anonymous access at all.
revoke all on all tables in schema public from anon;
grant execute on function public.member_names() to authenticated;
