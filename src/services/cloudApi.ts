import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabaseClient';
import type {
  ActivityLogEntry,
  AddressRecord,
  AdminAuthDiagnostics,
  AdminSession,
  AdminUserRecord,
  CenterBackupRecord,
  CloudSyncDeltaResponse,
  DeliveryCenter,
  PdfDocumentRecord,
} from '../types/sorting';

const INITIAL_ADMIN_EMAIL = 'andrea.graziano90@hotmail.it';

function requireSupabase(): SupabaseClient {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error(
      'Supabase non configurato. Inserisci Project URL e Publishable Key nella schermata di configurazione amministratore.'
    );
  }
  return sb;
}

export function toFriendlyError(err: unknown, fallback = 'Operazione non riuscita.'): Error {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err || '');

  const msg = raw.trim();
  const lower = msg.toLowerCase();

  if (!msg) return new Error(fallback);

  // Evita sempre errori tecnici HTML/JSON grezzi
  if (
    lower.includes('unexpected token') ||
    lower.includes('<!doctype') ||
    lower.includes('<html') ||
    lower.includes('json')
  ) {
    return new Error(
      'Risposta non valida dal servizio Supabase. Verifica Project URL, Publishable Key e connessione di rete.'
    );
  }

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) {
    return new Error(
      'Impossibile contattare Supabase. Controlla la connessione Internet o l’URL del progetto.'
    );
  }

  if (lower.includes('invalid login credentials')) {
    return new Error('Email o password non corrette.');
  }

  if (lower.includes('email not confirmed')) {
    return new Error(
      'Email non ancora confermata. Apri il link ricevuto nella tua casella di posta prima di accedere.'
    );
  }

  if (lower.includes('user already registered')) {
    return new Error(
      'Questo indirizzo email è già registrato su Supabase Auth. Usa il login con la tua password oppure "Password dimenticata".'
    );
  }

  if (lower.includes('password should be at least')) {
    return new Error('La password deve contenere almeno 6-8 caratteri.');
  }

  if (lower.includes('new password should be different from the old password')) {
    return new Error('La nuova password deve essere diversa da quella attuale.');
  }

  if (lower.includes('for security purposes, you can only request this after')) {
    return new Error(
      'Richiesta già inviata da poco. Attendi qualche decina di secondi prima di riprovare.'
    );
  }

  if (lower.includes('email rate limit exceeded')) {
    return new Error(
      'Limite invio email temporaneamente raggiunto. Riprova tra qualche minuto.'
    );
  }

  if (lower.includes('auth session missing')) {
    return new Error('Sessione amministratore assente o scaduta. Effettua nuovamente il login.');
  }

  if (
    lower.includes('could not find the function') ||
    lower.includes('does not exist') ||
    lower.includes('schema cache')
  ) {
    return new Error(
      'Il database Supabase non è ancora inizializzato. Esegui lo script SQL nella schermata di configurazione.'
    );
  }

  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return new Error('Permessi insufficienti per questa operazione amministrativa.');
  }

  return new Error(msg);
}

function throwIfPgError(err: PostgrestError | null, fallback: string) {
  if (err) {
    throw toFriendlyError(err, fallback);
  }
}

// ---- MAPPERS ----

function mapCenterRow(row: Record<string, unknown>): DeliveryCenter {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    notes: String(row.notes || ''),
    version: Number(row.version ?? 1),
    pdfCount: Number(row.pdf_count ?? 0),
    addressCount: Number(row.address_count ?? 0),
    zones: Array.isArray(row.zones) ? row.zones.map(String) : [],
    comuni: Array.isArray(row.comuni) ? row.comuni.map(String) : [],
    createdAt: row.created_at ? Date.parse(String(row.created_at)) : Date.now(),
    updatedAt: row.updated_at ? Date.parse(String(row.updated_at)) : Date.now(),
  };
}

function mapPdfRow(row: Record<string, unknown>): PdfDocumentRecord {
  return {
    id: String(row.id),
    centerId: String(row.center_id),
    fileName: String(row.file_name || ''),
    fileHash: String(row.file_hash || ''),
    zoneNumber: String(row.zone_number || '1'),
    frazionario: row.frazionario ? String(row.frazionario) : undefined,
    storagePath: row.storage_path ? String(row.storage_path) : undefined,
    fileSize: Number(row.file_size ?? 0),
    pageCount: Number(row.page_count ?? 0),
    extractedCount: Number(row.extracted_count ?? 0),
    extractionMethod: (row.extraction_method as PdfDocumentRecord['extractionMethod']) || 'native',
    versionAdded: Number(row.version_added ?? 1),
    importedAt: row.imported_at ? Date.parse(String(row.imported_at)) : Date.now(),
  };
}

function mapAddressRow(row: Record<string, unknown>): AddressRecord {
  return {
    id: String(row.id),
    centerId: String(row.center_id),
    pdfId: String(row.pdf_id),
    zona: String(row.zona || ''),
    subzona: String(row.subzona || ''),
    prog: String(row.prog || ''),
    comune: String(row.comune || ''),
    comuneNorm: String(row.comune_norm || ''),
    frazione: String(row.frazione || ''),
    tipoStrada: String(row.tipo_strada || ''),
    tipoStradaNorm: String(row.tipo_strada_norm || ''),
    nomeStrada: String(row.nome_strada || ''),
    nomeStradaNorm: String(row.nome_strada_norm || ''),
    nomeTokens: Array.isArray(row.nome_tokens) ? row.nome_tokens.map(String) : [],
    civicoRaw: String(row.civico_raw || ''),
    civicoNum: row.civico_num !== null && row.civico_num !== undefined ? Number(row.civico_num) : null,
    civicoSuffix: String(row.civico_suffix || ''),
    civicoStart:
      row.civico_start !== null && row.civico_start !== undefined
        ? Number(row.civico_start)
        : null,
    civicoEnd:
      row.civico_end !== null && row.civico_end !== undefined ? Number(row.civico_end) : null,
    parity: (row.parity as AddressRecord['parity']) || 'all',
    isSnc: Boolean(row.is_snc),
    scala: String(row.scala || ''),
    note: String(row.note || ''),
    rawAddress: String(row.raw_address || ''),
    versionChanged: Number(row.version_changed ?? 1),
  };
}

function addressToDbRow(addr: AddressRecord, versionChanged: number) {
  return {
    id: addr.id,
    center_id: addr.centerId,
    pdf_id: addr.pdfId,
    zona: addr.zona,
    subzona: addr.subzona,
    prog: addr.prog,
    comune: addr.comune,
    comune_norm: addr.comuneNorm,
    frazione: addr.frazione,
    tipo_strada: addr.tipoStrada,
    tipo_strada_norm: addr.tipoStradaNorm,
    nome_strada: addr.nomeStrada,
    nome_strada_norm: addr.nomeStradaNorm,
    nome_tokens: addr.nomeTokens,
    civico_raw: addr.civicoRaw,
    civico_num: addr.civicoNum,
    civico_suffix: addr.civicoSuffix,
    civico_start: addr.civicoStart,
    civico_end: addr.civicoEnd,
    parity: addr.parity,
    is_snc: addr.isSnc,
    scala: addr.scala,
    note: addr.note,
    raw_address: addr.rawAddress,
    version_changed: versionChanged,
    deleted: false,
  };
}

async function fetchAllCenterAddresses(
  sb: SupabaseClient,
  centerId: string,
  onlySinceVersion = 0
): Promise<Array<Record<string, unknown>>> {
  const PAGE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  let from = 0;

  while (true) {
    let query = sb
      .from('center_addresses')
      .select('*')
      .eq('center_id', centerId)
      .range(from, from + PAGE - 1);

    if (onlySinceVersion > 0) {
      query = query.gt('version_changed', onlySinceVersion);
    } else {
      query = query.eq('deleted', false);
    }

    const { data, error } = await query;
    throwIfPgError(error, 'Errore caricamento indirizzi dal cloud.');
    const batch = (data || []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return rows;
}

async function insertLog(
  sb: SupabaseClient,
  entry: {
    actorEmail: string;
    actorRole: 'admin' | 'operator' | 'system';
    action: ActivityLogEntry['action'];
    centerId?: string;
    centerName?: string;
    details: string;
  }
) {
  await sb
    .from('activity_logs')
    .insert({
      actor_email: entry.actorEmail,
      actor_role: entry.actorRole,
      action: entry.action,
      center_id: entry.centerId ?? null,
      center_name: entry.centerName ?? null,
      details: entry.details,
    })
    .then(() => {});
}

async function recomputeCloudCenterStats(
  sb: SupabaseClient,
  centerId: string,
  bumpVersion = true
): Promise<DeliveryCenter> {
  const { data: cRow, error: cErr } = await sb
    .from('centers')
    .select('*')
    .eq('id', centerId)
    .single();
  throwIfPgError(cErr, 'Centro non trovato sul cloud.');

  const { data: pdfRows, error: pErr } = await sb
    .from('center_pdfs')
    .select('zone_number')
    .eq('center_id', centerId)
    .eq('deleted', false);
  throwIfPgError(pErr, 'Errore lettura PDF del Centro.');

  const addrRows = await fetchAllCenterAddresses(sb, centerId, 0);

  const zonesSet = new Set<string>();
  const comuniSet = new Set<string>();
  for (const p of pdfRows || []) {
    if (p.zone_number) zonesSet.add(String(p.zone_number));
  }
  for (const a of addrRows) {
    if (a.zona) zonesSet.add(String(a.zona));
    if (a.comune) comuniSet.add(String(a.comune));
  }

  const nextVersion = bumpVersion
    ? Number((cRow as Record<string, unknown>).version ?? 1) + 1
    : Number((cRow as Record<string, unknown>).version ?? 1);

  const { data: updated, error: uErr } = await sb
    .from('centers')
    .update({
      version: nextVersion,
      pdf_count: (pdfRows || []).length,
      address_count: addrRows.length,
      zones: Array.from(zonesSet).sort((a, b) => a.localeCompare(b, 'it', { numeric: true })),
      comuni: Array.from(comuniSet).sort((a, b) => a.localeCompare(b, 'it')),
      updated_at: new Date().toISOString(),
    })
    .eq('id', centerId)
    .select('*')
    .single();
  throwIfPgError(uErr, 'Errore aggiornamento statistiche Centro.');

  return mapCenterRow(updated as Record<string, unknown>);
}

async function createAutoBackupSnapshot(
  sb: SupabaseClient,
  centerId: string,
  reason: 'auto' | 'manual' | 'export',
  actorEmail: string
) {
  const { data: cRow } = await sb.from('centers').select('*').eq('id', centerId).maybeSingle();
  if (!cRow) return;

  const { data: pdfRows } = await sb
    .from('center_pdfs')
    .select('*')
    .eq('center_id', centerId)
    .eq('deleted', false);
  const addrRows = await fetchAllCenterAddresses(sb, centerId, 0);

  const center = mapCenterRow(cRow as Record<string, unknown>);
  const pdfs = (pdfRows || []).map((r) => mapPdfRow(r as Record<string, unknown>));
  const addresses = addrRows.map(mapAddressRow);

  await sb.from('center_backups').insert({
    center_id: center.id,
    center_name: center.name,
    center_version: center.version,
    reason,
    created_by: actorEmail,
    payload: { center, pdfs, addresses },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// PUBLIC / OPERATOR SYNC FUNCTIONS (SUPABSE SDK)
// ============================================================================

export async function fetchCloudCenters(): Promise<DeliveryCenter[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('centers')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) {
    throw toFriendlyError(error, 'Impossibile caricare i Centri di Recapito.');
  }
  return (data || []).map((r) => mapCenterRow(r as Record<string, unknown>));
}

export async function fetchCenterSyncDelta(
  centerId: string,
  sinceVersion = 0
): Promise<CloudSyncDeltaResponse> {
  const sb = requireSupabase();
  const { data: cRow, error: cErr } = await sb
    .from('centers')
    .select('*')
    .eq('id', centerId)
    .single();
  throwIfPgError(cErr, 'Centro non trovato sul server.');

  const center = mapCenterRow(cRow as Record<string, unknown>);
  const isDelta = sinceVersion > 0 && sinceVersion < center.version;

  if (!isDelta) {
    const { data: pdfRows, error: pErr } = await sb
      .from('center_pdfs')
      .select('*')
      .eq('center_id', centerId)
      .eq('deleted', false);
    throwIfPgError(pErr, 'Errore caricamento metadati PDF.');

    const addrRows = await fetchAllCenterAddresses(sb, centerId, 0);
    return {
      mode: 'full',
      center,
      fromVersion: 0,
      toVersion: center.version,
      upsertedPdfs: (pdfRows || []).map((r) => mapPdfRow(r as Record<string, unknown>)),
      deletedPdfIds: [],
      upsertedAddresses: addrRows.map(mapAddressRow),
      deletedAddressIds: [],
    };
  }

  const { data: pdfRows, error: pErr } = await sb
    .from('center_pdfs')
    .select('*')
    .eq('center_id', centerId);
  throwIfPgError(pErr, 'Errore caricamento aggiornamenti PDF.');

  const upsertedPdfs: PdfDocumentRecord[] = [];
  const deletedPdfIds: string[] = [];
  for (const row of (pdfRows || []) as Array<Record<string, unknown>>) {
    if (row.deleted && Number(row.version_deleted ?? 0) > sinceVersion) {
      deletedPdfIds.push(String(row.id));
    } else if (!row.deleted && Number(row.version_added ?? 0) > sinceVersion) {
      upsertedPdfs.push(mapPdfRow(row));
    }
  }

  const changedAddrRows = await fetchAllCenterAddresses(sb, centerId, sinceVersion);
  const upsertedAddresses: AddressRecord[] = [];
  const deletedAddressIds: string[] = [];
  for (const row of changedAddrRows) {
    if (row.deleted) {
      deletedAddressIds.push(String(row.id));
    } else {
      upsertedAddresses.push(mapAddressRow(row));
    }
  }

  return {
    mode: 'delta',
    center,
    fromVersion: sinceVersion,
    toVersion: center.version,
    upsertedPdfs,
    deletedPdfIds,
    upsertedAddresses,
    deletedAddressIds,
  };
}

export async function sendSyncAck(
  centerId: string,
  action: 'sincronizzazione' | 'aggiornamento_incrementale',
  version: number
): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  const { data: cRow } = await sb
    .from('centers')
    .select('name')
    .eq('id', centerId)
    .maybeSingle();

  await insertLog(sb, {
    actorEmail: 'operatore-dispositivo',
    actorRole: 'operator',
    action,
    centerId,
    centerName: cRow?.name ? String(cRow.name) : undefined,
    details: `${
      action === 'aggiornamento_incrementale' ? 'Aggiornamento incrementale' : 'Sincronizzazione'
    } dispositivo completata (v${version})`,
  });
}

// ============================================================================
// AUTHENTICATION (100% OFFICIAL SUPABASE AUTH SDK)
// ============================================================================

export async function checkAdminEmail(email: string): Promise<{
  exists: boolean;
  active: boolean;
  authUserExists: boolean | null;
  emailConfirmed: boolean | null;
  hasPassword: boolean | null;
  needsInitialPasswordSetup: boolean;
  mustChangePassword: boolean;
  backendMode: 'supabase';
}> {
  const sb = requireSupabase();
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return {
      exists: false,
      active: false,
      authUserExists: false,
      emailConfirmed: false,
      hasPassword: false,
      needsInitialPasswordSetup: false,
      mustChangePassword: false,
      backendMode: 'supabase',
    };
  }

  const { data, error } = await sb.rpc('check_admin_status', {
    target_email: normalized,
  });
  if (error) {
    throw toFriendlyError(error, 'Impossibile verificare l’account amministratore.');
  }

  const res = (data || {}) as {
    exists?: boolean;
    active?: boolean;
    auth_user_exists?: boolean;
    email_confirmed?: boolean;
    has_password?: boolean;
    needs_initial_password?: boolean;
    must_change_password?: boolean;
  };

  // Mostra "Crea password" SOLO se abbiamo conferma diretta da auth.users che l'utente non esiste o non ha password.
  // Se la RPC precedente sul DB non espone auth_user_exists, NON forzare "Crea password" e lascia accedere via Login.
  const hasRealAuthCheck = typeof res.auth_user_exists === 'boolean';
  const authUserExists = hasRealAuthCheck ? Boolean(res.auth_user_exists) : null;
  const emailConfirmed =
    typeof res.email_confirmed === 'boolean' ? Boolean(res.email_confirmed) : null;
  const hasPassword = typeof res.has_password === 'boolean' ? Boolean(res.has_password) : null;

  const needsInitialPasswordSetup = hasRealAuthCheck
    ? !res.auth_user_exists || !res.has_password
    : false;

  return {
    exists: Boolean(res.exists),
    active: Boolean(res.active),
    authUserExists,
    emailConfirmed,
    hasPassword,
    needsInitialPasswordSetup,
    mustChangePassword: false,
    backendMode: 'supabase',
  };
}

export async function verifyAndEnsureAdminAccess(): Promise<{
  session: AdminSession | null;
  diagnostics: AdminAuthDiagnostics;
}> {
  const sb = getSupabaseClient();
  if (!sb) {
    return {
      session: null,
      diagnostics: {
        email: '',
        authUserExists: false,
        emailConfirmed: false,
        validSession: false,
        adminProfileExists: false,
        hasAdminRole: false,
        allPassed: false,
        errorMessage: 'Supabase non configurato.',
      },
    };
  }

  const { data: sessionRes, error: sessErr } = await sb.auth.getSession();
  const currentSession = sessionRes?.session ?? null;
  if (sessErr || !currentSession?.access_token) {
    return {
      session: null,
      diagnostics: {
        email: '',
        authUserExists: false,
        emailConfirmed: false,
        validSession: false,
        adminProfileExists: false,
        hasAdminRole: false,
        allPassed: false,
      },
    };
  }

  // Conferma live con Supabase Auth server
  const { data: userRes, error: userErr } = await sb.auth.getUser();
  const authUser = !userErr && userRes?.user ? userRes.user : currentSession.user;
  const validSession = Boolean(currentSession.access_token && authUser?.id);
  const authUserExists = Boolean(authUser?.id && authUser?.email);
  const email = (authUser?.email || '').trim().toLowerCase();
  const emailConfirmed = Boolean(
    authUser?.email_confirmed_at || (authUser as { confirmed_at?: string } | null)?.confirmed_at
  );

  if (!validSession || !authUserExists) {
    return {
      session: null,
      diagnostics: {
        email,
        authUserExists,
        emailConfirmed,
        validSession,
        adminProfileExists: false,
        hasAdminRole: false,
        allPassed: false,
        errorMessage: 'Sessione non valida o utente Auth non trovato.',
      },
    };
  }

  // Step b & c: verifica/crea automaticamente profilo admin e ruolo 'admin'
  type ClaimResult = {
    authorized?: boolean;
    email?: string;
    role?: string;
    active?: boolean;
  };
  let claim: ClaimResult | null = null;

  const { data: claimData } = await sb.rpc('claim_admin_profile', {
    mark_password_set: true,
  });
  if (claimData && typeof claimData === 'object') {
    claim = claimData as ClaimResult;
  }

  // Verifica diretta tabella admin_profiles
  let { data: profileRow } = await sb
    .from('admin_profiles')
    .select('id, user_id, email, role, active')
    .ilike('email', email)
    .maybeSingle();

  // Se profilo admin non esiste (es. andrea.graziano90@hotmail.it o primo login dopo Auth manuale), crealo automaticamente
  if (!profileRow && email === INITIAL_ADMIN_EMAIL) {
    const { data: upserted } = await sb
      .from('admin_profiles')
      .upsert(
        {
          user_id: authUser.id,
          email,
          role: 'admin',
          active: true,
          must_change_password: false,
          created_by: 'auto_post_login',
        },
        { onConflict: 'email' }
      )
      .select('id, user_id, email, role, active')
      .maybeSingle();
    if (upserted) {
      profileRow = upserted;
    }
  }

  // Se il profilo esiste ma manca user_id o il ruolo 'admin' non è assegnato (per primo admin), assegna automaticamente
  if (
    profileRow &&
    ((email === INITIAL_ADMIN_EMAIL &&
      (profileRow.role !== 'admin' || !profileRow.active)) ||
      !profileRow.user_id)
  ) {
    const { data: repaired } = await sb
      .from('admin_profiles')
      .update({
        user_id: profileRow.user_id || authUser.id,
        role: email === INITIAL_ADMIN_EMAIL ? 'admin' : profileRow.role || 'admin',
        active: email === INITIAL_ADMIN_EMAIL ? true : Boolean(profileRow.active),
        must_change_password: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profileRow.id)
      .select('id, user_id, email, role, active')
      .maybeSingle();
    if (repaired) {
      profileRow = repaired;
    }
  }

  const adminProfileExists = Boolean(profileRow?.id || claim?.authorized);
  const hasAdminRole = Boolean(
    (profileRow && profileRow.active && profileRow.role === 'admin') ||
      (claim?.authorized && (claim.role || 'admin') === 'admin')
  );

  const allPassed =
    authUserExists &&
    emailConfirmed &&
    validSession &&
    adminProfileExists &&
    hasAdminRole;

  let errorMessage: string | undefined;
  if (!emailConfirmed) {
    errorMessage = 'Email non confermata in Supabase Authentication.';
  } else if (!adminProfileExists) {
    errorMessage =
      'Profilo amministratore non trovato in admin_profiles o permessi insufficienti.';
  } else if (!hasAdminRole) {
    errorMessage = 'Account privo di ruolo admin attivo.';
  }

  const diagnostics: AdminAuthDiagnostics = {
    email,
    authUserExists,
    emailConfirmed,
    validSession,
    adminProfileExists,
    hasAdminRole,
    allPassed,
    errorMessage,
  };

  if (!allPassed) {
    return { session: null, diagnostics };
  }

  return {
    session: {
      token: currentSession.access_token,
      email,
      role: 'admin',
      mustChangePassword: false,
      backendMode: 'supabase',
    },
    diagnostics,
  };
}

export async function setupFirstAdminPasswordApi(
  email: string,
  password: string
): Promise<{
  session: AdminSession | null;
  diagnostics?: AdminAuthDiagnostics;
  emailConfirmationPending: boolean;
  message?: string;
}> {
  const sb = requireSupabase();
  const normalized = email.trim().toLowerCase();

  if (password.length < 8) {
    throw new Error('La password deve contenere almeno 8 caratteri.');
  }

  const status = await checkAdminEmail(normalized);
  if (!status.exists || !status.active) {
    throw new Error('Account amministratore non autorizzato o disattivato.');
  }
  if (status.authUserExists === true && status.hasPassword === true) {
    throw new Error(
      'Questo account possiede già una password. Effettua il login con email e password.'
    );
  }

  const { data, error } = await sb.auth.signUp({
    email: normalized,
    password,
    options: {
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes('user already registered')) {
      const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({
        email: normalized,
        password,
      });
      if (!signInErr && signInData.session) {
        const verified = await verifyAndEnsureAdminAccess();
        if (verified.session) {
          await insertLog(sb, {
            actorEmail: normalized,
            actorRole: 'admin',
            action: 'login_admin',
            details: 'Accesso amministratore verificato',
          });
        }
        return {
          session: verified.session,
          diagnostics: verified.diagnostics,
          emailConfirmationPending: false,
        };
      }
    }
    throw toFriendlyError(error, 'Impossibile creare la password iniziale.');
  }

  if (!data.session) {
    return {
      session: null,
      emailConfirmationPending: true,
      message: `Password creata per ${normalized}. Controlla la tua email per confermare l'indirizzo e poi accedi con la password appena creata.`,
    };
  }

  const verified = await verifyAndEnsureAdminAccess();
  if (verified.session) {
    await insertLog(sb, {
      actorEmail: normalized,
      actorRole: 'admin',
      action: 'login_admin',
      details: 'Primo accesso e creazione password amministratore',
    });
  }

  return {
    session: verified.session,
    diagnostics: verified.diagnostics,
    emailConfirmationPending: false,
  };
}

export async function loginAdminApi(
  email: string,
  password: string
): Promise<{
  session: AdminSession | null;
  diagnostics: AdminAuthDiagnostics;
}> {
  const sb = requireSupabase();
  const normalized = email.trim().toLowerCase();

  const { data, error } = await sb.auth.signInWithPassword({
    email: normalized,
    password,
  });

  if (error || !data.session) {
    throw toFriendlyError(error, 'Email o password non valide.');
  }

  const verified = await verifyAndEnsureAdminAccess();
  if (verified.session) {
    await insertLog(sb, {
      actorEmail: normalized,
      actorRole: 'admin',
      action: 'login_admin',
      details: 'Accesso amministratore effettuato',
    });
  }

  return verified;
}

export async function restoreAdminSessionApi(): Promise<AdminSession | null> {
  const verified = await verifyAndEnsureAdminAccess();
  return verified.session;
}

export async function changeAdminPasswordApi(
  _token: string,
  newPassword: string
): Promise<void> {
  const sb = requireSupabase();
  if (newPassword.length < 8) {
    throw new Error('La nuova password deve contenere almeno 8 caratteri.');
  }

  const { data, error } = await sb.auth.updateUser({ password: newPassword });
  if (error) {
    throw toFriendlyError(error, 'Impossibile aggiornare la password.');
  }

  await sb.rpc('claim_admin_profile', { mark_password_set: true });

  const email = data.user?.email || INITIAL_ADMIN_EMAIL;
  await insertLog(sb, {
    actorEmail: email,
    actorRole: 'admin',
    action: 'gestione_admin',
    details: 'Password amministratore aggiornata',
  });
}

export async function requestPasswordRecoveryApi(
  email: string
): Promise<{ sent: boolean; message: string }> {
  const sb = requireSupabase();
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Inserisci un indirizzo email valido.');
  }

  // Verifica prima che l'account sia tra gli amministratori abilitati (creando il bootstrap se necessario)
  const status = await checkAdminEmail(normalized);
  if (!status.exists || !status.active) {
    throw new Error('Nessun account amministratore attivo corrisponde a questa email.');
  }

  const { error } = await sb.auth.resetPasswordForEmail(normalized, {
    redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
  });
  if (error) {
    throw toFriendlyError(error, 'Impossibile inviare l’email di recupero password.');
  }

  return {
    sent: true,
    message: `Email di recupero inviata a ${normalized}. Apri il link ricevuto nella posta per impostare una nuova password.`,
  };
}

export async function logoutAdminApi(_token: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  try {
    const { data } = await sb.auth.getUser();
    if (data.user?.email) {
      await insertLog(sb, {
        actorEmail: data.user.email.toLowerCase(),
        actorRole: 'admin',
        action: 'logout_admin',
        details: 'Disconnessione amministratore',
      });
    }
  } catch {
    // Best effort log
  }
  await sb.auth.signOut().catch(() => {});
}

// ============================================================================
// ADMIN CENTERS & PDFS (SUPABSE DATABASE + STORAGE)
// ============================================================================

async function getCurrentAdminEmail(sb: SupabaseClient): Promise<string> {
  const { data } = await sb.auth.getUser();
  return data.user?.email?.toLowerCase() || INITIAL_ADMIN_EMAIL;
}

export async function adminCreateCenterApi(
  _token: string,
  name: string,
  notes: string
): Promise<DeliveryCenter> {
  const sb = requireSupabase();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Il nome del Centro di Recapito è obbligatorio.');

  const actorEmail = await getCurrentAdminEmail(sb);
  const { data, error } = await sb
    .from('centers')
    .insert({
      name: trimmed,
      notes: notes.trim(),
      version: 1,
      pdf_count: 0,
      address_count: 0,
      zones: [],
      comuni: [],
    })
    .select('*')
    .single();
  throwIfPgError(error, 'Impossibile creare il Centro di Recapito.');

  const center = mapCenterRow(data as Record<string, unknown>);
  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'creazione_centro',
    centerId: center.id,
    centerName: center.name,
    details: `Creato nuovo Centro di Recapito "${center.name}"`,
  });
  return center;
}

export async function adminUpdateCenterApi(
  _token: string,
  centerId: string,
  name: string,
  notes: string
): Promise<DeliveryCenter> {
  const sb = requireSupabase();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Il nome del Centro è obbligatorio.');

  const actorEmail = await getCurrentAdminEmail(sb);
  const { data: existing, error: exErr } = await sb
    .from('centers')
    .select('version')
    .eq('id', centerId)
    .single();
  throwIfPgError(exErr, 'Centro non trovato.');

  const nextVer = Number(existing?.version ?? 1) + 1;
  const { data, error } = await sb
    .from('centers')
    .update({
      name: trimmed,
      notes: notes.trim(),
      version: nextVer,
      updated_at: new Date().toISOString(),
    })
    .eq('id', centerId)
    .select('*')
    .single();
  throwIfPgError(error, 'Impossibile aggiornare il Centro.');

  const center = mapCenterRow(data as Record<string, unknown>);
  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'modifica_centro',
    centerId: center.id,
    centerName: center.name,
    details: `Aggiornato Centro "${center.name}" (v${center.version})`,
  });
  return center;
}

export async function adminDeleteCenterApi(_token: string, centerId: string): Promise<void> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  const { data: cRow } = await sb
    .from('centers')
    .select('name')
    .eq('id', centerId)
    .maybeSingle();

  await createAutoBackupSnapshot(sb, centerId, 'auto', actorEmail);

  const { data: pdfRows } = await sb
    .from('center_pdfs')
    .select('storage_path')
    .eq('center_id', centerId);
  const storagePaths = (pdfRows || [])
    .map((p) => String(p.storage_path || ''))
    .filter(Boolean);
  if (storagePaths.length > 0) {
    await sb.storage.from('libretti-pdf').remove(storagePaths).catch(() => {});
  }

  const { error } = await sb.from('centers').delete().eq('id', centerId);
  throwIfPgError(error, 'Impossibile eliminare il Centro.');

  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'eliminazione_centro',
    centerId,
    centerName: cRow?.name ? String(cRow.name) : undefined,
    details: `Eliminato Centro "${cRow?.name || centerId}" con snapshot automatico`,
  });
}

export async function adminListCenterPdfsApi(
  _token: string,
  centerId: string
): Promise<PdfDocumentRecord[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('center_pdfs')
    .select('*')
    .eq('center_id', centerId)
    .eq('deleted', false)
    .order('zone_number', { ascending: true });
  throwIfPgError(error, 'Impossibile caricare l’elenco PDF.');
  return (data || []).map((r) => mapPdfRow(r as Record<string, unknown>));
}

export async function adminCheckDuplicatePdfApi(
  _token: string,
  centerId: string,
  fileName: string,
  fileHash: string,
  zoneNumber: string
): Promise<{ duplicatePdf: PdfDocumentRecord | null; reason: string }> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('center_pdfs')
    .select('*')
    .eq('center_id', centerId)
    .eq('deleted', false);
  throwIfPgError(error, 'Errore verifica PDF duplicati.');

  const pdfs = (data || []).map((r) => mapPdfRow(r as Record<string, unknown>));
  const byHash = fileHash ? pdfs.find((p) => p.fileHash && p.fileHash === fileHash) : undefined;
  if (byHash) {
    return { duplicatePdf: byHash, reason: 'Contenuto identico (SHA-256)' };
  }

  const normName = fileName.trim().toLowerCase();
  const byName = pdfs.find((p) => p.fileName.trim().toLowerCase() === normName);
  if (byName) {
    return { duplicatePdf: byName, reason: 'Stesso nome file nel Centro' };
  }

  const byZone = pdfs.find((p) => p.zoneNumber === zoneNumber);
  if (byZone) {
    return { duplicatePdf: byZone, reason: `Esiste già un libretto per la Zona ${zoneNumber}` };
  }

  return { duplicatePdf: null, reason: '' };
}

export async function adminUploadPdfApi(
  _token: string,
  centerId: string,
  payload: {
    pdfRecord: PdfDocumentRecord;
    pdfBase64?: string;
    addresses: AddressRecord[];
    duplicateResolution?: 'replace' | 'keep_both' | 'new';
    replacePdfId?: string;
  }
): Promise<{ center: DeliveryCenter; pdf: PdfDocumentRecord }> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  const { data: cRow, error: cErr } = await sb
    .from('centers')
    .select('*')
    .eq('id', centerId)
    .single();
  throwIfPgError(cErr, 'Centro non trovato.');

  const nextVersion = Number((cRow as Record<string, unknown>).version ?? 1) + 1;

  if (payload.duplicateResolution === 'replace' && payload.replacePdfId) {
    await createAutoBackupSnapshot(sb, centerId, 'auto', actorEmail);

    const { data: oldPdf } = await sb
      .from('center_pdfs')
      .select('storage_path')
      .eq('id', payload.replacePdfId)
      .maybeSingle();

    await sb
      .from('center_pdfs')
      .update({ deleted: true, version_deleted: nextVersion })
      .eq('id', payload.replacePdfId);

    await sb
      .from('center_addresses')
      .update({ deleted: true, version_changed: nextVersion })
      .eq('pdf_id', payload.replacePdfId);

    if (oldPdf?.storage_path) {
      await sb.storage.from('libretti-pdf').remove([String(oldPdf.storage_path)]).catch(() => {});
    }
  }

  const storagePath = `${centerId}/${payload.pdfRecord.id}.pdf`;
  if (payload.pdfBase64) {
    const bytes = base64ToBytes(payload.pdfBase64);
    await sb.storage
      .from('libretti-pdf')
      .upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      })
      .catch(() => {});
  }

  // Evita duplicazione indirizzi rispetto alle righe già attive del Centro
  const existingRows = await fetchAllCenterAddresses(sb, centerId, 0);
  const seenSig = new Set(
    existingRows.map(
      (a) =>
        `${a.comune_norm}|${a.nome_strada_norm}|${String(a.civico_raw || '').toUpperCase()}|${a.zona}|${a.subzona}`
    )
  );

  const uniqueNewAddresses: AddressRecord[] = [];
  for (const addr of payload.addresses) {
    const sig = `${addr.comuneNorm}|${addr.nomeStradaNorm}|${(addr.civicoRaw || '').toUpperCase()}|${addr.zona}|${addr.subzona}`;
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    uniqueNewAddresses.push({
      ...addr,
      centerId,
      pdfId: payload.pdfRecord.id,
      versionChanged: nextVersion,
    });
  }

  const { data: insertedPdf, error: pdfErr } = await sb
    .from('center_pdfs')
    .insert({
      id: payload.pdfRecord.id,
      center_id: centerId,
      file_name: payload.pdfRecord.fileName,
      file_hash: payload.pdfRecord.fileHash || '',
      zone_number: payload.pdfRecord.zoneNumber,
      frazionario: payload.pdfRecord.frazionario ?? null,
      storage_path: storagePath,
      file_size: payload.pdfRecord.fileSize,
      page_count: payload.pdfRecord.pageCount,
      extracted_count: uniqueNewAddresses.length,
      extraction_method: payload.pdfRecord.extractionMethod,
      version_added: nextVersion,
      deleted: false,
    })
    .select('*')
    .single();
  throwIfPgError(pdfErr, 'Errore salvataggio metadati PDF.');

  const BATCH = 500;
  for (let i = 0; i < uniqueNewAddresses.length; i += BATCH) {
    const chunk = uniqueNewAddresses.slice(i, i + BATCH).map((a) => addressToDbRow(a, nextVersion));
    const { error: aErr } = await sb.from('center_addresses').insert(chunk);
    throwIfPgError(aErr, 'Errore salvataggio indirizzi estratti.');
  }

  const updatedCenter = await recomputeCloudCenterStats(sb, centerId, true);

  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: payload.duplicateResolution === 'replace' ? 'sostituzione_pdf' : 'caricamento_pdf',
    centerId,
    centerName: updatedCenter.name,
    details: `${
      payload.duplicateResolution === 'replace' ? 'Sostituito' : 'Caricato'
    } "${payload.pdfRecord.fileName}" (${uniqueNewAddresses.length} indirizzi, Zona ${payload.pdfRecord.zoneNumber})`,
  });

  return {
    center: updatedCenter,
    pdf: mapPdfRow(insertedPdf as Record<string, unknown>),
  };
}

export async function adminDeletePdfApi(
  _token: string,
  centerId: string,
  pdfId: string
): Promise<DeliveryCenter> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  const { data: cRow, error: cErr } = await sb
    .from('centers')
    .select('version, name')
    .eq('id', centerId)
    .single();
  throwIfPgError(cErr, 'Centro non trovato.');

  const { data: pdfRow } = await sb
    .from('center_pdfs')
    .select('file_name, storage_path')
    .eq('id', pdfId)
    .maybeSingle();

  await createAutoBackupSnapshot(sb, centerId, 'auto', actorEmail);

  const nextVersion = Number(cRow?.version ?? 1) + 1;
  const { error: pErr } = await sb
    .from('center_pdfs')
    .update({ deleted: true, version_deleted: nextVersion })
    .eq('id', pdfId);
  throwIfPgError(pErr, 'Errore eliminazione PDF.');

  const { error: aErr } = await sb
    .from('center_addresses')
    .update({ deleted: true, version_changed: nextVersion })
    .eq('pdf_id', pdfId);
  throwIfPgError(aErr, 'Errore aggiornamento indirizzi eliminati.');

  if (pdfRow?.storage_path) {
    await sb.storage.from('libretti-pdf').remove([String(pdfRow.storage_path)]).catch(() => {});
  }

  const updated = await recomputeCloudCenterStats(sb, centerId, true);
  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'eliminazione_pdf',
    centerId,
    centerName: updated.name,
    details: `Eliminato PDF "${pdfRow?.file_name || pdfId}" con backup automatico`,
  });

  return updated;
}

export async function adminRegenerateCenterDbApi(
  _token: string,
  centerId: string
): Promise<DeliveryCenter> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  const { data: cRow, error: cErr } = await sb
    .from('centers')
    .select('version')
    .eq('id', centerId)
    .single();
  throwIfPgError(cErr, 'Centro non trovato.');

  const nextVersion = Number(cRow?.version ?? 1) + 1;
  const rows = await fetchAllCenterAddresses(sb, centerId, 0);
  const seenSig = new Set<string>();
  const duplicateIds: string[] = [];

  for (const r of rows) {
    const sig = `${r.comune_norm}|${r.nome_strada_norm}|${String(r.civico_raw || '').toUpperCase()}|${r.zona}|${r.subzona}`;
    if (seenSig.has(sig)) {
      duplicateIds.push(String(r.id));
    } else {
      seenSig.add(sig);
    }
  }

  const BATCH = 200;
  for (let i = 0; i < duplicateIds.length; i += BATCH) {
    await sb
      .from('center_addresses')
      .update({ deleted: true, version_changed: nextVersion })
      .in('id', duplicateIds.slice(i, i + BATCH));
  }

  const updated = await recomputeCloudCenterStats(sb, centerId, true);
  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'rigenerazione_db',
    centerId,
    centerName: updated.name,
    details: `Database rigenerato e deduplicato (rimossi ${duplicateIds.length} duplicati, ${updated.addressCount} indirizzi attivi)`,
  });

  return updated;
}

// ============================================================================
// ADMIN USERS, LOGS, BACKUPS, DIAGNOSTICS
// ============================================================================

export async function adminListUsersApi(_token: string): Promise<AdminUserRecord[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('admin_profiles')
    .select('*')
    .order('created_at', { ascending: true });
  throwIfPgError(error, 'Impossibile caricare gli amministratori.');

  return (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      email: String(r.email || ''),
      role: 'admin',
      active: Boolean(r.active),
      mustChangePassword: Boolean(r.must_change_password),
      hasPassword: Boolean(r.user_id),
      createdBy: String(r.created_by || 'admin'),
      createdAt: r.created_at ? Date.parse(String(r.created_at)) : Date.now(),
      updatedAt: r.updated_at ? Date.parse(String(r.updated_at)) : Date.now(),
    };
  });
}

export async function adminCreateUserApi(
  _token: string,
  email: string,
  _initialPassword?: string
): Promise<AdminUserRecord> {
  const sb = requireSupabase();
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    throw new Error('Inserisci un indirizzo email valido.');
  }

  const actorEmail = await getCurrentAdminEmail(sb);
  const { data, error } = await sb
    .from('admin_profiles')
    .insert({
      email: normalized,
      role: 'admin',
      active: true,
      must_change_password: true,
      created_by: actorEmail,
    })
    .select('*')
    .single();
  throwIfPgError(error, 'Impossibile aggiungere il nuovo amministratore (verifica che non esista già).');

  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'gestione_admin',
    details: `Abilitato nuovo amministratore: ${normalized} (creerà la password al primo accesso)`,
  });

  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    email: String(r.email),
    role: 'admin',
    active: Boolean(r.active),
    mustChangePassword: Boolean(r.must_change_password),
    hasPassword: Boolean(r.user_id),
    createdBy: String(r.created_by || actorEmail),
    createdAt: r.created_at ? Date.parse(String(r.created_at)) : Date.now(),
    updatedAt: r.updated_at ? Date.parse(String(r.updated_at)) : Date.now(),
  };
}

export async function adminToggleUserActiveApi(
  _token: string,
  userId: string,
  active: boolean
): Promise<AdminUserRecord> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  const { data: target, error: tErr } = await sb
    .from('admin_profiles')
    .select('email')
    .eq('id', userId)
    .single();
  throwIfPgError(tErr, 'Amministratore non trovato.');

  if (String(target?.email || '').toLowerCase() === actorEmail.toLowerCase() && !active) {
    throw new Error('Non puoi disattivare il tuo stesso account mentre sei connesso.');
  }

  const { data, error } = await sb
    .from('admin_profiles')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();
  throwIfPgError(error, 'Impossibile aggiornare lo stato dell’amministratore.');

  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'gestione_admin',
    details: `${active ? 'Attivato' : 'Disattivato'} amministratore ${String(target?.email || '')}`,
  });

  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    email: String(r.email),
    role: 'admin',
    active: Boolean(r.active),
    mustChangePassword: Boolean(r.must_change_password),
    hasPassword: Boolean(r.user_id),
    createdBy: String(r.created_by || ''),
    createdAt: r.created_at ? Date.parse(String(r.created_at)) : Date.now(),
    updatedAt: r.updated_at ? Date.parse(String(r.updated_at)) : Date.now(),
  };
}

export async function adminListLogsApi(_token: string): Promise<ActivityLogEntry[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(250);
  throwIfPgError(error, 'Impossibile caricare il log attività.');

  return (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      actorEmail: String(r.actor_email || ''),
      actorRole: (r.actor_role as ActivityLogEntry['actorRole']) || 'admin',
      action: r.action as ActivityLogEntry['action'],
      centerId: r.center_id ? String(r.center_id) : undefined,
      centerName: r.center_name ? String(r.center_name) : undefined,
      details: String(r.details || ''),
      createdAt: r.created_at ? Date.parse(String(r.created_at)) : Date.now(),
    };
  });
}

export async function adminListBackupsApi(_token: string): Promise<CenterBackupRecord[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('center_backups')
    .select('id, center_id, center_name, center_version, reason, created_by, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(60);
  throwIfPgError(error, 'Impossibile caricare i backup.');

  return (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    const payload = (r.payload || {}) as {
      pdfs?: unknown[];
      addresses?: unknown[];
    };
    return {
      id: String(r.id),
      centerId: String(r.center_id),
      centerName: String(r.center_name || ''),
      centerVersion: Number(r.center_version ?? 1),
      reason: (r.reason as CenterBackupRecord['reason']) || 'manual',
      createdBy: String(r.created_by || ''),
      createdAt: r.created_at ? Date.parse(String(r.created_at)) : Date.now(),
      pdfCount: Array.isArray(payload.pdfs) ? payload.pdfs.length : 0,
      addressCount: Array.isArray(payload.addresses) ? payload.addresses.length : 0,
    };
  });
}

export async function adminCreateBackupApi(
  token: string,
  centerId: string
): Promise<CenterBackupRecord[]> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  await createAutoBackupSnapshot(sb, centerId, 'manual', actorEmail);

  const { data: cRow } = await sb.from('centers').select('name').eq('id', centerId).maybeSingle();
  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'backup_creato',
    centerId,
    centerName: cRow?.name ? String(cRow.name) : undefined,
    details: 'Backup manuale creato su Supabase',
  });

  return adminListBackupsApi(token);
}

export async function adminExportCenterApi(
  _token: string,
  centerId: string
): Promise<unknown> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  const { data: cRow, error: cErr } = await sb
    .from('centers')
    .select('*')
    .eq('id', centerId)
    .single();
  throwIfPgError(cErr, 'Centro non trovato per esportazione.');

  const { data: pdfRows } = await sb
    .from('center_pdfs')
    .select('*')
    .eq('center_id', centerId)
    .eq('deleted', false);
  const addrRows = await fetchAllCenterAddresses(sb, centerId, 0);

  await createAutoBackupSnapshot(sb, centerId, 'export', actorEmail);

  return {
    exportedAt: new Date().toISOString(),
    center: mapCenterRow(cRow as Record<string, unknown>),
    pdfs: (pdfRows || []).map((r) => mapPdfRow(r as Record<string, unknown>)),
    addresses: addrRows.map(mapAddressRow),
  };
}

export async function adminRestoreBackupApi(
  _token: string,
  options: { backupId?: string; importedPayload?: unknown }
): Promise<DeliveryCenter> {
  const sb = requireSupabase();
  const actorEmail = await getCurrentAdminEmail(sb);

  type BackupPayload = {
    center?: DeliveryCenter;
    pdfs?: PdfDocumentRecord[];
    addresses?: AddressRecord[];
  };
  let payload: BackupPayload | null = null;

  if (options.backupId) {
    const { data, error } = await sb
      .from('center_backups')
      .select('payload')
      .eq('id', options.backupId)
      .single();
    throwIfPgError(error, 'Snapshot di backup non trovato.');
    payload = (data?.payload ?? null) as BackupPayload | null;
  } else if (options.importedPayload && typeof options.importedPayload === 'object') {
    payload = options.importedPayload as BackupPayload;
  }

  if (!payload?.center?.id || !payload.center.name) {
    throw new Error('Il file di backup selezionato non contiene dati validi del Centro.');
  }

  const centerId = payload.center.id;
  const { data: existingCenter } = await sb
    .from('centers')
    .select('version')
    .eq('id', centerId)
    .maybeSingle();

  const nextVersion = existingCenter
    ? Number(existingCenter.version) + 1
    : Math.max(1, Number(payload.center.version || 1));

  // Rimuove eventuali righe esistenti del Centro per ripristinare pulito
  await sb.from('center_addresses').delete().eq('center_id', centerId);
  await sb.from('center_pdfs').delete().eq('center_id', centerId);

  const { error: upCenterErr } = await sb.from('centers').upsert({
    id: centerId,
    name: payload.center.name,
    notes: payload.center.notes || '',
    version: nextVersion,
    pdf_count: 0,
    address_count: 0,
    zones: payload.center.zones || [],
    comuni: payload.center.comuni || [],
    updated_at: new Date().toISOString(),
  });
  throwIfPgError(upCenterErr, 'Errore ripristino Centro.');

  const pdfs = Array.isArray(payload.pdfs) ? payload.pdfs : [];
  if (pdfs.length > 0) {
    const { error: pErr } = await sb.from('center_pdfs').insert(
      pdfs.map((p) => ({
        id: p.id,
        center_id: centerId,
        file_name: p.fileName,
        file_hash: p.fileHash || '',
        zone_number: p.zoneNumber || '1',
        frazionario: p.frazionario ?? null,
        storage_path: p.storagePath || '',
        file_size: p.fileSize || 0,
        page_count: p.pageCount || 0,
        extracted_count: p.extractedCount || 0,
        extraction_method: p.extractionMethod || 'native',
        version_added: nextVersion,
        deleted: false,
      }))
    );
    throwIfPgError(pErr, 'Errore ripristino metadati PDF.');
  }

  const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
  const BATCH = 500;
  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = addresses
      .slice(i, i + BATCH)
      .map((a) => addressToDbRow({ ...a, centerId }, nextVersion));
    const { error: aErr } = await sb.from('center_addresses').insert(chunk);
    throwIfPgError(aErr, 'Errore ripristino indirizzi.');
  }

  const restored = await recomputeCloudCenterStats(sb, centerId, false);
  await insertLog(sb, {
    actorEmail,
    actorRole: 'admin',
    action: 'backup_ripristinato',
    centerId: restored.id,
    centerName: restored.name,
    details: `Ripristinato Centro "${restored.name}" alla versione v${restored.version}`,
  });
  return restored;
}

export async function adminGetDiagnosticsApi(_token: string): Promise<{
  backendMode: 'supabase';
  cloudCentersCount: number;
  cloudPdfsCount: number;
  cloudAddressesCount: number;
  cloudTotalStorageBytes: number;
}> {
  const sb = requireSupabase();
  const [centersRes, pdfsRes, addrsRes] = await Promise.all([
    sb.from('centers').select('id', { count: 'exact', head: true }),
    sb.from('center_pdfs').select('file_size').eq('deleted', false),
    sb.from('center_addresses').select('id', { count: 'exact', head: true }).eq('deleted', false),
  ]);

  throwIfPgError(centersRes.error, 'Errore diagnostica Centri.');
  throwIfPgError(pdfsRes.error, 'Errore diagnostica PDF.');
  throwIfPgError(addrsRes.error, 'Errore diagnostica Indirizzi.');

  const totalBytes = (pdfsRes.data || []).reduce(
    (sum, r) => sum + Number((r as Record<string, unknown>).file_size ?? 0),
    0
  );

  return {
    backendMode: 'supabase',
    cloudCentersCount: centersRes.count ?? 0,
    cloudPdfsCount: (pdfsRes.data || []).length,
    cloudAddressesCount: addrsRes.count ?? 0,
    cloudTotalStorageBytes: totalBytes,
  };
}
