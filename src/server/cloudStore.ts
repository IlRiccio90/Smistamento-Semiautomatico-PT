import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityLogEntry,
  AddressRecord,
  AdminUserRecord,
  CenterBackupRecord,
  CloudSyncDeltaResponse,
  DeliveryCenter,
  PdfDocumentRecord,
} from '../types/sorting';

const INITIAL_ADMIN_EMAIL = 'andrea.graziano90@hotmail.it';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const PDFS_DIR = path.join(DATA_DIR, 'pdfs');
const STORE_FILE = path.join(DATA_DIR, 'cloud-store.json');

// Chiave di firma token: usa process.env se configurata, altrimenti random in memoria
const SIGNING_SECRET =
  process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

export const isSupabaseBackendActive = Boolean(
  SUPABASE_URL && SUPABASE_SERVICE_KEY && SUPABASE_ANON_KEY
);

let supabaseAdminClient: SupabaseClient | null = null;
let supabasePublicClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseBackendActive) return null;
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseAdminClient;
}

export function getSupabasePublic(): SupabaseClient | null {
  if (!isSupabaseBackendActive) return null;
  if (!supabasePublicClient) {
    supabasePublicClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabasePublicClient;
}

interface StoredAdmin extends AdminUserRecord {
  passwordHash: string | null; // "salt:scryptHex"
}

interface StoredPdf extends PdfDocumentRecord {
  deleted?: boolean;
  versionDeleted?: number;
}

interface StoredAddress extends AddressRecord {
  deleted?: boolean;
  versionChanged: number;
}

interface StoredBackup extends CenterBackupRecord {
  payload: {
    center: DeliveryCenter;
    pdfs: PdfDocumentRecord[];
    addresses: AddressRecord[];
  };
}

interface CloudStoreData {
  admins: StoredAdmin[];
  centers: DeliveryCenter[];
  pdfs: StoredPdf[];
  addresses: StoredAddress[];
  logs: ActivityLogEntry[];
  backups: StoredBackup[];
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPasswordHash(password: string, stored: string | null): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function issueSessionToken(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: email.toLowerCase(),
      role: 'admin',
      exp: Date.now() + 1000 * 60 * 60 * 12, // 12 ore
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyLocalSessionToken(token: string): { email: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded?.email || typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
      return null;
    }
    return { email: String(decoded.email).toLowerCase() };
  } catch {
    return null;
  }
}

function ensureStoreDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PDFS_DIR)) fs.mkdirSync(PDFS_DIR, { recursive: true });
}

function loadStore(): CloudStoreData {
  ensureStoreDirs();
  if (!fs.existsSync(STORE_FILE)) {
    const now = Date.now();
    const initial: CloudStoreData = {
      admins: [
        {
          id: crypto.randomUUID(),
          email: INITIAL_ADMIN_EMAIL,
          role: 'admin',
          active: true,
          mustChangePassword: true,
          hasPassword: false,
          passwordHash: null,
          createdBy: 'system_bootstrap',
          createdAt: now,
          updatedAt: now,
        },
      ],
      centers: [],
      pdfs: [],
      addresses: [],
      logs: [],
      backups: [],
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial), 'utf8');
    return initial;
  }

  const raw = fs.readFileSync(STORE_FILE, 'utf8');
  const parsed = JSON.parse(raw) as CloudStoreData;
  // Garantisce la presenza del primo amministratore senza alcuna password predefinita
  if (!parsed.admins.some((a) => a.email.toLowerCase() === INITIAL_ADMIN_EMAIL)) {
    const now = Date.now();
    parsed.admins.unshift({
      id: crypto.randomUUID(),
      email: INITIAL_ADMIN_EMAIL,
      role: 'admin',
      active: true,
      mustChangePassword: true,
      hasPassword: false,
      passwordHash: null,
      createdBy: 'system_bootstrap',
      createdAt: now,
      updatedAt: now,
    });
  }
  return parsed;
}

function saveStore(data: CloudStoreData) {
  ensureStoreDirs();
  const tmpFile = `${STORE_FILE}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpFile, STORE_FILE);
}

function resolveSafePdfPath(pdfId: string): string {
  const safeName = `${pdfId.replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`;
  const target = path.resolve(PDFS_DIR, safeName);
  if (!target.startsWith(PDFS_DIR + path.sep)) {
    throw new Error('Percorso file PDF non valido.');
  }
  return target;
}

function computeCenterStats(
  center: DeliveryCenter,
  pdfs: StoredPdf[],
  addresses: StoredAddress[]
): DeliveryCenter {
  const activePdfs = pdfs.filter((p) => p.centerId === center.id && !p.deleted);
  const activeAddrs = addresses.filter((a) => a.centerId === center.id && !a.deleted);
  const zonesSet = new Set<string>();
  const comuniSet = new Set<string>();

  for (const p of activePdfs) {
    if (p.zoneNumber) zonesSet.add(p.zoneNumber);
  }
  for (const a of activeAddrs) {
    if (a.zona) zonesSet.add(a.zona);
    if (a.comune) comuniSet.add(a.comune);
  }

  return {
    ...center,
    pdfCount: activePdfs.length,
    addressCount: activeAddrs.length,
    zones: Array.from(zonesSet).sort((a, b) => a.localeCompare(b, 'it', { numeric: true })),
    comuni: Array.from(comuniSet).sort((a, b) => a.localeCompare(b, 'it')),
  };
}

function appendLog(
  store: CloudStoreData,
  entry: Omit<ActivityLogEntry, 'id' | 'createdAt'>
) {
  store.logs.unshift({
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  });
  if (store.logs.length > 500) {
    store.logs = store.logs.slice(0, 500);
  }
}

function createBackupSnapshot(
  store: CloudStoreData,
  centerId: string,
  reason: 'auto' | 'manual' | 'export',
  actorEmail: string
): CenterBackupRecord | null {
  const center = store.centers.find((c) => c.id === centerId);
  if (!center) return null;

  const activePdfs = store.pdfs
    .filter((p) => p.centerId === centerId && !p.deleted)
    .map(({ deleted: _d, versionDeleted: _vd, ...rest }) => rest);
  const activeAddrs = store.addresses
    .filter((a) => a.centerId === centerId && !a.deleted)
    .map(({ deleted: _d, ...rest }) => rest);

  const backup: StoredBackup = {
    id: crypto.randomUUID(),
    centerId: center.id,
    centerName: center.name,
    centerVersion: center.version,
    reason,
    createdBy: actorEmail,
    createdAt: Date.now(),
    pdfCount: activePdfs.length,
    addressCount: activeAddrs.length,
    payload: {
      center,
      pdfs: activePdfs,
      addresses: activeAddrs,
    },
  };

  store.backups.unshift(backup);
  if (store.backups.length > 60) {
    store.backups = store.backups.slice(0, 60);
  }
  return {
    id: backup.id,
    centerId: backup.centerId,
    centerName: backup.centerName,
    centerVersion: backup.centerVersion,
    reason: backup.reason,
    createdBy: backup.createdBy,
    createdAt: backup.createdAt,
    pdfCount: backup.pdfCount,
    addressCount: backup.addressCount,
  };
}

function sanitizeAdmin(a: StoredAdmin): AdminUserRecord {
  const { passwordHash: _ph, ...rest } = a;
  return rest;
}

// ============================================================================
// PUBLIC API FUNCTIONS (SUPPORTANO SUPABASE + FALLBACK CLOUD LOCALE)
// ============================================================================

export async function checkAdminEmailStatus(rawEmail: string): Promise<{
  exists: boolean;
  active: boolean;
  needsInitialPasswordSetup: boolean;
  mustChangePassword: boolean;
  backendMode: 'supabase' | 'local-cloud';
}> {
  const email = rawEmail.trim().toLowerCase();
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data } = await sb
      .from('admin_profiles')
      .select('email, active, must_change_password, user_id')
      .ilike('email', email)
      .maybeSingle();
    if (!data) {
      return {
        exists: false,
        active: false,
        needsInitialPasswordSetup: false,
        mustChangePassword: false,
        backendMode: 'supabase',
      };
    }
    return {
      exists: true,
      active: Boolean(data.active),
      needsInitialPasswordSetup: !data.user_id,
      mustChangePassword: Boolean(data.must_change_password),
      backendMode: 'supabase',
    };
  }

  const store = loadStore();
  const admin = store.admins.find((a) => a.email.toLowerCase() === email);
  if (!admin) {
    return {
      exists: false,
      active: false,
      needsInitialPasswordSetup: false,
      mustChangePassword: false,
      backendMode: 'local-cloud',
    };
  }
  return {
    exists: true,
    active: admin.active,
    needsInitialPasswordSetup: !admin.passwordHash,
    mustChangePassword: admin.mustChangePassword,
    backendMode: 'local-cloud',
  };
}

export async function setupFirstAdminPassword(rawEmail: string, password: string): Promise<{
  token: string;
  email: string;
  mustChangePassword: boolean;
  backendMode: 'supabase' | 'local-cloud';
}> {
  const email = rawEmail.trim().toLowerCase();
  if (password.length < 8) {
    throw new Error('La password deve contenere almeno 8 caratteri.');
  }

  const sb = getSupabaseAdmin();
  const sbPublic = getSupabasePublic();
  if (sb && sbPublic) {
    const { data: profile } = await sb
      .from('admin_profiles')
      .select('*')
      .ilike('email', email)
      .maybeSingle();
    if (!profile || !profile.active || profile.user_id) {
      throw new Error('Configurazione iniziale non consentita o già completata.');
    }

    const { data: createdUser, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !createdUser.user) {
      throw new Error(createErr?.message || 'Errore creazione utente Supabase.');
    }

    await sb
      .from('admin_profiles')
      .update({
        user_id: createdUser.user.id,
        must_change_password: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    const { data: signInData, error: signInErr } = await sbPublic.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signInData.session) {
      throw new Error(signInErr?.message || 'Accesso dopo attivazione fallito.');
    }

    await sb.from('activity_logs').insert({
      actor_email: email,
      actor_role: 'admin',
      action: 'login_admin',
      details: 'Primo accesso e attivazione password amministratore',
    });

    return {
      token: signInData.session.access_token,
      email,
      mustChangePassword: false,
      backendMode: 'supabase',
    };
  }

  const store = loadStore();
  const admin = store.admins.find((a) => a.email.toLowerCase() === email);
  if (!admin || !admin.active) {
    throw new Error('Account amministratore non abilitato.');
  }
  if (admin.passwordHash) {
    throw new Error('La password iniziale è già stata impostata. Effettua il login.');
  }

  admin.passwordHash = hashPassword(password);
  admin.hasPassword = true;
  admin.mustChangePassword = false;
  admin.updatedAt = Date.now();
  appendLog(store, {
    actorEmail: email,
    actorRole: 'admin',
    action: 'login_admin',
    details: 'Primo accesso e creazione password amministratore',
  });
  saveStore(store);

  return {
    token: issueSessionToken(email),
    email,
    mustChangePassword: false,
    backendMode: 'local-cloud',
  };
}

export async function loginAdmin(rawEmail: string, password: string): Promise<{
  token: string;
  email: string;
  mustChangePassword: boolean;
  backendMode: 'supabase' | 'local-cloud';
}> {
  const email = rawEmail.trim().toLowerCase();
  const sb = getSupabaseAdmin();
  const sbPublic = getSupabasePublic();

  if (sb && sbPublic) {
    const { data: profile } = await sb
      .from('admin_profiles')
      .select('*')
      .ilike('email', email)
      .maybeSingle();
    if (!profile || !profile.active) {
      throw new Error('Credenziali non valide o amministratore disattivato.');
    }

    const { data: authData, error: authErr } = await sbPublic.auth.signInWithPassword({
      email,
      password,
    });
    if (authErr || !authData.session) {
      throw new Error('Email o password errate.');
    }

    await sb.from('activity_logs').insert({
      actor_email: email,
      actor_role: 'admin',
      action: 'login_admin',
      details: 'Login amministratore effettuato',
    });

    return {
      token: authData.session.access_token,
      email,
      mustChangePassword: Boolean(profile.must_change_password),
      backendMode: 'supabase',
    };
  }

  const store = loadStore();
  const admin = store.admins.find((a) => a.email.toLowerCase() === email);
  if (!admin || !admin.active) {
    throw new Error('Credenziali non valide o amministratore disattivato.');
  }
  if (!admin.passwordHash) {
    throw new Error('Primo accesso richiesto: crea la password iniziale.');
  }
  if (!verifyPasswordHash(password, admin.passwordHash)) {
    throw new Error('Email o password errate.');
  }

  appendLog(store, {
    actorEmail: email,
    actorRole: 'admin',
    action: 'login_admin',
    details: 'Login amministratore effettuato',
  });
  saveStore(store);

  return {
    token: issueSessionToken(email),
    email,
    mustChangePassword: admin.mustChangePassword,
    backendMode: 'local-cloud',
  };
}

export async function verifyAdminBearerToken(token: string): Promise<{
  email: string;
  mustChangePassword: boolean;
  backendMode: 'supabase' | 'local-cloud';
} | null> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: userRes, error } = await sb.auth.getUser(token);
    if (error || !userRes.user?.email) return null;
    const email = userRes.user.email.toLowerCase();
    const { data: profile } = await sb
      .from('admin_profiles')
      .select('active, must_change_password')
      .ilike('email', email)
      .maybeSingle();
    if (!profile || !profile.active) return null;
    return {
      email,
      mustChangePassword: Boolean(profile.must_change_password),
      backendMode: 'supabase',
    };
  }

  const verified = verifyLocalSessionToken(token);
  if (!verified) return null;
  const store = loadStore();
  const admin = store.admins.find((a) => a.email.toLowerCase() === verified.email);
  if (!admin || !admin.active) return null;
  return {
    email: admin.email,
    mustChangePassword: admin.mustChangePassword,
    backendMode: 'local-cloud',
  };
}

export async function changeAdminPassword(email: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw new Error('La nuova password deve avere almeno 8 caratteri.');
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: profile } = await sb
      .from('admin_profiles')
      .select('id, user_id')
      .ilike('email', email)
      .maybeSingle();
    if (!profile?.user_id) throw new Error('Utente non trovato.');
    const { error } = await sb.auth.admin.updateUserById(profile.user_id, {
      password: newPassword,
    });
    if (error) throw new Error(error.message);
    await sb
      .from('admin_profiles')
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq('id', profile.id);
    await sb.from('activity_logs').insert({
      actor_email: email,
      actor_role: 'admin',
      action: 'gestione_admin',
      details: 'Password amministratore aggiornata',
    });
    return;
  }

  const store = loadStore();
  const admin = store.admins.find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!admin) throw new Error('Amministratore non trovato.');
  admin.passwordHash = hashPassword(newPassword);
  admin.hasPassword = true;
  admin.mustChangePassword = false;
  admin.updatedAt = Date.now();
  appendLog(store, {
    actorEmail: email,
    actorRole: 'admin',
    action: 'gestione_admin',
    details: 'Password amministratore aggiornata',
  });
  saveStore(store);
}

export async function requestPasswordRecovery(rawEmail: string, redirectTo: string): Promise<{
  sent: boolean;
  message: string;
}> {
  const email = rawEmail.trim().toLowerCase();
  const sbPublic = getSupabasePublic();
  const sb = getSupabaseAdmin();

  if (sb && sbPublic) {
    const { data: profile } = await sb
      .from('admin_profiles')
      .select('active')
      .ilike('email', email)
      .maybeSingle();
    if (profile?.active) {
      await sbPublic.auth.resetPasswordForEmail(email, { redirectTo });
    }
    return {
      sent: true,
      message: 'Se l’indirizzo è abilitato, riceverai un’email di recupero password tramite Supabase Auth.',
    };
  }

  return {
    sent: false,
    message:
      'Il recupero password via email richiede la configurazione di Supabase Auth SMTP nelle variabili d’ambiente. Un altro amministratore attivo può comunque reimpostare l’accesso dal pannello Admin.',
  };
}

export async function listCloudCenters(): Promise<DeliveryCenter[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from('centers')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      notes: r.notes || '',
      version: Number(r.version || 1),
      pdfCount: Number(r.pdf_count || 0),
      addressCount: Number(r.address_count || 0),
      zones: r.zones || [],
      comuni: r.comuni || [],
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  }

  const store = loadStore();
  return [...store.centers].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCloudSyncDelta(
  centerId: string,
  sinceVersion: number
): Promise<CloudSyncDeltaResponse> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: centerRow, error: cErr } = await sb
      .from('centers')
      .select('*')
      .eq('id', centerId)
      .single();
    if (cErr || !centerRow) throw new Error('Centro non trovato sul server.');

    const center: DeliveryCenter = {
      id: centerRow.id,
      name: centerRow.name,
      notes: centerRow.notes || '',
      version: Number(centerRow.version || 1),
      pdfCount: Number(centerRow.pdf_count || 0),
      addressCount: Number(centerRow.address_count || 0),
      zones: centerRow.zones || [],
      comuni: centerRow.comuni || [],
      createdAt: new Date(centerRow.created_at).getTime(),
      updatedAt: new Date(centerRow.updated_at).getTime(),
    };

    const isFull = sinceVersion <= 0;

    let pdfQuery = sb.from('center_pdfs').select('*').eq('center_id', centerId);
    if (isFull) {
      pdfQuery = pdfQuery.eq('deleted', false);
    } else {
      pdfQuery = pdfQuery.or(`version_added.gt.${sinceVersion},version_deleted.gt.${sinceVersion}`);
    }
    const { data: pdfRows } = await pdfQuery;

    const upsertedPdfs: PdfDocumentRecord[] = [];
    const deletedPdfIds: string[] = [];
    for (const p of pdfRows || []) {
      if (p.deleted) {
        deletedPdfIds.push(p.id);
      } else {
        upsertedPdfs.push({
          id: p.id,
          centerId: p.center_id,
          fileName: p.file_name,
          fileHash: p.file_hash || '',
          zoneNumber: p.zone_number,
          frazionario: p.frazionario || undefined,
          storagePath: p.storage_path || undefined,
          fileSize: Number(p.file_size || 0),
          pageCount: Number(p.page_count || 0),
          extractedCount: Number(p.extracted_count || 0),
          extractionMethod: p.extraction_method || 'native',
          versionAdded: Number(p.version_added || 1),
          importedAt: new Date(p.imported_at).getTime(),
        });
      }
    }

    let addrQuery = sb.from('center_addresses').select('*').eq('center_id', centerId);
    if (isFull) {
      addrQuery = addrQuery.eq('deleted', false);
    } else {
      addrQuery = addrQuery.gt('version_changed', sinceVersion);
    }
    const { data: addrRows } = await addrQuery;

    const upsertedAddresses: AddressRecord[] = [];
    const deletedAddressIds: string[] = [];
    for (const a of addrRows || []) {
      if (a.deleted) {
        deletedAddressIds.push(a.id);
      } else {
        upsertedAddresses.push({
          id: a.id,
          centerId: a.center_id,
          pdfId: a.pdf_id,
          zona: a.zona,
          subzona: a.subzona,
          prog: a.prog || '',
          comune: a.comune,
          comuneNorm: a.comune_norm,
          frazione: a.frazione || '',
          tipoStrada: a.tipo_strada,
          tipoStradaNorm: a.tipo_strada_norm,
          nomeStrada: a.nome_strada,
          nomeStradaNorm: a.nome_strada_norm,
          nomeTokens: a.nome_tokens || [],
          civicoRaw: a.civico_raw || '',
          civicoNum: a.civico_num,
          civicoSuffix: a.civico_suffix || '',
          civicoStart: a.civico_start,
          civicoEnd: a.civico_end,
          parity: a.parity || 'all',
          isSnc: Boolean(a.is_snc),
          scala: a.scala || '',
          note: a.note || '',
          rawAddress: a.raw_address,
          versionChanged: Number(a.version_changed || 1),
        });
      }
    }

    return {
      mode: isFull ? 'full' : 'delta',
      center,
      fromVersion: sinceVersion,
      toVersion: center.version,
      upsertedPdfs,
      deletedPdfIds,
      upsertedAddresses,
      deletedAddressIds,
    };
  }

  const store = loadStore();
  const center = store.centers.find((c) => c.id === centerId);
  if (!center) throw new Error('Centro non trovato sul server.');

  const isFull = sinceVersion <= 0;

  const upsertedPdfs: PdfDocumentRecord[] = [];
  const deletedPdfIds: string[] = [];
  for (const p of store.pdfs) {
    if (p.centerId !== centerId) continue;
    if (isFull) {
      if (!p.deleted) {
        const { deleted: _d, versionDeleted: _vd, ...clean } = p;
        upsertedPdfs.push(clean);
      }
    } else {
      if (p.deleted && (p.versionDeleted ?? 0) > sinceVersion) {
        deletedPdfIds.push(p.id);
      } else if (!p.deleted && (p.versionAdded ?? 1) > sinceVersion) {
        const { deleted: _d, versionDeleted: _vd, ...clean } = p;
        upsertedPdfs.push(clean);
      }
    }
  }

  const upsertedAddresses: AddressRecord[] = [];
  const deletedAddressIds: string[] = [];
  for (const a of store.addresses) {
    if (a.centerId !== centerId) continue;
    if (isFull) {
      if (!a.deleted) {
        const { deleted: _d, ...clean } = a;
        upsertedAddresses.push(clean);
      }
    } else if (a.versionChanged > sinceVersion) {
      if (a.deleted) {
        deletedAddressIds.push(a.id);
      } else {
        const { deleted: _d, ...clean } = a;
        upsertedAddresses.push(clean);
      }
    }
  }

  return {
    mode: isFull ? 'full' : 'delta',
    center,
    fromVersion: sinceVersion,
    toVersion: center.version,
    upsertedPdfs,
    deletedPdfIds,
    upsertedAddresses,
    deletedAddressIds,
  };
}

export async function recordSyncAck(
  centerId: string,
  action: 'sincronizzazione' | 'aggiornamento_incrementale',
  version: number
): Promise<void> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: c } = await sb
      .from('centers')
      .select('name')
      .eq('id', centerId)
      .maybeSingle();
    await sb.from('activity_logs').insert({
      actor_email: 'operatore-dispositivo',
      actor_role: 'operator',
      action,
      center_id: centerId,
      center_name: c?.name || '',
      details: `Dispositivo allineato alla versione v${version}`,
    });
    return;
  }

  const store = loadStore();
  const c = store.centers.find((x) => x.id === centerId);
  appendLog(store, {
    actorEmail: 'operatore-dispositivo',
    actorRole: 'operator',
    action,
    centerId,
    centerName: c?.name || '',
    details: `Dispositivo allineato alla versione v${version}`,
  });
  saveStore(store);
}

// ============================================================================
// FUNZIONI RISERVATE AGLI AMMINISTRATORI
// ============================================================================

export async function adminCreateCenter(
  actorEmail: string,
  name: string,
  notes: string
): Promise<DeliveryCenter> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nome Centro obbligatorio.');

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb
      .from('centers')
      .insert({
        name: trimmed,
        notes: notes.trim(),
        version: 1,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message || 'Errore creazione centro');

    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'creazione_centro',
      center_id: data.id,
      center_name: data.name,
      details: `Creato Centro "${data.name}" (v1)`,
    });

    return {
      id: data.id,
      name: data.name,
      notes: data.notes || '',
      version: 1,
      pdfCount: 0,
      addressCount: 0,
      zones: [],
      comuni: [],
      createdAt: new Date(data.created_at).getTime(),
      updatedAt: new Date(data.updated_at).getTime(),
    };
  }

  const store = loadStore();
  const now = Date.now();
  const center: DeliveryCenter = {
    id: crypto.randomUUID(),
    name: trimmed,
    notes: notes.trim(),
    createdAt: now,
    updatedAt: now,
    version: 1,
    pdfCount: 0,
    addressCount: 0,
    zones: [],
    comuni: [],
  };
  store.centers.unshift(center);
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'creazione_centro',
    centerId: center.id,
    centerName: center.name,
    details: `Creato Centro "${center.name}" (v1)`,
  });
  saveStore(store);
  return center;
}

export async function adminUpdateCenter(
  actorEmail: string,
  centerId: string,
  name: string,
  notes: string
): Promise<DeliveryCenter> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: existing } = await sb.from('centers').select('*').eq('id', centerId).single();
    if (!existing) throw new Error('Centro non trovato.');
    const nextVersion = Number(existing.version || 1) + 1;
    const { data, error } = await sb
      .from('centers')
      .update({
        name: name.trim(),
        notes: notes.trim(),
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', centerId)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message || 'Errore aggiornamento centro');
    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'modifica_centro',
      center_id: centerId,
      center_name: data.name,
      details: `Aggiornato Centro "${data.name}" (v${nextVersion})`,
    });
    return {
      id: data.id,
      name: data.name,
      notes: data.notes || '',
      version: nextVersion,
      pdfCount: Number(data.pdf_count || 0),
      addressCount: Number(data.address_count || 0),
      zones: data.zones || [],
      comuni: data.comuni || [],
      createdAt: new Date(data.created_at).getTime(),
      updatedAt: new Date(data.updated_at).getTime(),
    };
  }

  const store = loadStore();
  const idx = store.centers.findIndex((c) => c.id === centerId);
  if (idx === -1) throw new Error('Centro non trovato.');
  const prev = store.centers[idx];
  const updated: DeliveryCenter = {
    ...prev,
    name: name.trim() || prev.name,
    notes: notes.trim(),
    version: prev.version + 1,
    updatedAt: Date.now(),
  };
  store.centers[idx] = updated;
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'modifica_centro',
    centerId: updated.id,
    centerName: updated.name,
    details: `Aggiornato Centro "${updated.name}" (v${updated.version})`,
  });
  saveStore(store);
  return updated;
}

export async function adminDeleteCenter(actorEmail: string, centerId: string): Promise<void> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: c } = await sb.from('centers').select('name').eq('id', centerId).maybeSingle();
    await sb.from('centers').delete().eq('id', centerId);
    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'eliminazione_centro',
      center_id: centerId,
      center_name: c?.name || '',
      details: `Eliminato Centro "${c?.name || centerId}"`,
    });
    return;
  }

  const store = loadStore();
  const center = store.centers.find((c) => c.id === centerId);
  if (!center) throw new Error('Centro non trovato.');
  // Backup automatico prima dell'eliminazione
  createBackupSnapshot(store, centerId, 'auto', actorEmail);

  const removedPdfIds = store.pdfs.filter((p) => p.centerId === centerId).map((p) => p.id);
  for (const pid of removedPdfIds) {
    try {
      const p = resolveSafePdfPath(pid);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
  store.centers = store.centers.filter((c) => c.id !== centerId);
  store.pdfs = store.pdfs.filter((p) => p.centerId !== centerId);
  store.addresses = store.addresses.filter((a) => a.centerId !== centerId);
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'eliminazione_centro',
    centerId,
    centerName: center.name,
    details: `Eliminato Centro "${center.name}" (backup automatico salvato)`,
  });
  saveStore(store);
}

export async function adminListCenterPdfs(centerId: string): Promise<PdfDocumentRecord[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data } = await sb
      .from('center_pdfs')
      .select('*')
      .eq('center_id', centerId)
      .eq('deleted', false)
      .order('zone_number');
    return (data || []).map((p) => ({
      id: p.id,
      centerId: p.center_id,
      fileName: p.file_name,
      fileHash: p.file_hash || '',
      zoneNumber: p.zone_number,
      frazionario: p.frazionario || undefined,
      storagePath: p.storage_path || undefined,
      fileSize: Number(p.file_size || 0),
      pageCount: Number(p.page_count || 0),
      extractedCount: Number(p.extracted_count || 0),
      extractionMethod: p.extraction_method || 'native',
      versionAdded: Number(p.version_added || 1),
      importedAt: new Date(p.imported_at).getTime(),
    }));
  }

  const store = loadStore();
  return store.pdfs
    .filter((p) => p.centerId === centerId && !p.deleted)
    .map(({ deleted: _d, versionDeleted: _vd, ...rest }) => rest)
    .sort((a, b) => a.zoneNumber.localeCompare(b.zoneNumber, 'it', { numeric: true }));
}

export async function adminCheckDuplicatePdf(
  centerId: string,
  fileName: string,
  fileHash: string,
  zoneNumber: string
): Promise<{ duplicatePdf: PdfDocumentRecord | null; reason: string }> {
  const pdfs = await adminListCenterPdfs(centerId);
  const byHash = fileHash ? pdfs.find((p) => p.fileHash === fileHash) : undefined;
  if (byHash) {
    return { duplicatePdf: byHash, reason: 'Contenuto identico (stesso hash file)' };
  }
  const byName = pdfs.find(
    (p) => p.fileName.trim().toLowerCase() === fileName.trim().toLowerCase()
  );
  if (byName) {
    return { duplicatePdf: byName, reason: 'Stesso nome file già presente nel Centro' };
  }
  const byZone = pdfs.find((p) => p.zoneNumber === zoneNumber);
  if (byZone) {
    return { duplicatePdf: byZone, reason: `Esiste già un PDF per la Zona ${zoneNumber}` };
  }
  return { duplicatePdf: null, reason: '' };
}

export async function adminUploadPdfAndAddresses(options: {
  actorEmail: string;
  centerId: string;
  pdfRecord: PdfDocumentRecord;
  pdfBase64?: string;
  addresses: AddressRecord[];
  duplicateResolution?: 'replace' | 'keep_both' | 'new';
  replacePdfId?: string;
}): Promise<{ center: DeliveryCenter; pdf: PdfDocumentRecord }> {
  const {
    actorEmail,
    centerId,
    pdfRecord,
    pdfBase64,
    addresses,
    duplicateResolution = 'new',
    replacePdfId,
  } = options;

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: centerRow } = await sb.from('centers').select('*').eq('id', centerId).single();
    if (!centerRow) throw new Error('Centro non trovato.');
    const nextVersion = Number(centerRow.version || 1) + 1;

    if (duplicateResolution === 'replace' && replacePdfId) {
      await sb
        .from('center_pdfs')
        .update({ deleted: true, version_deleted: nextVersion })
        .eq('id', replacePdfId);
      await sb
        .from('center_addresses')
        .update({ deleted: true, version_changed: nextVersion })
        .eq('pdf_id', replacePdfId);
    }

    let storagePath = '';
    if (pdfBase64) {
      const buf = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      storagePath = `${centerId}/${pdfRecord.id}.pdf`;
      await sb.storage.from('libretti-pdf').upload(storagePath, buf, {
        contentType: 'application/pdf',
        upsert: true,
      });
    }

    // Deduplicazione indirizzi rispetto a record attivi del Centro se si mantengono entrambe le versioni
    const { data: existingAddrs } = await sb
      .from('center_addresses')
      .select('zona, subzona, comune_norm, tipo_strada_norm, nome_strada_norm, civico_raw, scala')
      .eq('center_id', centerId)
      .eq('deleted', false);
    const existingKeys = new Set(
      (existingAddrs || []).map(
        (a) =>
          `${a.zona}|${a.subzona}|${a.comune_norm}|${a.tipo_strada_norm}|${a.nome_strada_norm}|${a.civico_raw}|${a.scala}`
      )
    );

    const uniqueNewAddresses = addresses.filter((a) => {
      const k = `${a.zona}|${a.subzona}|${a.comuneNorm}|${a.tipoStradaNorm}|${a.nomeStradaNorm}|${a.civicoRaw}|${a.scala}`;
      if (existingKeys.has(k)) return false;
      existingKeys.add(k);
      return true;
    });

    await sb.from('center_pdfs').insert({
      id: pdfRecord.id,
      center_id: centerId,
      file_name: pdfRecord.fileName,
      file_hash: pdfRecord.fileHash || '',
      zone_number: pdfRecord.zoneNumber,
      frazionario: pdfRecord.frazionario || null,
      storage_path: storagePath,
      file_size: pdfRecord.fileSize,
      page_count: pdfRecord.pageCount,
      extracted_count: uniqueNewAddresses.length,
      extraction_method: pdfRecord.extractionMethod,
      version_added: nextVersion,
      deleted: false,
    });

    for (let i = 0; i < uniqueNewAddresses.length; i += 500) {
      const chunk = uniqueNewAddresses.slice(i, i + 500).map((a) => ({
        id: a.id,
        center_id: centerId,
        pdf_id: pdfRecord.id,
        zona: a.zona,
        subzona: a.subzona,
        prog: a.prog,
        comune: a.comune,
        comune_norm: a.comuneNorm,
        frazione: a.frazione,
        tipo_strada: a.tipoStrada,
        tipo_strada_norm: a.tipoStradaNorm,
        nome_strada: a.nomeStrada,
        nome_strada_norm: a.nomeStradaNorm,
        nome_tokens: a.nomeTokens,
        civico_raw: a.civicoRaw,
        civico_num: a.civicoNum,
        civico_suffix: a.civicoSuffix,
        civico_start: a.civicoStart,
        civico_end: a.civicoEnd,
        parity: a.parity,
        is_snc: a.isSnc,
        scala: a.scala,
        note: a.note,
        raw_address: a.rawAddress,
        version_changed: nextVersion,
        deleted: false,
      }));
      const { error: insErr } = await sb.from('center_addresses').insert(chunk);
      if (insErr) throw new Error(insErr.message);
    }

    const { data: activePdfs } = await sb
      .from('center_pdfs')
      .select('zone_number')
      .eq('center_id', centerId)
      .eq('deleted', false);
    const { data: activeAddrs } = await sb
      .from('center_addresses')
      .select('zona, comune')
      .eq('center_id', centerId)
      .eq('deleted', false);

    const zones = Array.from(
      new Set([
        ...(activePdfs || []).map((p) => p.zone_number),
        ...(activeAddrs || []).map((a) => a.zona),
      ].filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
    const comuni = Array.from(
      new Set((activeAddrs || []).map((a) => a.comune).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'it'));

    const { data: updatedCenter } = await sb
      .from('centers')
      .update({
        version: nextVersion,
        pdf_count: (activePdfs || []).length,
        address_count: (activeAddrs || []).length,
        zones,
        comuni,
        updated_at: new Date().toISOString(),
      })
      .eq('id', centerId)
      .select('*')
      .single();

    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: duplicateResolution === 'replace' ? 'sostituzione_pdf' : 'caricamento_pdf',
      center_id: centerId,
      center_name: centerRow.name,
      details: `${pdfRecord.fileName} (Zona ${pdfRecord.zoneNumber}, ${uniqueNewAddresses.length} indirizzi, v${nextVersion})`,
    });

    return {
      center: {
        id: updatedCenter.id,
        name: updatedCenter.name,
        notes: updatedCenter.notes || '',
        version: nextVersion,
        pdfCount: (activePdfs || []).length,
        addressCount: (activeAddrs || []).length,
        zones,
        comuni,
        createdAt: new Date(updatedCenter.created_at).getTime(),
        updatedAt: new Date(updatedCenter.updated_at).getTime(),
      },
      pdf: { ...pdfRecord, extractedCount: uniqueNewAddresses.length, versionAdded: nextVersion },
    };
  }

  // Modalità Local Cloud Store
  const store = loadStore();
  const cIdx = store.centers.findIndex((c) => c.id === centerId);
  if (cIdx === -1) throw new Error('Centro non trovato.');
  const center = store.centers[cIdx];
  const nextVersion = center.version + 1;

  // Backup automatico prima di sostituire
  if (duplicateResolution === 'replace' && replacePdfId) {
    createBackupSnapshot(store, centerId, 'auto', actorEmail);
    for (const p of store.pdfs) {
      if (p.id === replacePdfId && !p.deleted) {
        p.deleted = true;
        p.versionDeleted = nextVersion;
      }
    }
    for (const a of store.addresses) {
      if (a.pdfId === replacePdfId && !a.deleted) {
        a.deleted = true;
        a.versionChanged = nextVersion;
      }
    }
  }

  if (pdfBase64) {
    const buf = Buffer.from(pdfBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    fs.writeFileSync(resolveSafePdfPath(pdfRecord.id), buf);
  }

  // Deduplicazione indirizzi rispetto ai record già attivi nel Centro
  const activeKeys = new Set(
    store.addresses
      .filter((a) => a.centerId === centerId && !a.deleted)
      .map(
        (a) =>
          `${a.zona}|${a.subzona}|${a.comuneNorm}|${a.tipoStradaNorm}|${a.nomeStradaNorm}|${a.civicoRaw}|${a.scala}`
      )
  );

  const uniqueNew: StoredAddress[] = [];
  for (const a of addresses) {
    const k = `${a.zona}|${a.subzona}|${a.comuneNorm}|${a.tipoStradaNorm}|${a.nomeStradaNorm}|${a.civicoRaw}|${a.scala}`;
    if (activeKeys.has(k)) continue;
    activeKeys.add(k);
    uniqueNew.push({
      ...a,
      pdfId: pdfRecord.id,
      centerId,
      versionChanged: nextVersion,
      deleted: false,
    });
  }

  const storedPdf: StoredPdf = {
    ...pdfRecord,
    centerId,
    extractedCount: uniqueNew.length,
    versionAdded: nextVersion,
    deleted: false,
  };
  store.pdfs.push(storedPdf);
  store.addresses.push(...uniqueNew);

  const updatedCenter = computeCenterStats(
    { ...center, version: nextVersion, updatedAt: Date.now() },
    store.pdfs,
    store.addresses
  );
  store.centers[cIdx] = updatedCenter;

  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: duplicateResolution === 'replace' ? 'sostituzione_pdf' : 'caricamento_pdf',
    centerId,
    centerName: updatedCenter.name,
    details: `${pdfRecord.fileName} (Zona ${pdfRecord.zoneNumber}, ${uniqueNew.length} indirizzi, v${nextVersion})`,
  });

  saveStore(store);

  const { deleted: _d, versionDeleted: _vd, ...cleanPdf } = storedPdf;
  return { center: updatedCenter, pdf: cleanPdf };
}

export async function adminDeletePdf(
  actorEmail: string,
  centerId: string,
  pdfId: string
): Promise<DeliveryCenter> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: cRow } = await sb.from('centers').select('*').eq('id', centerId).single();
    if (!cRow) throw new Error('Centro non trovato.');
    const nextVersion = Number(cRow.version || 1) + 1;
    const { data: pdfRow } = await sb
      .from('center_pdfs')
      .select('file_name, storage_path')
      .eq('id', pdfId)
      .maybeSingle();

    await sb
      .from('center_pdfs')
      .update({ deleted: true, version_deleted: nextVersion })
      .eq('id', pdfId);
    await sb
      .from('center_addresses')
      .update({ deleted: true, version_changed: nextVersion })
      .eq('pdf_id', pdfId);

    const { data: activePdfs } = await sb
      .from('center_pdfs')
      .select('zone_number')
      .eq('center_id', centerId)
      .eq('deleted', false);
    const { data: activeAddrs } = await sb
      .from('center_addresses')
      .select('zona, comune')
      .eq('center_id', centerId)
      .eq('deleted', false);

    const zones = Array.from(
      new Set([...(activePdfs || []).map((p) => p.zone_number), ...(activeAddrs || []).map((a) => a.zona)].filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
    const comuni = Array.from(
      new Set((activeAddrs || []).map((a) => a.comune).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'it'));

    const { data: updatedCenter } = await sb
      .from('centers')
      .update({
        version: nextVersion,
        pdf_count: (activePdfs || []).length,
        address_count: (activeAddrs || []).length,
        zones,
        comuni,
        updated_at: new Date().toISOString(),
      })
      .eq('id', centerId)
      .select('*')
      .single();

    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'eliminazione_pdf',
      center_id: centerId,
      center_name: cRow.name,
      details: `Eliminato PDF "${pdfRow?.file_name || pdfId}" (v${nextVersion})`,
    });

    return {
      id: updatedCenter.id,
      name: updatedCenter.name,
      notes: updatedCenter.notes || '',
      version: nextVersion,
      pdfCount: (activePdfs || []).length,
      addressCount: (activeAddrs || []).length,
      zones,
      comuni,
      createdAt: new Date(updatedCenter.created_at).getTime(),
      updatedAt: new Date(updatedCenter.updated_at).getTime(),
    };
  }

  const store = loadStore();
  const cIdx = store.centers.findIndex((c) => c.id === centerId);
  if (cIdx === -1) throw new Error('Centro non trovato.');
  const center = store.centers[cIdx];
  const nextVersion = center.version + 1;

  createBackupSnapshot(store, centerId, 'auto', actorEmail);

  const pdf = store.pdfs.find((p) => p.id === pdfId && p.centerId === centerId);
  if (pdf) {
    pdf.deleted = true;
    pdf.versionDeleted = nextVersion;
  }
  for (const a of store.addresses) {
    if (a.pdfId === pdfId && a.centerId === centerId && !a.deleted) {
      a.deleted = true;
      a.versionChanged = nextVersion;
    }
  }

  const updatedCenter = computeCenterStats(
    { ...center, version: nextVersion, updatedAt: Date.now() },
    store.pdfs,
    store.addresses
  );
  store.centers[cIdx] = updatedCenter;
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'eliminazione_pdf',
    centerId,
    centerName: updatedCenter.name,
    details: `Eliminato PDF "${pdf?.fileName || pdfId}" (v${nextVersion})`,
  });
  saveStore(store);
  return updatedCenter;
}

export async function recordAdminLogout(actorEmail: string): Promise<void> {
  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'logout_admin',
      details: 'Logout amministratore effettuato',
    });
    return;
  }
  const store = loadStore();
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'logout_admin',
    details: 'Logout amministratore effettuato',
  });
  saveStore(store);
}

export async function adminRegenerateCenterDb(
  actorEmail: string,
  centerId: string
): Promise<DeliveryCenter> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: cRow } = await sb.from('centers').select('*').eq('id', centerId).single();
    if (!cRow) throw new Error('Centro non trovato.');
    const nextVersion = Number(cRow.version || 1) + 1;

    const { data: activeAddrs } = await sb
      .from('center_addresses')
      .select('*')
      .eq('center_id', centerId)
      .eq('deleted', false);

    const seen = new Set<string>();
    const dupIds: string[] = [];
    const zonesSet = new Set<string>();
    const comuniSet = new Set<string>();

    for (const a of activeAddrs || []) {
      const k = `${a.zona}|${a.subzona}|${a.comune_norm}|${a.tipo_strada_norm}|${a.nome_strada_norm}|${a.civico_raw}|${a.scala}`;
      if (seen.has(k)) {
        dupIds.push(a.id);
      } else {
        seen.add(k);
        if (a.zona) zonesSet.add(a.zona);
        if (a.comune) comuniSet.add(a.comune);
      }
    }

    if (dupIds.length > 0) {
      await sb
        .from('center_addresses')
        .update({ deleted: true, version_changed: nextVersion })
        .in('id', dupIds);
    }

    const zones = Array.from(zonesSet).sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
    const comuni = Array.from(comuniSet).sort((a, b) => a.localeCompare(b, 'it'));
    const validCount = (activeAddrs || []).length - dupIds.length;

    const { data: updated } = await sb
      .from('centers')
      .update({
        version: nextVersion,
        address_count: validCount,
        zones,
        comuni,
        updated_at: new Date().toISOString(),
      })
      .eq('id', centerId)
      .select('*')
      .single();

    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'rigenerazione_db',
      center_id: centerId,
      center_name: cRow.name,
      details: `Rigenerato database "${cRow.name}" (${validCount} indirizzi, rimossi ${dupIds.length} duplicati, v${nextVersion})`,
    });

    return {
      id: updated.id,
      name: updated.name,
      notes: updated.notes || '',
      version: nextVersion,
      pdfCount: Number(updated.pdf_count || 0),
      addressCount: validCount,
      zones,
      comuni,
      createdAt: new Date(updated.created_at).getTime(),
      updatedAt: new Date(updated.updated_at).getTime(),
    };
  }

  const store = loadStore();
  const cIdx = store.centers.findIndex((c) => c.id === centerId);
  if (cIdx === -1) throw new Error('Centro non trovato.');

  const nextVersion = store.centers[cIdx].version + 1;
  const seen = new Set<string>();
  for (const a of store.addresses) {
    if (a.centerId !== centerId || a.deleted) continue;
    const k = `${a.zona}|${a.subzona}|${a.comuneNorm}|${a.tipoStradaNorm}|${a.nomeStradaNorm}|${a.civicoRaw}|${a.scala}`;
    if (seen.has(k)) {
      a.deleted = true;
      a.versionChanged = nextVersion;
    } else {
      seen.add(k);
      a.versionChanged = nextVersion;
    }
  }

  const updated = computeCenterStats(
    { ...store.centers[cIdx], version: nextVersion, updatedAt: Date.now() },
    store.pdfs,
    store.addresses
  );
  store.centers[cIdx] = updated;
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'rigenerazione_db',
    centerId,
    centerName: updated.name,
    details: `Rigenerato e deduplicato database "${updated.name}" (${updated.addressCount} indirizzi, v${nextVersion})`,
  });
  saveStore(store);
  return updated;
}

export async function adminListUsers(): Promise<AdminUserRecord[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data } = await sb
      .from('admin_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    return (data || []).map((a) => ({
      id: a.id,
      email: a.email,
      role: 'admin',
      active: Boolean(a.active),
      mustChangePassword: Boolean(a.must_change_password),
      hasPassword: Boolean(a.user_id),
      createdBy: a.created_by || '',
      createdAt: new Date(a.created_at).getTime(),
      updatedAt: new Date(a.updated_at).getTime(),
    }));
  }

  const store = loadStore();
  return store.admins.map(sanitizeAdmin);
}

export async function adminCreateUser(
  actorEmail: string,
  newEmailRaw: string,
  initialPassword?: string
): Promise<AdminUserRecord> {
  const newEmail = newEmailRaw.trim().toLowerCase();
  if (!newEmail.includes('@')) throw new Error('Email non valida.');

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: existing } = await sb
      .from('admin_profiles')
      .select('id')
      .ilike('email', newEmail)
      .maybeSingle();
    if (existing) throw new Error('Esiste già un amministratore con questa email.');

    let userId: string | null = null;
    if (initialPassword && initialPassword.length >= 8) {
      const { data: u, error: uErr } = await sb.auth.admin.createUser({
        email: newEmail,
        password: initialPassword,
        email_confirm: true,
      });
      if (uErr || !u.user) throw new Error(uErr?.message || 'Errore creazione utente Auth.');
      userId = u.user.id;
    }

    const { data: inserted, error } = await sb
      .from('admin_profiles')
      .insert({
        email: newEmail,
        user_id: userId,
        role: 'admin',
        active: true,
        must_change_password: true,
        created_by: actorEmail,
      })
      .select('*')
      .single();
    if (error || !inserted) throw new Error(error?.message || 'Errore inserimento profilo.');

    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'gestione_admin',
      details: `Creato nuovo amministratore: ${newEmail}`,
    });

    return {
      id: inserted.id,
      email: inserted.email,
      role: 'admin',
      active: true,
      mustChangePassword: true,
      hasPassword: Boolean(userId),
      createdBy: actorEmail,
      createdAt: new Date(inserted.created_at).getTime(),
      updatedAt: new Date(inserted.updated_at).getTime(),
    };
  }

  const store = loadStore();
  if (store.admins.some((a) => a.email.toLowerCase() === newEmail)) {
    throw new Error('Esiste già un amministratore con questa email.');
  }
  const now = Date.now();
  const hasInitial = Boolean(initialPassword && initialPassword.length >= 8);
  const created: StoredAdmin = {
    id: crypto.randomUUID(),
    email: newEmail,
    role: 'admin',
    active: true,
    mustChangePassword: true,
    hasPassword: hasInitial,
    passwordHash: hasInitial && initialPassword ? hashPassword(initialPassword) : null,
    createdBy: actorEmail,
    createdAt: now,
    updatedAt: now,
  };
  store.admins.push(created);
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'gestione_admin',
    details: `Creato nuovo amministratore: ${newEmail}`,
  });
  saveStore(store);
  return sanitizeAdmin(created);
}

export async function adminToggleUserActive(
  actorEmail: string,
  targetAdminId: string,
  active: boolean
): Promise<AdminUserRecord> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: target } = await sb
      .from('admin_profiles')
      .select('*')
      .eq('id', targetAdminId)
      .single();
    if (!target) throw new Error('Amministratore non trovato.');
    if (target.email.toLowerCase() === actorEmail.toLowerCase() && !active) {
      throw new Error('Non puoi disattivare il tuo stesso account.');
    }
    const { data: upd } = await sb
      .from('admin_profiles')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', targetAdminId)
      .select('*')
      .single();
    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'gestione_admin',
      details: `${active ? 'Riattivato' : 'Disattivato'} amministratore ${target.email}`,
    });
    return {
      id: upd.id,
      email: upd.email,
      role: 'admin',
      active: Boolean(upd.active),
      mustChangePassword: Boolean(upd.must_change_password),
      hasPassword: Boolean(upd.user_id),
      createdBy: upd.created_by || '',
      createdAt: new Date(upd.created_at).getTime(),
      updatedAt: new Date(upd.updated_at).getTime(),
    };
  }

  const store = loadStore();
  const target = store.admins.find((a) => a.id === targetAdminId);
  if (!target) throw new Error('Amministratore non trovato.');
  if (target.email.toLowerCase() === actorEmail.toLowerCase() && !active) {
    throw new Error('Non puoi disattivare il tuo stesso account.');
  }
  target.active = active;
  target.updatedAt = Date.now();
  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'gestione_admin',
    details: `${active ? 'Riattivato' : 'Disattivato'} amministratore ${target.email}`,
  });
  saveStore(store);
  return sanitizeAdmin(target);
}

export async function adminListLogs(): Promise<ActivityLogEntry[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data } = await sb
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    return (data || []).map((l) => ({
      id: l.id,
      actorEmail: l.actor_email,
      actorRole: l.actor_role,
      action: l.action,
      centerId: l.center_id || undefined,
      centerName: l.center_name || undefined,
      details: l.details || '',
      createdAt: new Date(l.created_at).getTime(),
    }));
  }

  const store = loadStore();
  return store.logs;
}

export async function adminCreateAndListBackups(
  actorEmail?: string,
  centerIdToBackup?: string
): Promise<CenterBackupRecord[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    if (actorEmail && centerIdToBackup) {
      const exported = await adminExportCenterPayload(actorEmail, centerIdToBackup);
      await sb.from('center_backups').insert({
        center_id: exported.center.id,
        center_name: exported.center.name,
        center_version: exported.center.version,
        reason: 'manual',
        created_by: actorEmail,
        payload: exported,
      });
    }
    const { data } = await sb
      .from('center_backups')
      .select('id, center_id, center_name, center_version, reason, created_by, created_at, payload')
      .order('created_at', { ascending: false })
      .limit(50);
    return (data || []).map((b) => ({
      id: b.id,
      centerId: b.center_id,
      centerName: b.center_name,
      centerVersion: Number(b.center_version || 1),
      reason: b.reason || 'manual',
      createdBy: b.created_by,
      createdAt: new Date(b.created_at).getTime(),
      pdfCount: Array.isArray(b.payload?.pdfs) ? b.payload.pdfs.length : 0,
      addressCount: Array.isArray(b.payload?.addresses) ? b.payload.addresses.length : 0,
    }));
  }

  const store = loadStore();
  if (actorEmail && centerIdToBackup) {
    const created = createBackupSnapshot(store, centerIdToBackup, 'manual', actorEmail);
    if (created) {
      appendLog(store, {
        actorEmail,
        actorRole: 'admin',
        action: 'backup_creato',
        centerId: created.centerId,
        centerName: created.centerName,
        details: `Backup manuale Centro "${created.centerName}" (v${created.centerVersion})`,
      });
      saveStore(store);
    }
  }

  return store.backups.map(({ payload: _p, ...meta }) => meta);
}

export async function adminExportCenterPayload(
  actorEmail: string,
  centerId: string
): Promise<{
  exportedAt: number;
  exportedBy: string;
  center: DeliveryCenter;
  pdfs: PdfDocumentRecord[];
  addresses: AddressRecord[];
}> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const delta = await getCloudSyncDelta(centerId, 0);
    await sb.from('activity_logs').insert({
      actor_email: actorEmail,
      actor_role: 'admin',
      action: 'backup_creato',
      center_id: centerId,
      center_name: delta.center.name,
      details: `Esportazione/Backup Centro "${delta.center.name}" (${delta.upsertedAddresses.length} indirizzi)`,
    });
    return {
      exportedAt: Date.now(),
      exportedBy: actorEmail,
      center: delta.center,
      pdfs: delta.upsertedPdfs,
      addresses: delta.upsertedAddresses,
    };
  }

  const store = loadStore();
  const center = store.centers.find((c) => c.id === centerId);
  if (!center) throw new Error('Centro non trovato.');
  const pdfs = store.pdfs
    .filter((p) => p.centerId === centerId && !p.deleted)
    .map(({ deleted: _d, versionDeleted: _vd, ...rest }) => rest);
  const addresses = store.addresses
    .filter((a) => a.centerId === centerId && !a.deleted)
    .map(({ deleted: _d, ...rest }) => rest);

  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'backup_creato',
    centerId,
    centerName: center.name,
    details: `Esportazione JSON Centro "${center.name}" (${addresses.length} indirizzi)`,
  });
  saveStore(store);

  return {
    exportedAt: Date.now(),
    exportedBy: actorEmail,
    center,
    pdfs,
    addresses,
  };
}

export async function adminRestoreBackupOrImport(
  actorEmail: string,
  options: {
    backupId?: string;
    importedPayload?: {
      center: DeliveryCenter;
      pdfs: PdfDocumentRecord[];
      addresses: AddressRecord[];
    };
  }
): Promise<DeliveryCenter> {
  const sb = getSupabaseAdmin();
  if (sb) {
    let payload = options.importedPayload;
    if (options.backupId) {
      const { data: b } = await sb
        .from('center_backups')
        .select('payload')
        .eq('id', options.backupId)
        .single();
      payload = b?.payload;
    }
    if (!payload?.center?.name) {
      throw new Error('File o snapshot di backup non valido.');
    }

    const existingCenters = await listCloudCenters();
    const match = existingCenters.find((c) => c.id === payload!.center.id);
    const targetCenter = match
      ? await adminUpdateCenter(actorEmail, match.id, payload.center.name, payload.center.notes)
      : await adminCreateCenter(actorEmail, payload.center.name, payload.center.notes);

    const newPdfId = crypto.randomUUID();
    const { center: finalCenter } = await adminUploadPdfAndAddresses({
      actorEmail,
      centerId: targetCenter.id,
      pdfRecord: {
        id: newPdfId,
        centerId: targetCenter.id,
        fileName: payload.pdfs?.[0]?.fileName || `${targetCenter.name}_ripristino.pdf`,
        zoneNumber: payload.pdfs?.[0]?.zoneNumber || payload.center.zones?.[0] || '1',
        fileSize: payload.pdfs?.[0]?.fileSize || 0,
        pageCount: payload.pdfs?.[0]?.pageCount || 1,
        extractedCount: (payload.addresses || []).length,
        extractionMethod: 'native',
        importedAt: Date.now(),
      },
      addresses: (payload.addresses || []).map((a) => ({
        ...a,
        id: crypto.randomUUID(),
        centerId: targetCenter.id,
        pdfId: newPdfId,
      })),
      duplicateResolution: 'new',
    });
    return finalCenter;
  }

  const store = loadStore();
  let payload = options.importedPayload;
  if (options.backupId) {
    const found = store.backups.find((b) => b.id === options.backupId);
    if (!found) throw new Error('Backup non trovato.');
    payload = found.payload;
  }
  if (!payload?.center?.name) {
    throw new Error('File o snapshot di backup non valido.');
  }

  const existingIdx = store.centers.findIndex((c) => c.id === payload!.center.id);
  const targetId = existingIdx !== -1 ? payload.center.id : payload.center.id || crypto.randomUUID();
  const nextVersion = existingIdx !== -1 ? store.centers[existingIdx].version + 1 : 1;

  if (existingIdx !== -1) {
    for (const p of store.pdfs) {
      if (p.centerId === targetId && !p.deleted) {
        p.deleted = true;
        p.versionDeleted = nextVersion;
      }
    }
    for (const a of store.addresses) {
      if (a.centerId === targetId && !a.deleted) {
        a.deleted = true;
        a.versionChanged = nextVersion;
      }
    }
  }

  for (const p of payload.pdfs || []) {
    store.pdfs.push({
      ...p,
      id: crypto.randomUUID(),
      centerId: targetId,
      versionAdded: nextVersion,
      deleted: false,
    });
  }
  const newPdfFallbackId =
    store.pdfs.find((p) => p.centerId === targetId && !p.deleted)?.id || crypto.randomUUID();
  for (const a of payload.addresses || []) {
    store.addresses.push({
      ...a,
      id: crypto.randomUUID(),
      centerId: targetId,
      pdfId: a.pdfId || newPdfFallbackId,
      versionChanged: nextVersion,
      deleted: false,
    });
  }

  const restoredBase: DeliveryCenter = {
    ...payload.center,
    id: targetId,
    version: nextVersion,
    updatedAt: Date.now(),
  };
  const computed = computeCenterStats(restoredBase, store.pdfs, store.addresses);
  if (existingIdx !== -1) {
    store.centers[existingIdx] = computed;
  } else {
    store.centers.unshift(computed);
  }

  appendLog(store, {
    actorEmail,
    actorRole: 'admin',
    action: 'backup_ripristinato',
    centerId: computed.id,
    centerName: computed.name,
    details: `Ripristinato Centro "${computed.name}" (v${computed.version}, ${computed.addressCount} indirizzi)`,
  });
  saveStore(store);
  return computed;
}

export async function adminGetCloudDiagnostics(): Promise<{
  backendMode: 'supabase' | 'local-cloud';
  cloudCentersCount: number;
  cloudPdfsCount: number;
  cloudAddressesCount: number;
  cloudTotalStorageBytes: number;
}> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: centers } = await sb.from('centers').select('pdf_count, address_count');
    const { data: pdfs } = await sb
      .from('center_pdfs')
      .select('file_size')
      .eq('deleted', false);
    return {
      backendMode: 'supabase',
      cloudCentersCount: (centers || []).length,
      cloudPdfsCount: (pdfs || []).length,
      cloudAddressesCount: (centers || []).reduce((acc, c) => acc + Number(c.address_count || 0), 0),
      cloudTotalStorageBytes: (pdfs || []).reduce((acc, p) => acc + Number(p.file_size || 0), 0),
    };
  }

  const store = loadStore();
  const activePdfs = store.pdfs.filter((p) => !p.deleted);
  const activeAddrs = store.addresses.filter((a) => !a.deleted);
  return {
    backendMode: 'local-cloud',
    cloudCentersCount: store.centers.length,
    cloudPdfsCount: activePdfs.length,
    cloudAddressesCount: activeAddrs.length,
    cloudTotalStorageBytes: activePdfs.reduce((acc, p) => acc + (p.fileSize || 0), 0),
  };
}
