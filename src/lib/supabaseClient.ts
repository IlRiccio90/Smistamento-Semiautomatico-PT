import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  deleteSyncMetaValue,
  getSyncMetaValue,
  setSyncMetaValue,
} from '../db/indexedDb';

export interface SupabaseRuntimeConfig {
  url: string;
  anonKey: string;
  source: 'env' | 'storage';
}

const LS_KEY = 'smistamento_pt_supabase_config_v1';
const IDB_URL_KEY = 'supabase_project_url';
const IDB_KEY_KEY = 'supabase_publishable_key';

let cachedClient: SupabaseClient | null = null;
let cachedSignature = '';

function normalizeSupabaseUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getSupabaseConfig(): SupabaseRuntimeConfig | null {
  const envUrl = normalizeSupabaseUrl(
    String(import.meta.env.VITE_SUPABASE_URL || '')
  );
  const envKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (envUrl && envKey && isValidHttpUrl(envUrl)) {
    return { url: envUrl, anonKey: envKey, source: 'env' };
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { url?: string; anonKey?: string };
        const url = normalizeSupabaseUrl(String(parsed?.url || ''));
        const anonKey = String(parsed?.anonKey || '').trim();
        if (url && anonKey && isValidHttpUrl(url)) {
          return { url, anonKey, source: 'storage' };
        }
      }
    } catch {
      // Ignora eventuale JSON corrotto in localStorage
    }
  }

  return null;
}

export async function loadPersistentSupabaseConfig(): Promise<SupabaseRuntimeConfig | null> {
  const current = getSupabaseConfig();
  if (current) {
    if (current.source === 'storage') {
      await Promise.all([
        setSyncMetaValue(IDB_URL_KEY, current.url),
        setSyncMetaValue(IDB_KEY_KEY, current.anonKey),
      ]).catch(() => {});
    }
    return current;
  }

  try {
    const [idbUrl, idbKey] = await Promise.all([
      getSyncMetaValue<string>(IDB_URL_KEY),
      getSyncMetaValue<string>(IDB_KEY_KEY),
    ]);
    if (idbUrl && idbKey && isValidHttpUrl(idbUrl)) {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          LS_KEY,
          JSON.stringify({ url: idbUrl, anonKey: idbKey })
        );
      }
      return { url: idbUrl, anonKey: idbKey, source: 'storage' };
    }
  } catch {
    // IndexedDB non disponibile
  }
  return null;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseConfig());
}

export function getSupabaseClient(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    cachedClient = null;
    cachedSignature = '';
    return null;
  }

  const sig = `${cfg.url}::${cfg.anonKey}`;
  if (!cachedClient || cachedSignature !== sig) {
    cachedClient = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    cachedSignature = sig;
  }
  return cachedClient;
}

export async function saveSupabaseConfig(
  rawUrl: string,
  rawAnonKey: string
): Promise<SupabaseClient> {
  const url = normalizeSupabaseUrl(rawUrl);
  const anonKey = rawAnonKey.trim();

  if (!url || !isValidHttpUrl(url)) {
    throw new Error(
      'Inserisci un Supabase Project URL valido (es. https://tuoprogetto.supabase.co).'
    );
  }
  if (!anonKey || anonKey.length < 20) {
    throw new Error('Inserisci una Supabase Publishable Key (Anon Key) valida.');
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ url, anonKey }));
  }
  await Promise.all([
    setSyncMetaValue(IDB_URL_KEY, url),
    setSyncMetaValue(IDB_KEY_KEY, anonKey),
  ]).catch(() => {});

  cachedClient = null;
  cachedSignature = '';
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Impossibile inizializzare il client Supabase.');
  }
  return client;
}

export async function clearSupabaseConfig(): Promise<void> {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(LS_KEY);
  }
  await Promise.all([
    deleteSyncMetaValue(IDB_URL_KEY),
    deleteSyncMetaValue(IDB_KEY_KEY),
  ]).catch(() => {});
  cachedClient = null;
  cachedSignature = '';
}

export async function testSupabaseConnection(
  rawUrl: string,
  rawAnonKey: string
): Promise<{
  ok: boolean;
  schemaReady: boolean;
  message: string;
}> {
  const url = normalizeSupabaseUrl(rawUrl);
  const anonKey = rawAnonKey.trim();

  if (!url || !isValidHttpUrl(url)) {
    return {
      ok: false,
      schemaReady: false,
      message:
        'L’URL inserito non è valido. Deve iniziare con https:// (es. https://xxxx.supabase.co).',
    };
  }
  if (!anonKey || anonKey.length < 20) {
    return {
      ok: false,
      schemaReady: false,
      message: 'La Publishable Key (Anon Key) sembra incompleta.',
    };
  }

  try {
    // 1. Verifica che il progetto Supabase risponda con la chiave pubblica
    const authResp = await fetch(`${url}/auth/v1/settings`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });
    if (authResp.status === 401 || authResp.status === 403) {
      return {
        ok: false,
        schemaReady: false,
        message: 'Supabase Publishable Key non valida per questo progetto.',
      };
    }
    if (!authResp.ok) {
      return {
        ok: false,
        schemaReady: false,
        message: 'Il progetto Supabase non ha risposto correttamente. Verifica l’URL.',
      };
    }

    // 2. Verifica se tabelle e funzioni RPC sono già state create nel database
    const probeClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: rpcErr } = await probeClient.rpc('check_admin_status', {
      target_email: 'andrea.graziano90@hotmail.it',
    });

    if (rpcErr) {
      const msg = (rpcErr.message || '').toLowerCase();
      if (
        msg.includes('could not find the function') ||
        msg.includes('does not exist') ||
        msg.includes('schema cache')
      ) {
        return {
          ok: true,
          schemaReady: false,
          message:
            'Connessione a Supabase riuscita! Esegui lo script SQL di inizializzazione nel tuo progetto Supabase per creare tabelle, sicurezza e il primo amministratore.',
        };
      }
      return {
        ok: false,
        schemaReady: false,
        message: 'Impossibile verificare le tabelle Supabase. Controlla la configurazione.',
      };
    }

    return {
      ok: true,
      schemaReady: true,
      message: 'Connessione a Supabase e database verificati con successo.',
    };
  } catch {
    return {
      ok: false,
      schemaReady: false,
      message:
        'Impossibile raggiungere il server Supabase. Controlla l’URL e la connessione Internet.',
    };
  }
}

export const SUPABASE_BOOTSTRAP_SQL = `-- Copia ed esegui questo script nel SQL Editor di Supabase
create extension if not exists "pgcrypto";

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

insert into public.admin_profiles (email, role, active, must_change_password, created_by)
values ('andrea.graziano90@hotmail.it', 'admin', true, true, 'system_bootstrap')
on conflict (email) do nothing;

create or replace function public.is_active_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_profiles ap
    where ap.active = true
      and (ap.user_id = auth.uid() or lower(ap.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

create or replace function public.check_admin_status(target_email text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text := lower(trim(coalesce(target_email, '')));
  v_profile public.admin_profiles%rowtype;
  v_auth_user record;
  v_auth_exists boolean := false;
  v_email_confirmed boolean := false;
  v_has_password boolean := false;
begin
  if v_email = '' then
    return jsonb_build_object('exists', false, 'active', false, 'auth_user_exists', false, 'email_confirmed', false, 'has_password', false, 'needs_initial_password', false, 'must_change_password', false);
  end if;
  select id, email_confirmed_at, confirmed_at, encrypted_password into v_auth_user from auth.users where lower(email) = v_email limit 1;
  if found then
    v_auth_exists := true;
    v_email_confirmed := (v_auth_user.email_confirmed_at is not null or v_auth_user.confirmed_at is not null);
    v_has_password := (coalesce(v_auth_user.encrypted_password, '') <> '');
  end if;
  if v_email = 'andrea.graziano90@hotmail.it' then
    insert into public.admin_profiles (user_id, email, role, active, must_change_password, created_by)
    values (v_auth_user.id, 'andrea.graziano90@hotmail.it', 'admin', true, not v_has_password, 'system_bootstrap')
    on conflict (email) do update set user_id = coalesce(public.admin_profiles.user_id, excluded.user_id), role = 'admin', active = true, must_change_password = case when v_has_password then false else public.admin_profiles.must_change_password end, updated_at = now();
  end if;
  select * into v_profile from public.admin_profiles where lower(email) = v_email limit 1;
  if not found then
    return jsonb_build_object('exists', false, 'active', false, 'auth_user_exists', v_auth_exists, 'email_confirmed', v_email_confirmed, 'has_password', v_has_password, 'needs_initial_password', false, 'must_change_password', false);
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

create or replace function public.claim_admin_profile(mark_password_set boolean default false)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_profile public.admin_profiles%rowtype;
  v_has_password boolean := false;
begin
  if v_uid is null or v_email = '' then
    return jsonb_build_object('authorized', false);
  end if;
  select (coalesce(encrypted_password, '') <> '') into v_has_password from auth.users where id = v_uid limit 1;
  if v_email = 'andrea.graziano90@hotmail.it' then
    insert into public.admin_profiles (user_id, email, role, active, must_change_password, created_by)
    values (v_uid, 'andrea.graziano90@hotmail.it', 'admin', true, false, 'system_bootstrap')
    on conflict (email) do update set user_id = coalesce(public.admin_profiles.user_id, v_uid), role = 'admin', active = true, must_change_password = false, updated_at = now();
  end if;
  select * into v_profile from public.admin_profiles where lower(email) = v_email limit 1;
  if not found or not v_profile.active then
    return jsonb_build_object('authorized', false);
  end if;
  update public.admin_profiles
  set user_id = coalesce(user_id, v_uid),
      role = case when coalesce(role, '') <> 'admin' then 'admin' else role end,
      must_change_password = case when (mark_password_set or v_has_password) then false else must_change_password end,
      updated_at = now()
  where id = v_profile.id returning * into v_profile;
  return jsonb_build_object('authorized', true, 'id', v_profile.id, 'email', v_profile.email, 'role', v_profile.role, 'active', v_profile.active, 'must_change_password', v_profile.must_change_password);
end;
$$;
grant execute on function public.claim_admin_profile(boolean) to authenticated;

create table if not exists public.centers (
  id uuid primary key default gen_random_uuid(),
  name text not null, notes text not null default '',
  version integer not null default 1, pdf_count integer not null default 0,
  address_count integer not null default 0, zones text[] not null default '{}',
  comuni text[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.center_pdfs (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  file_name text not null, file_hash text not null default '', zone_number text not null,
  frazionario text, storage_path text not null default '', file_size bigint not null default 0,
  page_count integer not null default 0, extracted_count integer not null default 0,
  extraction_method text not null default 'native', version_added integer not null default 1,
  version_deleted integer, deleted boolean not null default false,
  imported_at timestamptz not null default now()
);
create table if not exists public.center_addresses (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  pdf_id uuid not null references public.center_pdfs(id) on delete cascade,
  zona text not null, subzona text not null, prog text not null default '',
  comune text not null, comune_norm text not null, frazione text not null default '',
  tipo_strada text not null, tipo_strada_norm text not null,
  nome_strada text not null, nome_strada_norm text not null,
  nome_tokens text[] not null default '{}', civico_raw text not null default '',
  civico_num integer, civico_suffix text not null default '',
  civico_start integer, civico_end integer,
  parity text not null default 'all' check (parity in ('all', 'even', 'odd')),
  is_snc boolean not null default false, scala text not null default '',
  note text not null default '', raw_address text not null,
  version_changed integer not null default 1, deleted boolean not null default false
);
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null, actor_role text not null check (actor_role in ('admin', 'operator', 'system')),
  action text not null, center_id uuid, center_name text,
  details text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.center_backups (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null, center_name text not null, center_version integer not null,
  reason text not null default 'manual', created_by text not null,
  payload jsonb not null, created_at timestamptz not null default now()
);

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
create policy "admin_profiles_select_admin" on public.admin_profiles for select using (public.is_active_admin());
create policy "admin_profiles_insert_admin" on public.admin_profiles for insert with check (public.is_active_admin());
create policy "admin_profiles_update_admin" on public.admin_profiles for update using (public.is_active_admin());
create policy "admin_profiles_bootstrap_self_insert" on public.admin_profiles for insert with check (lower(email) = 'andrea.graziano90@hotmail.it' and lower(coalesce(auth.jwt() ->> 'email', '')) = 'andrea.graziano90@hotmail.it');
create policy "admin_profiles_bootstrap_self_update" on public.admin_profiles for update using (lower(email) = 'andrea.graziano90@hotmail.it' and lower(coalesce(auth.jwt() ->> 'email', '')) = 'andrea.graziano90@hotmail.it');

drop policy if exists "centers_select_all" on public.centers;
drop policy if exists "centers_write_admin" on public.centers;
create policy "centers_select_all" on public.centers for select using (true);
create policy "centers_write_admin" on public.centers for all using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "center_pdfs_select_all" on public.center_pdfs;
drop policy if exists "center_pdfs_write_admin" on public.center_pdfs;
create policy "center_pdfs_select_all" on public.center_pdfs for select using (true);
create policy "center_pdfs_write_admin" on public.center_pdfs for all using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "center_addresses_select_all" on public.center_addresses;
drop policy if exists "center_addresses_write_admin" on public.center_addresses;
create policy "center_addresses_select_all" on public.center_addresses for select using (true);
create policy "center_addresses_write_admin" on public.center_addresses for all using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "activity_logs_select_admin" on public.activity_logs;
drop policy if exists "activity_logs_insert_admin" on public.activity_logs;
create policy "activity_logs_select_admin" on public.activity_logs for select using (public.is_active_admin());
create policy "activity_logs_insert_admin" on public.activity_logs for insert with check (public.is_active_admin() or actor_role = 'operator');

drop policy if exists "center_backups_admin_only" on public.center_backups;
create policy "center_backups_admin_only" on public.center_backups for all using (public.is_active_admin()) with check (public.is_active_admin());

insert into storage.buckets (id, name, public) values ('libretti-pdf', 'libretti-pdf', false) on conflict (id) do nothing;
drop policy if exists "libretti_pdf_admin_read" on storage.objects;
drop policy if exists "libretti_pdf_admin_write" on storage.objects;
drop policy if exists "libretti_pdf_admin_delete" on storage.objects;
create policy "libretti_pdf_admin_read" on storage.objects for select using (bucket_id = 'libretti-pdf' and public.is_active_admin());
create policy "libretti_pdf_admin_write" on storage.objects for insert with check (bucket_id = 'libretti-pdf' and public.is_active_admin());
create policy "libretti_pdf_admin_delete" on storage.objects for delete using (bucket_id = 'libretti-pdf' and public.is_active_admin());`;
