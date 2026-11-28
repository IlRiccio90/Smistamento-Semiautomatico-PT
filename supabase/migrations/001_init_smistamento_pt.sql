-- ============================================================================
-- SMISTAMENTO SEMIAUTOMATICO PT - Schema PostgreSQL, RLS, RPC Auth e Storage
-- ============================================================================

create extension if not exists "pgcrypto";

-- 1. Tabella profili amministratori (registrazione pubblica disabilitata)
create table if not exists public.admin_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'admin' check (role in ('admin')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bootstrap iniziale primo amministratore (nessuna password salvata nel codice)
insert into public.admin_profiles (email, role, active, must_change_password, created_by)
values ('andrea.graziano90@hotmail.it', 'admin', true, true, 'system_bootstrap')
on conflict (email) do nothing;

-- Helper: verifica se l'utente autenticato è un amministratore attivo
create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles ap
    where ap.active = true
      and (
        ap.user_id = auth.uid()
        or lower(ap.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

-- RPC pubblica sicura: controlla stato admin e credenziali reali in auth.users
-- e crea automaticamente il primo amministratore andrea.graziano90@hotmail.it se assente.
create or replace function public.check_admin_status(target_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(target_email, '')));
  v_profile public.admin_profiles%rowtype;
  v_auth_user record;
  v_auth_exists boolean := false;
  v_email_confirmed boolean := false;
  v_has_password boolean := false;
begin
  if v_email = '' then
    return jsonb_build_object(
      'exists', false,
      'active', false,
      'auth_user_exists', false,
      'email_confirmed', false,
      'has_password', false,
      'needs_initial_password', false,
      'must_change_password', false
    );
  end if;

  select id, email_confirmed_at, confirmed_at, encrypted_password
  into v_auth_user
  from auth.users
  where lower(email) = v_email
  limit 1;

  if found then
    v_auth_exists := true;
    v_email_confirmed := (v_auth_user.email_confirmed_at is not null or v_auth_user.confirmed_at is not null);
    v_has_password := (coalesce(v_auth_user.encrypted_password, '') <> '');
  end if;

  if v_email = 'andrea.graziano90@hotmail.it' then
    insert into public.admin_profiles (user_id, email, role, active, must_change_password, created_by)
    values (
      v_auth_user.id,
      'andrea.graziano90@hotmail.it',
      'admin',
      true,
      not v_has_password,
      'system_bootstrap'
    )
    on conflict (email) do update
    set
      user_id = coalesce(public.admin_profiles.user_id, excluded.user_id),
      role = 'admin',
      active = true,
      must_change_password = case when v_has_password then false else public.admin_profiles.must_change_password end,
      updated_at = now();
  end if;

  select * into v_profile
  from public.admin_profiles
  where lower(email) = v_email
  limit 1;

  if not found then
    return jsonb_build_object(
      'exists', false,
      'active', false,
      'auth_user_exists', v_auth_exists,
      'email_confirmed', v_email_confirmed,
      'has_password', v_has_password,
      'needs_initial_password', false,
      'must_change_password', false
    );
  end if;

  return jsonb_build_object(
    'exists', true,
    'active', v_profile.active,
    'auth_user_exists', v_auth_exists,
    'email_confirmed', v_email_confirmed,
    'has_password', v_has_password,
    'needs_initial_password', (not v_auth_exists or not v_has_password),
    'must_change_password', (case when v_has_password then false else v_profile.must_change_password end)
  );
end;
$$;

grant execute on function public.check_admin_status(text) to anon, authenticated;

-- RPC autenticata: collega auth.uid(), crea profilo/ruolo admin se mancanti e azzera must_change_password se ha già credenziali
create or replace function public.claim_admin_profile(mark_password_set boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_profile public.admin_profiles%rowtype;
  v_has_password boolean := false;
begin
  if v_uid is null or v_email = '' then
    return jsonb_build_object('authorized', false);
  end if;

  select (coalesce(encrypted_password, '') <> '')
  into v_has_password
  from auth.users
  where id = v_uid
  limit 1;

  if v_email = 'andrea.graziano90@hotmail.it' then
    insert into public.admin_profiles (user_id, email, role, active, must_change_password, created_by)
    values (v_uid, 'andrea.graziano90@hotmail.it', 'admin', true, false, 'system_bootstrap')
    on conflict (email) do update
    set
      user_id = coalesce(public.admin_profiles.user_id, v_uid),
      role = 'admin',
      active = true,
      must_change_password = false,
      updated_at = now();
  end if;

  select * into v_profile
  from public.admin_profiles
  where lower(email) = v_email
  limit 1;

  if not found or not v_profile.active then
    return jsonb_build_object('authorized', false);
  end if;

  update public.admin_profiles
  set
    user_id = coalesce(user_id, v_uid),
    role = case when coalesce(role, '') <> 'admin' then 'admin' else role end,
    must_change_password = case when (mark_password_set or v_has_password) then false else must_change_password end,
    updated_at = now()
  where id = v_profile.id
  returning * into v_profile;

  return jsonb_build_object(
    'authorized', true,
    'id', v_profile.id,
    'email', v_profile.email,
    'role', v_profile.role,
    'active', v_profile.active,
    'must_change_password', v_profile.must_change_password
  );
end;
$$;

grant execute on function public.claim_admin_profile(boolean) to authenticated;

-- 2. Centri di Recapito con versionamento
create table if not exists public.centers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text not null default '',
  version integer not null default 1,
  pdf_count integer not null default 0,
  address_count integer not null default 0,
  zones text[] not null default '{}',
  comuni text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. PDF caricati per Centro (metadati + riferimento Supabase Storage)
create table if not exists public.center_pdfs (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  file_name text not null,
  file_hash text not null default '',
  zone_number text not null,
  frazionario text,
  storage_path text not null default '',
  file_size bigint not null default 0,
  page_count integer not null default 0,
  extracted_count integer not null default 0,
  extraction_method text not null default 'native',
  version_added integer not null default 1,
  version_deleted integer,
  deleted boolean not null default false,
  imported_at timestamptz not null default now()
);

create index if not exists idx_center_pdfs_center on public.center_pdfs(center_id, deleted);

-- 4. Database Indirizzi Normalizzati con tombstone per aggiornamenti incrementali
create table if not exists public.center_addresses (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  pdf_id uuid not null references public.center_pdfs(id) on delete cascade,
  zona text not null,
  subzona text not null,
  prog text not null default '',
  comune text not null,
  comune_norm text not null,
  frazione text not null default '',
  tipo_strada text not null,
  tipo_strada_norm text not null,
  nome_strada text not null,
  nome_strada_norm text not null,
  nome_tokens text[] not null default '{}',
  civico_raw text not null default '',
  civico_num integer,
  civico_suffix text not null default '',
  civico_start integer,
  civico_end integer,
  parity text not null default 'all' check (parity in ('all', 'even', 'odd')),
  is_snc boolean not null default false,
  scala text not null default '',
  note text not null default '',
  raw_address text not null,
  version_changed integer not null default 1,
  deleted boolean not null default false
);

create index if not exists idx_center_addresses_sync on public.center_addresses(center_id, version_changed, deleted);
create index if not exists idx_center_addresses_comune on public.center_addresses(center_id, comune_norm);

-- 5. Log Attività
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  actor_role text not null check (actor_role in ('admin', 'operator', 'system')),
  action text not null,
  center_id uuid,
  center_name text,
  details text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_logs_created on public.activity_logs(created_at desc);

-- 6. Backup dei Centri
create table if not exists public.center_backups (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null,
  center_name text not null,
  center_version integer not null,
  reason text not null default 'manual',
  created_by text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

alter table public.admin_profiles enable row level security;
alter table public.centers enable row level security;
alter table public.center_pdfs enable row level security;
alter table public.center_addresses enable row level security;
alter table public.activity_logs enable row level security;
alter table public.center_backups enable row level security;

drop policy if exists "admin_profiles_select_admin" on public.admin_profiles;
drop policy if exists "admin_profiles_insert_admin" on public.admin_profiles;
drop policy if exists "admin_profiles_update_admin" on public.admin_profiles;
drop policy if exists "admin_profiles_bootstrap_self_insert" on public.admin_profiles;
drop policy if exists "admin_profiles_bootstrap_self_update" on public.admin_profiles;

create policy "admin_profiles_select_admin" on public.admin_profiles
  for select using (public.is_active_admin());
create policy "admin_profiles_insert_admin" on public.admin_profiles
  for insert with check (public.is_active_admin());
create policy "admin_profiles_update_admin" on public.admin_profiles
  for update using (public.is_active_admin());
create policy "admin_profiles_bootstrap_self_insert" on public.admin_profiles
  for insert with check (
    lower(email) = 'andrea.graziano90@hotmail.it'
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'andrea.graziano90@hotmail.it'
  );
create policy "admin_profiles_bootstrap_self_update" on public.admin_profiles
  for update using (
    lower(email) = 'andrea.graziano90@hotmail.it'
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'andrea.graziano90@hotmail.it'
  );

drop policy if exists "centers_select_all" on public.centers;
drop policy if exists "centers_write_admin" on public.centers;
create policy "centers_select_all" on public.centers
  for select using (true);
create policy "centers_write_admin" on public.centers
  for all using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "center_pdfs_select_all" on public.center_pdfs;
drop policy if exists "center_pdfs_write_admin" on public.center_pdfs;
create policy "center_pdfs_select_all" on public.center_pdfs
  for select using (true);
create policy "center_pdfs_write_admin" on public.center_pdfs
  for all using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "center_addresses_select_all" on public.center_addresses;
drop policy if exists "center_addresses_write_admin" on public.center_addresses;
create policy "center_addresses_select_all" on public.center_addresses
  for select using (true);
create policy "center_addresses_write_admin" on public.center_addresses
  for all using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "activity_logs_select_admin" on public.activity_logs;
drop policy if exists "activity_logs_insert_admin" on public.activity_logs;
create policy "activity_logs_select_admin" on public.activity_logs
  for select using (public.is_active_admin());
create policy "activity_logs_insert_admin" on public.activity_logs
  for insert with check (public.is_active_admin() or actor_role = 'operator');

drop policy if exists "center_backups_admin_only" on public.center_backups;
create policy "center_backups_admin_only" on public.center_backups
  for all using (public.is_active_admin()) with check (public.is_active_admin());

-- Privilegi espliciti schema e tabelle per PostgREST (anon / authenticated)
grant usage on schema public to anon, authenticated;
grant select on public.centers, public.center_pdfs, public.center_addresses to anon, authenticated;
grant insert, update, delete on public.centers, public.center_pdfs, public.center_addresses to authenticated;
grant select, insert, update on public.admin_profiles to authenticated;
grant insert on public.activity_logs to anon, authenticated;
grant select on public.activity_logs to authenticated;
grant select, insert, update, delete on public.center_backups to authenticated;

-- ============================================================================
-- STORAGE BUCKET PER PDF ORIGINALI
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('libretti-pdf', 'libretti-pdf', false)
on conflict (id) do nothing;

drop policy if exists "libretti_pdf_admin_read" on storage.objects;
drop policy if exists "libretti_pdf_admin_write" on storage.objects;
drop policy if exists "libretti_pdf_admin_delete" on storage.objects;

create policy "libretti_pdf_admin_read" on storage.objects
  for select using (bucket_id = 'libretti-pdf' and public.is_active_admin());

create policy "libretti_pdf_admin_write" on storage.objects
  for insert with check (bucket_id = 'libretti-pdf' and public.is_active_admin());

create policy "libretti_pdf_admin_delete" on storage.objects
  for delete using (bucket_id = 'libretti-pdf' and public.is_active_admin());
