create table if not exists public.generated_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  course_name text,
  material_name text,
  question_type text not null,
  question_count integer not null default 0,
  difficulty text,
  instruction text,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.generated_questions
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.generated_questions enable row level security;

drop policy if exists "Allow public read generated questions" on public.generated_questions;
drop policy if exists "Allow public insert generated questions" on public.generated_questions;
drop policy if exists "Users can read own generated questions" on public.generated_questions;
drop policy if exists "Users can insert own generated questions" on public.generated_questions;

create policy "Users can read own generated questions"
on public.generated_questions
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own generated questions"
on public.generated_questions
for insert
to authenticated
with check (auth.uid() = user_id);

create table if not exists public.planner_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.planner_states enable row level security;

drop policy if exists "Users can read own planner state" on public.planner_states;
drop policy if exists "Users can upsert own planner state" on public.planner_states;

create policy "Users can read own planner state"
on public.planner_states
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can upsert own planner state"
on public.planner_states
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text,
  course_name text,
  title text not null,
  file_name text,
  status text not null default 'uploaded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text,
  material_id uuid not null references public.materials(id) on delete cascade,
  page_number integer,
  slide_number integer,
  cleaned_text text not null,
  created_at timestamptz not null default now()
);

alter table public.materials enable row level security;
alter table public.material_pages enable row level security;

drop policy if exists "Users can read own materials" on public.materials;
drop policy if exists "Users can write own materials" on public.materials;
drop policy if exists "Users can read own material pages" on public.material_pages;
drop policy if exists "Users can write own material pages" on public.material_pages;

create policy "Users can read own materials"
on public.materials
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can write own materials"
on public.materials
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read own material pages"
on public.material_pages
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can write own material pages"
on public.material_pages
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists material_pages_material_id_idx
on public.material_pages(material_id);

create table if not exists public.grade_projections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text,
  course_name text,
  target_grade text,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.grade_projections enable row level security;

drop policy if exists "Users can read own grade projections" on public.grade_projections;
drop policy if exists "Users can insert own grade projections" on public.grade_projections;

create policy "Users can read own grade projections"
on public.grade_projections
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own grade projections"
on public.grade_projections
for insert
to authenticated
with check (auth.uid() = user_id);

create index if not exists grade_projections_user_id_idx
on public.grade_projections(user_id);

create table if not exists public.graded_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_name text,
  question text not null,
  model_answer text,
  student_answer text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.graded_answers enable row level security;

drop policy if exists "Users can read own graded answers" on public.graded_answers;
drop policy if exists "Users can insert own graded answers" on public.graded_answers;

create policy "Users can read own graded answers"
on public.graded_answers
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own graded answers"
on public.graded_answers
for insert
to authenticated
with check (auth.uid() = user_id);

create index if not exists graded_answers_user_id_idx
on public.graded_answers(user_id);
