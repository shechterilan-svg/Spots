-- Spots – personal keys for the iPhone Shortcut (F-03). Only a SHA-256 hash is stored; the key is shown once.
create table if not exists public.shortcut_keys (
  id           uuid primary key default gen_random_uuid(),
  owner_email  text not null default public.current_email(),
  key_hash     text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked      boolean not null default false
);
alter table public.shortcut_keys enable row level security;
drop policy if exists shortcut_keys_owner on public.shortcut_keys;
create policy shortcut_keys_owner on public.shortcut_keys for all to authenticated
  using (public.is_owner() and owner_email = public.current_email())
  with check (public.is_owner() and owner_email = public.current_email());
revoke all on public.shortcut_keys from anon;
select 'ok' as shortcut_keys;
