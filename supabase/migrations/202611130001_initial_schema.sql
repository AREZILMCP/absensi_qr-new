-- Initial data model for the non-shift attendance and meal voucher MVP.
-- All timestamps are timestamptz; the application displays them in Asia/Jakarta.

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum (
  'admin',
  'personalia',
  'petugas_presensi',
  'petugas_kantin'
);

create type public.voucher_kind as enum ('reguler', 'lembur');
create type public.voucher_status as enum ('tersedia', 'diklaim', 'dibatalkan');
create type public.attendance_action as enum ('check_in', 'check_out');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.app_role not null default 'personalia',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  full_name text not null,
  department text,
  position text,
  is_active boolean not null default true,
  qr_token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  check_in_at timestamptz not null,
  check_out_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_employee_work_date_unique unique (employee_id, work_date),
  constraint attendance_check_out_after_check_in check (
    check_out_at is null or check_out_at >= check_in_at
  )
);

create table public.meal_vouchers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  attendance_id uuid not null references public.attendance(id) on delete restrict,
  work_date date not null,
  kind public.voucher_kind not null,
  status public.voucher_status not null default 'tersedia',
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meal_voucher_employee_date_kind_unique unique (employee_id, work_date, kind)
);

create table public.voucher_claims (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null unique references public.meal_vouchers(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  attendant_id uuid not null references public.profiles(id) on delete restrict,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  attendance_id uuid references public.attendance(id) on delete set null,
  voucher_id uuid references public.meal_vouchers(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index attendance_work_date_idx on public.attendance(work_date);
create index attendance_check_out_idx on public.attendance(work_date, check_out_at);
create index meal_vouchers_work_date_status_idx on public.meal_vouchers(work_date, status);
create index voucher_claims_claimed_at_idx on public.voucher_claims(claimed_at);
create index audit_logs_occurred_at_idx on public.audit_logs(occurred_at desc);

create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active = true
$$;

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.meal_vouchers enable row level security;
alter table public.voucher_claims enable row level security;
alter table public.audit_logs enable row level security;

-- Personal data is readable only by authenticated operational roles.
create policy "operational roles read profiles"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (select public.current_app_role()) in ('admin', 'personalia', 'petugas_presensi', 'petugas_kantin')
);

create policy "operational roles read employees"
on public.employees for select to authenticated
using ((select public.current_app_role()) in ('admin', 'personalia', 'petugas_presensi', 'petugas_kantin'));

create policy "admin manages employees"
on public.employees for all to authenticated
using ((select public.current_app_role()) = 'admin')
with check ((select public.current_app_role()) = 'admin');

create policy "operational roles read attendance"
on public.attendance for select to authenticated
using ((select public.current_app_role()) in ('admin', 'personalia', 'petugas_presensi'));

create policy "personalia and operators read vouchers"
on public.meal_vouchers for select to authenticated
using ((select public.current_app_role()) in ('admin', 'personalia', 'petugas_presensi', 'petugas_kantin'));

create policy "operational roles read claims"
on public.voucher_claims for select to authenticated
using ((select public.current_app_role()) in ('admin', 'personalia', 'petugas_kantin'));

create policy "admin and personalia read audit logs"
on public.audit_logs for select to authenticated
using ((select public.current_app_role()) in ('admin', 'personalia'));

-- No direct insert/update/delete policies are granted for attendance, vouchers,
-- claims, or audit logs. Transactional SECURITY DEFINER RPCs will be added next.
