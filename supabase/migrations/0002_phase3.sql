-- Spots – phase 3: friends limit, private vote tallies, realtime for outings.

-- Up to 10 friends (the owner row does not count).
create or replace function public.enforce_friend_limit() returns trigger
language plpgsql as $$
begin
  if new.role = 'friend' and (select count(*) from public.members where role = 'friend' and email <> new.email) >= 10 then
    raise exception 'אפשר להזמין עד 10 חברים';
  end if;
  new.email = lower(trim(new.email));
  return new;
end $$;
drop trigger if exists members_limit on public.members;
create trigger members_limit before insert or update on public.members
  for each row execute function public.enforce_friend_limit();

-- Votes: a member sees only their own vote rows (emails stay private); everyone gets totals via outing_tally().
drop policy if exists votes_read on public.votes;
create policy votes_read on public.votes for select to authenticated
  using (public.is_owner() or voter = public.current_email());

create or replace function public.outing_tally(p_outing uuid)
returns table (place_id text, votes integer, voters text[])
language sql stable security definer set search_path = public as $$
  select v.place_id, count(*)::int,
         array_agg(coalesce(m.name, split_part(v.voter, '@', 1)) order by v.created_at)
  from public.votes v left join public.members m on m.email = v.voter
  where v.outing_id = p_outing and public.is_member()
  group by v.place_id
$$;
grant execute on function public.outing_tally(uuid) to authenticated;

-- Realtime: push vote and outing changes to open screens (RLS still applies).
do $$ begin
  begin alter publication supabase_realtime add table public.votes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.outings; exception when duplicate_object then null; end;
end $$;
