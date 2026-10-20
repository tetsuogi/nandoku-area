-- 難読地名帳：ユーザーごとの進捗（覚えた地名・復習リスト・成績・設定）
-- ダービー馬暗記帳と同じ Supabase プロジェクトに、別のテーブルとして追加する
create table if not exists public.nandoku_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.nandoku_progress enable row level security;

-- 本人の行だけ読み書きできる（ほかの人の成績は見えない）
create policy "read own nandoku progress" on public.nandoku_progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own nandoku progress" on public.nandoku_progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own nandoku progress" on public.nandoku_progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
