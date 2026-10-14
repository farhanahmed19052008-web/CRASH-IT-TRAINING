-- LLS Crash IT Training Program
-- Run in Supabase SQL Editor as project owner.
-- Browser code must use only the publishable/anon key. NEVER expose service_role.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('student','parent','teacher','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attendance_status as enum ('present','absent','late');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.assessment_kind as enum ('weekly_quiz','grand_test');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  roll_number text not null unique,
  full_name text not null,
  class_level text not null check (class_level in ('9th','10th')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.parent_students (
  parent_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text not null default 'Parent',
  created_at timestamptz not null default now(),
  primary key(parent_id,student_id)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  attendance_date date not null,
  status public.attendance_status not null,
  notes text not null default '',
  marked_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id,attendance_date)
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  subject text not null check (subject in ('Python','Java','CSP')),
  assessment_type public.assessment_kind not null,
  due_date date,
  questions jsonb not null default '[]'::jsonb,
  pass_mark_percent integer not null default 50 check (pass_mark_percent between 1 and 100),
  published boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint questions_must_be_array check (jsonb_typeof(questions) = 'array')
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  correct_answers integer not null default 0 check (correct_answers >= 0),
  total_questions integer not null check (total_questions > 0),
  score_percent numeric(5,2) not null check (score_percent between 0 and 100),
  passed boolean not null default false,
  submitted_at timestamptz not null default now()
);

create index if not exists attendance_date_idx on public.attendance(attendance_date);
create index if not exists attendance_student_date_idx on public.attendance(student_id,attendance_date);
create index if not exists attempts_student_idx on public.quiz_attempts(student_id,submitted_at desc);
create index if not exists assessments_published_idx on public.assessments(published,created_at desc);

-- Helper functions run with a fixed search_path to avoid search_path injection.
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('teacher','admin'), false)
$$;

create or replace function public.can_access_student(target_student_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    public.is_staff()
    or exists(select 1 from public.students s where s.id=target_student_id and s.profile_id=(select auth.uid()))
    or exists(select 1 from public.parent_students ps where ps.student_id=target_student_id and ps.parent_id=(select auth.uid()))
$$;

-- New auth users get a safe default student role. An admin must promote staff accounts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,full_name,email,role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.email,''),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.parent_students enable row level security;
alter table public.attendance enable row level security;
alter table public.assessments enable row level security;
alter table public.quiz_attempts enable row level security;

-- Profiles: a user can see own profile; staff can view profiles.
drop policy if exists "profiles select self or staff" on public.profiles;
create policy "profiles select self or staff" on public.profiles for select to authenticated
using (id=(select auth.uid()) or public.is_staff());

-- Only admins can change roles/profile data. Users cannot self-promote.
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated
using (public.current_app_role()='admin') with check (public.current_app_role()='admin');

drop policy if exists "students read permitted" on public.students;
create policy "students read permitted" on public.students for select to authenticated
using (
  public.is_staff()
  or profile_id=(select auth.uid())
  or exists(select 1 from public.parent_students ps where ps.student_id=id and ps.parent_id=(select auth.uid()))
);
drop policy if exists "staff create students" on public.students;
create policy "staff create students" on public.students for insert to authenticated
with check (public.is_staff());
drop policy if exists "staff update students" on public.students;
create policy "staff update students" on public.students for update to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "admin delete students" on public.students;
create policy "admin delete students" on public.students for delete to authenticated
using (public.current_app_role()='admin');

drop policy if exists "parent links read own or staff" on public.parent_students;
create policy "parent links read own or staff" on public.parent_students for select to authenticated
using (parent_id=(select auth.uid()) or public.is_staff());
drop policy if exists "admin manage parent links" on public.parent_students;
create policy "admin manage parent links" on public.parent_students for all to authenticated
using (public.current_app_role()='admin') with check (public.current_app_role()='admin');

drop policy if exists "attendance read linked student" on public.attendance;
create policy "attendance read linked student" on public.attendance for select to authenticated
using (public.can_access_student(student_id));
drop policy if exists "staff insert attendance" on public.attendance;
create policy "staff insert attendance" on public.attendance for insert to authenticated
with check (public.is_staff() and marked_by=(select auth.uid()));
drop policy if exists "staff update attendance" on public.attendance;
create policy "staff update attendance" on public.attendance for update to authenticated
using (public.is_staff()) with check (public.is_staff() and marked_by=(select auth.uid()));
drop policy if exists "admin delete attendance" on public.attendance;
create policy "admin delete attendance" on public.attendance for delete to authenticated
using (public.current_app_role()='admin');

drop policy if exists "published assessments readable" on public.assessments;
create policy "published assessments readable" on public.assessments for select to authenticated
using (published=true or public.is_staff());
drop policy if exists "staff create assessments" on public.assessments;
create policy "staff create assessments" on public.assessments for insert to authenticated
with check (public.is_staff() and created_by=(select auth.uid()));
drop policy if exists "staff update assessments" on public.assessments;
create policy "staff update assessments" on public.assessments for update to authenticated
using (public.is_staff()) with check (public.is_staff());
drop policy if exists "admin delete assessments" on public.assessments;
create policy "admin delete assessments" on public.assessments for delete to authenticated
using (public.current_app_role()='admin');

-- Students may insert attempts only for their own linked profile. Parents can read results
-- for linked children, staff can read all. Direct browser updates/deletes are intentionally absent.
drop policy if exists "attempts read linked student" on public.quiz_attempts;
create policy "attempts read linked student" on public.quiz_attempts for select to authenticated
using (public.can_access_student(student_id));
drop policy if exists "students submit own attempts" on public.quiz_attempts;
create policy "students submit own attempts" on public.quiz_attempts for insert to authenticated
with check (
  exists(select 1 from public.students s where s.id=student_id and s.profile_id=(select auth.uid()))
  and exists(select 1 from public.assessments a where a.id=assessment_id and a.published=true)
);

-- SECURITY NOTE:
-- Client-side quiz scoring is suitable for a teaching prototype only. A motivated student can
-- inspect answer_index values in the browser and forge score fields. For real high-stakes exams,
-- move scoring to a trusted server/Edge Function that stores correct answers privately and
-- calculates results server-side. Do not use this client-scored starter for secure examinations.
