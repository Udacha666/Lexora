-- Lexora Orbit: paste into Supabase Dashboard > SQL Editor > New query > Run.
-- Each authenticated user is allowed to read/change ONLY their own row.
create table if not exists public.lexora_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.lexora_progress enable row level security;
create policy "lexora_select_own" on public.lexora_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "lexora_insert_own" on public.lexora_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "lexora_update_own" on public.lexora_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Do not enable anonymous/public read/write policies here.
