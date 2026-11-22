-- ============================================================================
-- SMISTAMENTO SEMIAUTOMATICO PT - Schema PostgreSQL, RLS, Versioning e Storage
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

-- Funzione helper per verificare se l'utente autenticato è un amministratore attivo
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

-- admin_profiles: solo amministratori attivi
create policy "admin_profiles_select_admin" on public.admin_profiles
  for select using (public.is_active_admin());
create policy "admin_profiles_insert_admin" on public.admin_profiles
  for insert with check (public.is_active_admin());
create policy "admin_profiles_update_admin" on public.admin_profiles
  for update using (public.is_active_admin());

-- centers: operatori possono leggere, solo admin possono scrivere
create policy "centers_select_all" on public.centers
  for select using (true);
create policy "centers_write_admin" on public.centers
  for all using (public.is_active_admin()) with check (public.is_active_admin());

-- center_pdfs: operatori possono leggere metadati non eliminati, solo admin possono modificare
create policy "center_pdfs_select_all" on public.center_pdfs
  for select using (true);
create policy "center_pdfs_write_admin" on public.center_pdfs
  for all using (public.is_active_admin()) with check (public.is_active_admin());

-- center_addresses: operatori possono sincronizzare, solo admin possono modificare
create policy "center_addresses_select_all" on public.center_addresses
  for select using (true);
create policy "center_addresses_write_admin" on public.center_addresses
  for all using (public.is_active_admin()) with check (public.is_active_admin());

-- activity_logs: solo admin leggono, chiunque può inviare sync log controllati o admin inserisce
create policy "activity_logs_select_admin" on public.activity_logs
  for select using (public.is_active_admin());
create policy "activity_logs_insert_admin" on public.activity_logs
  for insert with check (public.is_active_admin() or actor_role = 'operator');

-- center_backups: solo admin attivi
create policy "center_backups_admin_only" on public.center_backups
  for all using (public.is_active_admin()) with check (public.is_active_admin());

-- ============================================================================
-- STORAGE BUCKET PER PDF ORIGINALI
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('libretti-pdf', 'libretti-pdf', false)
on conflict (id) do nothing;

create policy "libretti_pdf_admin_read" on storage.objects
  for select using (bucket_id = 'libretti-pdf' and public.is_active_admin());

create policy "libretti_pdf_admin_write" on storage.objects
  for insert with check (bucket_id = 'libretti-pdf' and public.is_active_admin());

create policy "libretti_pdf_admin_delete" on storage.objects
  for delete using (bucket_id = 'libretti-pdf' and public.is_active_admin());
