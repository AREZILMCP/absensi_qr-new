-- Server-authoritative attendance, voucher issue/claim, and Personalia monitoring.
-- All business dates and time thresholds are evaluated in Asia/Jakarta (WIB).

-- QR hashes are isolated from employee profile data and never exposed by a
-- regular employee query. QR payloads should be high-entropy random tokens.
create table public.qr_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  token_hash text not null unique,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint qr_token_hash_sha256_length check (length(token_hash) = 64)
);

alter table public.employees drop column qr_token_hash;
alter table public.qr_tokens enable row level security;

-- Token rows are only accessed by the SECURITY DEFINER transaction functions.
revoke all on public.qr_tokens from anon, authenticated;

create or replace function public.issue_employee_qr_token(p_employee_id uuid)
returns table (qr_token text, token_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select public.current_app_role());
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_id uuid;
begin
  if v_actor is null or v_role is null or v_role <> 'admin' then
    raise exception using errcode = '42501', message = 'Hanya Admin yang dapat menerbitkan QR karyawan.';
  end if;

  if not exists (select 1 from public.employees e where e.id = p_employee_id and e.is_active = true) then
    raise exception using errcode = 'P0002', message = 'Karyawan tidak ditemukan atau nonaktif.';
  end if;

  insert into public.qr_tokens (employee_id, token_hash)
  values (p_employee_id, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_token_id;

  insert into public.audit_logs (actor_id, employee_id, action, details)
  values (v_actor, p_employee_id, 'qr.issue', jsonb_build_object('token_id', v_token_id));

  -- Return the raw token once; only its SHA-256 hash is stored.
  return query select v_token, v_token_id;
end;
$$;

create or replace function public.revoke_employee_qr_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select public.current_app_role());
  v_employee_id uuid;
begin
  if v_actor is null or v_role is null or v_role <> 'admin' then
    raise exception using errcode = '42501', message = 'Hanya Admin yang dapat mencabut QR karyawan.';
  end if;

  update public.qr_tokens
  set revoked_at = clock_timestamp(), revoked_by = v_actor
  where id = p_token_id and revoked_at is null
  returning employee_id into v_employee_id;

  if v_employee_id is null then
    raise exception using errcode = 'P0002', message = 'Token tidak ditemukan atau sudah dicabut.';
  end if;

  insert into public.audit_logs (actor_id, employee_id, action, details)
  values (v_actor, v_employee_id, 'qr.revoke', jsonb_build_object('token_id', p_token_id));
end;
$$;

create or replace function public.check_in_by_qr(p_qr_token text)
returns table (
  attendance_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  check_in_at timestamptz,
  regular_voucher_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select public.current_app_role());
  v_now timestamptz := clock_timestamp();
  v_work_date date := (v_now at time zone 'Asia/Jakarta')::date;
  v_employee public.employees%rowtype;
  v_attendance_id uuid;
  v_voucher_id uuid;
begin
  if v_actor is null or v_role is null or v_role not in ('admin', 'petugas_presensi') then
    raise exception using errcode = '42501', message = 'Akses check-in ditolak.';
  end if;
  if p_qr_token is null or length(p_qr_token) < 32 then
    raise exception using errcode = '22023', message = 'QR tidak valid.';
  end if;

  select e.* into v_employee
  from public.qr_tokens q
  join public.employees e on e.id = q.employee_id
  where q.token_hash = encode(extensions.digest(p_qr_token, 'sha256'), 'hex')
    and q.revoked_at is null
    and e.is_active = true
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'QR tidak valid atau karyawan nonaktif.';
  end if;

  insert into public.attendance (employee_id, work_date, check_in_at, created_by, updated_by)
  values (v_employee.id, v_work_date, v_now, v_actor, v_actor)
  on conflict (employee_id, work_date) do nothing
  returning id into v_attendance_id;

  if v_attendance_id is null then
    raise exception using errcode = '23505', message = 'Check-in karyawan ini sudah tercatat hari ini.';
  end if;

  insert into public.meal_vouchers (employee_id, attendance_id, work_date, kind, status, issued_at)
  values (v_employee.id, v_attendance_id, v_work_date, 'reguler', 'tersedia', v_now)
  returning id into v_voucher_id;

  insert into public.audit_logs (actor_id, employee_id, attendance_id, voucher_id, action, details, occurred_at)
  values (
    v_actor, v_employee.id, v_attendance_id, v_voucher_id,
    'attendance.check_in',
    jsonb_build_object('work_date', v_work_date, 'voucher_kind', 'reguler'),
    v_now
  );

  return query select v_attendance_id, v_employee.id, v_employee.employee_code,
    v_employee.full_name, v_now, v_voucher_id;
end;
$$;

create or replace function public.check_out_by_qr(p_qr_token text)
returns table (
  attendance_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  check_out_at timestamptz,
  is_overtime boolean,
  overtime_meal_eligible boolean,
  overtime_voucher_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select public.current_app_role());
  v_now timestamptz := clock_timestamp();
  v_local_time time := (v_now at time zone 'Asia/Jakarta')::time;
  v_work_date date := (v_now at time zone 'Asia/Jakarta')::date;
  v_employee public.employees%rowtype;
  v_attendance public.attendance%rowtype;
  v_overtime boolean;
  v_voucher_id uuid;
begin
  if v_actor is null or v_role is null or v_role not in ('admin', 'petugas_presensi') then
    raise exception using errcode = '42501', message = 'Akses check-out ditolak.';
  end if;
  if p_qr_token is null or length(p_qr_token) < 32 then
    raise exception using errcode = '22023', message = 'QR tidak valid.';
  end if;

  select e.* into v_employee
  from public.qr_tokens q
  join public.employees e on e.id = q.employee_id
  where q.token_hash = encode(extensions.digest(p_qr_token, 'sha256'), 'hex')
    and q.revoked_at is null
    and e.is_active = true
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'QR tidak valid atau karyawan nonaktif.';
  end if;

  select a.* into v_attendance
  from public.attendance a
  where a.employee_id = v_employee.id and a.work_date = v_work_date
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Check-in hari ini belum tercatat.';
  end if;
  if v_attendance.check_out_at is not null then
    raise exception using errcode = '23505', message = 'Check-out karyawan ini sudah tercatat hari ini.';
  end if;

  update public.attendance
  set check_out_at = v_now, updated_by = v_actor, updated_at = v_now
  where id = v_attendance.id;

  v_overtime := v_local_time > time '16:00:00';

  -- The entitlement threshold is strictly after 18:00 WIB. 18:00:00 itself
  -- does not qualify. The unique employee/date/kind constraint is the final
  -- guard against duplicate overtime vouchers.
  if v_local_time > time '18:00:00' then
    insert into public.meal_vouchers (employee_id, attendance_id, work_date, kind, status, issued_at)
    values (v_employee.id, v_attendance.id, v_work_date, 'lembur', 'tersedia', v_now)
    on conflict (employee_id, work_date, kind) do nothing
    returning id into v_voucher_id;
  end if;

  insert into public.audit_logs (actor_id, employee_id, attendance_id, voucher_id, action, details, occurred_at)
  values (
    v_actor, v_employee.id, v_attendance.id, v_voucher_id,
    'attendance.check_out',
    jsonb_build_object(
      'work_date', v_work_date,
      'local_time', v_local_time,
      'is_overtime', v_overtime,
      'overtime_voucher_eligible', v_local_time > time '18:00:00'
    ),
    v_now
  );

  return query select v_attendance.id, v_employee.id, v_employee.employee_code,
    v_employee.full_name, v_now, v_overtime, v_local_time > time '18:00:00', v_voucher_id;
end;
$$;

create or replace function public.claim_meal_voucher_by_qr(
  p_qr_token text,
  p_kind public.voucher_kind
)
returns table (
  claim_id uuid,
  voucher_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  kind public.voucher_kind,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := (select public.current_app_role());
  v_now timestamptz := clock_timestamp();
  v_work_date date := (v_now at time zone 'Asia/Jakarta')::date;
  v_employee public.employees%rowtype;
  v_voucher public.meal_vouchers%rowtype;
  v_claim_id uuid;
begin
  if v_actor is null or v_role is null or v_role not in ('admin', 'petugas_kantin') then
    raise exception using errcode = '42501', message = 'Akses klaim voucher ditolak.';
  end if;
  if p_qr_token is null or length(p_qr_token) < 32 then
    raise exception using errcode = '22023', message = 'QR tidak valid.';
  end if;

  select e.* into v_employee
  from public.qr_tokens q
  join public.employees e on e.id = q.employee_id
  where q.token_hash = encode(extensions.digest(p_qr_token, 'sha256'), 'hex')
    and q.revoked_at is null
    and e.is_active = true
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'QR tidak valid atau karyawan nonaktif.';
  end if;

  select v.* into v_voucher
  from public.meal_vouchers v
  where v.employee_id = v_employee.id
    and v.work_date = v_work_date
    and v.kind = p_kind
    and v.status = 'tersedia'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Voucher tidak tersedia atau sudah diklaim.';
  end if;

  update public.meal_vouchers
  set status = 'diklaim'
  where id = v_voucher.id;

  insert into public.voucher_claims (voucher_id, employee_id, attendant_id, claimed_at)
  values (v_voucher.id, v_employee.id, v_actor, v_now)
  returning id into v_claim_id;

  insert into public.audit_logs (actor_id, employee_id, attendance_id, voucher_id, action, details, occurred_at)
  values (
    v_actor, v_employee.id, v_voucher.attendance_id, v_voucher.id,
    'voucher.claim',
    jsonb_build_object('work_date', v_work_date, 'voucher_kind', p_kind),
    v_now
  );

  return query select v_claim_id, v_voucher.id, v_employee.id,
    v_employee.employee_code, v_employee.full_name, p_kind, v_now;
end;
$$;

create or replace function public.get_personalia_daily_monitor(p_work_date date)
returns table (
  employee_id uuid,
  employee_code text,
  employee_name text,
  department text,
  check_in_at timestamptz,
  check_out_at timestamptz,
  is_overtime boolean,
  overtime_meal_eligible boolean,
  regular_voucher_status public.voucher_status,
  overtime_voucher_status public.voucher_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := (select public.current_app_role());
  v_now_local timestamp := clock_timestamp() at time zone 'Asia/Jakarta';
begin
  if v_role is null or v_role not in ('admin', 'personalia') then
    raise exception using errcode = '42501', message = 'Akses monitoring Personalia ditolak.';
  end if;

  return query
  select
    e.id,
    e.employee_code,
    e.full_name,
    e.department,
    a.check_in_at,
    a.check_out_at,
    case
      when a.check_out_at is not null then (a.check_out_at at time zone 'Asia/Jakarta')::time > time '16:00:00'
      else p_work_date = v_now_local::date and v_now_local::time > time '16:00:00'
    end as is_overtime,
    coalesce((a.check_out_at at time zone 'Asia/Jakarta')::time > time '18:00:00', false) as overtime_meal_eligible,
    vr.status,
    vo.status
  from public.attendance a
  join public.employees e on e.id = a.employee_id
  left join public.meal_vouchers vr
    on vr.employee_id = e.id and vr.work_date = a.work_date and vr.kind = 'reguler'
  left join public.meal_vouchers vo
    on vo.employee_id = e.id and vo.work_date = a.work_date and vo.kind = 'lembur'
  where a.work_date = p_work_date
    and e.is_active = true
  order by e.full_name;
end;
$$;

revoke all on function public.issue_employee_qr_token(uuid) from public, anon;
revoke all on function public.revoke_employee_qr_token(uuid) from public, anon;
revoke all on function public.check_in_by_qr(text) from public, anon;
revoke all on function public.check_out_by_qr(text) from public, anon;
revoke all on function public.claim_meal_voucher_by_qr(text, public.voucher_kind) from public, anon;
revoke all on function public.get_personalia_daily_monitor(date) from public, anon;

grant execute on function public.issue_employee_qr_token(uuid) to authenticated;
grant execute on function public.revoke_employee_qr_token(uuid) to authenticated;
grant execute on function public.check_in_by_qr(text) to authenticated;
grant execute on function public.check_out_by_qr(text) to authenticated;
grant execute on function public.claim_meal_voucher_by_qr(text, public.voucher_kind) to authenticated;
grant execute on function public.get_personalia_daily_monitor(date) to authenticated;
