import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  hasCentralizedSupabaseConfig,
  inspectPublishableKey,
  inspectSupabaseConfig,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  type SupabaseConfigInspection,
} from '../config/supabaseConfig';

let cachedClient: SupabaseClient | null = null;
let lastClientInitError: string | null = null;
let lastClientInitStack: string | null = null;

export type RuntimeEnvironmentLabel = 'AI Studio Preview' | 'Produzione Netlify';

export interface DiagnosticErrorDetail {
  source: string;
  code: string;
  message: string;
  hint?: string | null;
  details?: string | null;
  httpStatus?: number | null;
  stack?: string | null;
}

export interface DiagnosticCallReport {
  ok: boolean;
  statusLabel: string;
  httpStatus?: number | null;
  code?: string | null;
  message: string;
  hint?: string | null;
  details?: string | null;
  rawSummary: string;
  stack?: string | null;
}

export interface SupabaseConnectionDiagnostics {
  environment: RuntimeEnvironmentLabel;
  hostname: string;
  origin: string;
  isOnline: boolean;
  supabaseUrlUsed: string;
  keyVarName: 'VITE_SUPABASE_ANON_KEY';
  keyPreview: string;
  urlLoaded: boolean;
  urlFormatValid: boolean;
  urlFormatMessage: string;
  keyLoaded: boolean;
  keyFormatValid: boolean;
  keyFormatMessage: string;
  sdkImportValid: boolean;
  clientInitialized: boolean;
  clientInitMessage: string;
  clientInitStack: string | null;
  corsAndNetworkCheck: DiagnosticCallReport;
  authReachable: boolean;
  getSessionReport: DiagnosticCallReport;
  getUserReport: DiagnosticCallReport;
  dbQueryReport: DiagnosticCallReport;
  rpcHealthReport: DiagnosticCallReport | null;
  dbReachable: boolean;
  connected: boolean;
  failureDiagnosis: string | null;
  configInspection: SupabaseConfigInspection;
  errorDetails: DiagnosticErrorDetail[];
  errors: string[];
  checkedAt: number;
}

function compactStack(err: unknown): string | null {
  const rawStack =
    err instanceof Error && typeof err.stack === 'string' ? err.stack : '';
  if (!rawStack) return null;
  return rawStack
    .split('\n')
    .map((line) => line.trimEnd())
    .slice(0, 7)
    .join('\n');
}

function maskKeyPreview(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '(assente)';
  if (trimmed.length <= 16) return `${trimmed.slice(0, 4)}… (${trimmed.length} car.)`;
  return `${trimmed.slice(0, 15)}…${trimmed.slice(-4)} (${trimmed.length} car.)`;
}

export function detectRuntimeEnvironment(): {
  environment: RuntimeEnvironmentLabel;
  hostname: string;
  origin: string;
} {
  if (typeof window === 'undefined') {
    return {
      environment: 'AI Studio Preview',
      hostname: 'server',
      origin: '',
    };
  }
  const hostname = window.location.hostname || '';
  const origin = window.location.origin || '';
  const isAiStudioOrLocal =
    hostname.includes('run.app') ||
    hostname.includes('aistudio') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1';

  return {
    environment: isAiStudioOrLocal ? 'AI Studio Preview' : 'Produzione Netlify',
    hostname,
    origin,
  };
}

export function isSupabaseConfigured(): boolean {
  return hasCentralizedSupabaseConfig();
}

export function getSupabaseInitError(): string | null {
  const inspection = inspectSupabaseConfig();
  if (!inspection.ready) {
    return [inspection.urlError, inspection.keyError].filter(Boolean).join(' | ');
  }
  return lastClientInitError;
}

export function regenerateSupabaseClient(): SupabaseClient | null {
  cachedClient = null;
  lastClientInitError = null;
  lastClientInitStack = null;
  return getSupabaseClient();
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!hasCentralizedSupabaseConfig()) {
    return null;
  }

  if (!cachedClient) {
    try {
      cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      lastClientInitError = null;
      lastClientInitStack = null;
    } catch (err) {
      lastClientInitError =
        err instanceof Error
          ? `Errore createClient() Supabase: ${err.message}`
          : `Errore createClient() Supabase: ${String(err)}`;
      lastClientInitStack = compactStack(err);
      return null;
    }
  }
  return cachedClient;
}

export async function runSupabaseConnectionDiagnostics(): Promise<SupabaseConnectionDiagnostics> {
  const envInfo = detectRuntimeEnvironment();
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const inspection = inspectSupabaseConfig();
  const keyInspection = inspectPublishableKey(SUPABASE_ANON_KEY);
  const sdkImportValid = typeof createClient === 'function';

  const errorDetails: DiagnosticErrorDetail[] = [];
  const errors: string[] = [];

  const pushError = (detail: DiagnosticErrorDetail) => {
    errorDetails.push(detail);
    const parts = [
      `[${detail.source}]`,
      detail.code ? `(${detail.code})` : '',
      detail.message,
      detail.hint ? `Hint: ${detail.hint}` : '',
    ].filter(Boolean);
    errors.push(parts.join(' '));
  };

  if (inspection.urlError) {
    pushError({
      source: 'Configurazione VITE_SUPABASE_URL',
      code: SUPABASE_URL ? 'INVALID_SUPABASE_URL' : 'MISSING_SUPABASE_URL',
      message: inspection.urlError,
    });
  }
  if (inspection.keyError) {
    pushError({
      source: 'Configurazione VITE_SUPABASE_ANON_KEY',
      code: SUPABASE_ANON_KEY ? 'INVALID_SUPABASE_KEY' : 'MISSING_SUPABASE_KEY',
      message: inspection.keyError,
    });
  }

  if (!sdkImportValid) {
    pushError({
      source: 'Import @supabase/supabase-js',
      code: 'CREATE_CLIENT_MISSING',
      message: 'createClient non risulta importato correttamente da @supabase/supabase-js.',
    });
  }

  const client = regenerateSupabaseClient();
  let clientInitialized = false;
  let clientInitMessage = 'Client non inizializzato: configurazione URL o Key incompleta.';

  if (inspection.ready) {
    if (client) {
      clientInitialized = true;
      clientInitMessage = 'createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) inizializzato correttamente.';
    } else {
      clientInitMessage =
        lastClientInitError ||
        'createClient() ha restituito null nonostante VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY presenti.';
      pushError({
        source: 'Inizializzazione createClient()',
        code: 'CLIENT_INIT_FAILED',
        message: clientInitMessage,
        stack: lastClientInitStack,
      });
    }
  }

  let authReachable = false;
  let dbReachable = false;

  let corsAndNetworkCheck: DiagnosticCallReport = {
    ok: false,
    statusLabel: 'NON ESEGUITO',
    message: 'Verifica rete/CORS non eseguita perché il client non è pronto.',
    rawSummary: 'Prerequisiti mancanti',
  };

  let getSessionReport: DiagnosticCallReport = {
    ok: false,
    statusLabel: 'NON ESEGUITO',
    message: 'supabase.auth.getSession() non eseguito.',
    rawSummary: 'Client non inizializzato',
  };

  let getUserReport: DiagnosticCallReport = {
    ok: false,
    statusLabel: 'NON ESEGUITO',
    message: 'supabase.auth.getUser() non eseguito.',
    rawSummary: 'Client non inizializzato',
  };

  let dbQueryReport: DiagnosticCallReport = {
    ok: false,
    statusLabel: 'NON ESEGUITO',
    message: 'Query di test database non eseguita.',
    rawSummary: 'Client non inizializzato',
  };

  let rpcHealthReport: DiagnosticCallReport | null = null;

  if (client && inspection.ready) {
    if (!isOnline) {
      const offlineMsg =
        'Dispositivo offline (navigator.onLine = false): impossibile raggiungere Supabase.';
      corsAndNetworkCheck = {
        ok: false,
        statusLabel: 'OFFLINE',
        code: 'NETWORK_OFFLINE',
        message: offlineMsg,
        rawSummary: offlineMsg,
      };
      pushError({
        source: 'Rete dispositivo',
        code: 'NETWORK_OFFLINE',
        message: offlineMsg,
      });
    } else {
      // 1. Verifica live rete + CORS + endpoint Auth (/auth/v1/settings)
      try {
        const authHeaders: Record<string, string> = {
          apikey: SUPABASE_ANON_KEY,
        };
        if (SUPABASE_ANON_KEY.startsWith('eyJ')) {
          authHeaders.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
        }
        const authResp = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
          method: 'GET',
          mode: 'cors',
          headers: authHeaders,
        });
        const allowOrigin = authResp.headers.get('access-control-allow-origin');
        if (authResp.ok) {
          authReachable = true;
          corsAndNetworkCheck = {
            ok: true,
            statusLabel: `OK (HTTP ${authResp.status})`,
            httpStatus: authResp.status,
            message: `Endpoint Auth raggiungibile senza blocchi CORS (${SUPABASE_URL}/auth/v1/settings).`,
            rawSummary: `HTTP ${authResp.status} ${authResp.statusText || 'OK'} · ACAO: ${allowOrigin || 'consentito dal browser'}`,
          };
        } else {
          const rawBody = await authResp.text().catch(() => '');
          const msg = rawBody.slice(0, 280) || authResp.statusText || 'Errore HTTP Auth';
          corsAndNetworkCheck = {
            ok: false,
            statusLabel: `ERRORE HTTP ${authResp.status}`,
            httpStatus: authResp.status,
            code: `AUTH_HTTP_${authResp.status}`,
            message: msg,
            rawSummary: `HTTP ${authResp.status}: ${msg}`,
          };
          pushError({
            source: 'Auth Endpoint (/auth/v1/settings)',
            code: `AUTH_HTTP_${authResp.status}`,
            httpStatus: authResp.status,
            message: msg,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = compactStack(err);
        const isCorsOrNet =
          msg.toLowerCase().includes('failed to fetch') ||
          msg.toLowerCase().includes('networkerror') ||
          msg.toLowerCase().includes('cors');
        const fullMsg = isCorsOrNet
          ? `Richiesta bloccata da errore di rete o CORS verso ${SUPABASE_URL}/auth/v1/settings (${msg}).`
          : `Errore fetch verso Auth: ${msg}`;
        corsAndNetworkCheck = {
          ok: false,
          statusLabel: isCorsOrNet ? 'BLOCCO RETE / CORS' : 'ERRORE RETE',
          code: isCorsOrNet ? 'NETWORK_OR_CORS_ERROR' : 'FETCH_EXCEPTION',
          message: fullMsg,
          rawSummary: fullMsg,
          stack,
        };
        pushError({
          source: 'Rete / CORS (Auth)',
          code: isCorsOrNet ? 'NETWORK_OR_CORS_ERROR' : 'FETCH_EXCEPTION',
          message: fullMsg,
          stack,
        });
      }

      // 2. Risposta di supabase.auth.getSession()
      try {
        const { data, error } = await client.auth.getSession();
        if (error) {
          const stack = compactStack(error);
          const errCode = error.code || `AUTH_STATUS_${error.status ?? 'ERR'}`;
          getSessionReport = {
            ok: false,
            statusLabel: 'ERRORE',
            httpStatus: error.status ?? null,
            code: errCode,
            message: error.message,
            rawSummary: `code=${errCode}, status=${error.status ?? 'n/d'}, message="${error.message}"`,
            stack,
          };
          pushError({
            source: 'supabase.auth.getSession()',
            code: errCode,
            httpStatus: error.status ?? null,
            message: error.message,
            stack,
          });
        } else {
          const sessionEmail = data.session?.user?.email || null;
          getSessionReport = {
            ok: true,
            statusLabel: data.session ? 'SESSIONE ATTIVA' : 'NESSUNA SESSIONE (OK)',
            message: data.session
              ? `Sessione valida per ${sessionEmail || data.session.user.id}`
              : 'Nessuna sessione salvata localmente (data.session = null, error = null).',
            rawSummary: JSON.stringify({
              hasSession: Boolean(data.session),
              userEmail: sessionEmail,
              expiresAt: data.session?.expires_at ?? null,
              error: null,
            }),
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = compactStack(err);
        getSessionReport = {
          ok: false,
          statusLabel: 'ECCEZIONE',
          code: 'GET_SESSION_EXCEPTION',
          message: msg,
          rawSummary: msg,
          stack,
        };
        pushError({
          source: 'supabase.auth.getSession()',
          code: 'GET_SESSION_EXCEPTION',
          message: msg,
          stack,
        });
      }

      // 3. Risposta di supabase.auth.getUser()
      try {
        const { data, error } = await client.auth.getUser();
        if (error) {
          const stack = compactStack(error);
          const isMissingSession =
            error.name === 'AuthSessionMissingError' ||
            error.message.toLowerCase().includes('auth session missing');
          const errCode = error.code || error.name || `AUTH_STATUS_${error.status ?? 'ERR'}`;
          getUserReport = {
            ok: isMissingSession,
            statusLabel: isMissingSession
              ? 'NESSUN UTENTE LOGGATO (AuthSessionMissingError)'
              : 'ERRORE',
            httpStatus: error.status ?? null,
            code: errCode,
            message: error.message,
            rawSummary: `name=${error.name}, status=${error.status ?? 'n/d'}, code=${error.code ?? 'none'}, message="${error.message}"`,
            stack,
          };
          // Non trattare la normale assenza di sessione utente in Home pubblica come errore fatale di connessione
          if (!isMissingSession) {
            pushError({
              source: 'supabase.auth.getUser()',
              code: errCode,
              httpStatus: error.status ?? null,
              message: error.message,
              stack,
            });
          }
        } else {
          getUserReport = {
            ok: true,
            statusLabel: 'UTENTE VERIFICATO',
            message: `Utente autenticato: ${data.user?.email || data.user?.id}`,
            rawSummary: JSON.stringify({
              id: data.user?.id ?? null,
              email: data.user?.email ?? null,
              role: data.user?.role ?? null,
              error: null,
            }),
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = compactStack(err);
        getUserReport = {
          ok: false,
          statusLabel: 'ECCEZIONE',
          code: 'GET_USER_EXCEPTION',
          message: msg,
          rawSummary: msg,
          stack,
        };
        pushError({
          source: 'supabase.auth.getUser()',
          code: 'GET_USER_EXCEPTION',
          message: msg,
          stack,
        });
      }

      // 4. Query di test verso il database: from('centers').select('id').limit(1)
      try {
        const { data, error: dbErr, status, statusText } = await client
          .from('centers')
          .select('id')
          .limit(1);
        if (!dbErr) {
          dbReachable = true;
          dbQueryReport = {
            ok: true,
            statusLabel: `OK (HTTP ${status || 200})`,
            httpStatus: status || 200,
            message: `Query SELECT su public.centers riuscita (${Array.isArray(data) ? data.length : 0} record letti nel test).`,
            rawSummary: JSON.stringify({ status: status || 200, statusText, rowsReturned: Array.isArray(data) ? data.length : 0, error: null }),
          };
        } else {
          const stack = compactStack(dbErr);
          const errCode = dbErr.code || `HTTP_${status || 'ERR'}`;
          dbQueryReport = {
            ok: false,
            statusLabel: `ERRORE HTTP ${status || 'ERR'} (${errCode})`,
            httpStatus: status || null,
            code: errCode,
            message: dbErr.message || statusText || 'Errore query PostgREST senza messaggio',
            hint: dbErr.hint || null,
            details: dbErr.details || null,
            rawSummary: JSON.stringify({
              status,
              statusText,
              code: dbErr.code ?? null,
              message: dbErr.message ?? null,
              hint: dbErr.hint ?? null,
              details: dbErr.details ?? null,
            }),
            stack,
          };
          pushError({
            source: 'Database Query (public.centers)',
            code: errCode,
            httpStatus: status || null,
            message: dbErr.message || statusText || 'Errore query PostgREST',
            hint: dbErr.hint || null,
            details: dbErr.details || null,
            stack,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = compactStack(err);
        dbQueryReport = {
          ok: false,
          statusLabel: 'ECCEZIONE RETE / QUERY',
          code: 'DB_QUERY_EXCEPTION',
          message: msg,
          rawSummary: msg,
          stack,
        };
        pushError({
          source: 'Database Query (public.centers)',
          code: 'DB_QUERY_EXCEPTION',
          message: msg,
          stack,
        });
      }

      // 5. Verifica secondaria RPC check_admin_status per confermare raggiungibilità PostgREST
      try {
        const { data: rpcData, error: rpcErr, status: rpcStatus } = await client.rpc(
          'check_admin_status',
          { target_email: 'andrea.graziano90@hotmail.it' }
        );
        if (!rpcErr) {
          rpcHealthReport = {
            ok: true,
            statusLabel: `OK (HTTP ${rpcStatus || 200})`,
            httpStatus: rpcStatus || 200,
            message: 'RPC check_admin_status raggiungibile ed eseguita correttamente su PostgreSQL.',
            rawSummary: JSON.stringify(rpcData),
          };
        } else {
          rpcHealthReport = {
            ok: false,
            statusLabel: `ERRORE (${rpcErr.code || rpcStatus || 'RPC_ERR'})`,
            httpStatus: rpcStatus || null,
            code: rpcErr.code || null,
            message: rpcErr.message,
            hint: rpcErr.hint || null,
            details: rpcErr.details || null,
            rawSummary: JSON.stringify(rpcErr),
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        rpcHealthReport = {
          ok: false,
          statusLabel: 'ECCEZIONE RPC',
          code: 'RPC_EXCEPTION',
          message: msg,
          rawSummary: msg,
          stack: compactStack(err),
        };
      }
    }
  }

  const connected = clientInitialized && authReachable && dbReachable;

  let failureDiagnosis: string | null = null;
  if (!connected) {
    if (!inspection.urlLoaded || !inspection.keyLoaded) {
      failureDiagnosis =
        'Variabili ambiente mancanti o non valide nella build Vite (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).';
    } else if (!clientInitialized) {
      failureDiagnosis = `Inizializzazione createClient() fallita: ${clientInitMessage}`;
    } else if (!isOnline) {
      failureDiagnosis = 'Dispositivo offline: nessuna connessione di rete attiva.';
    } else if (!authReachable && !dbReachable) {
      failureDiagnosis = `Impossibile raggiungere Supabase (${corsAndNetworkCheck.message}).`;
    } else if (
      authReachable &&
      !dbReachable &&
      dbQueryReport.code === '42501'
    ) {
      failureDiagnosis =
        'Le credenziali (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY), il client SDK, i CORS e Supabase Auth funzionano, ma PostgreSQL blocca la lettura della tabella public.centers per il ruolo anon (codice 42501: permission denied for table centers). Esegui i GRANT SELECT in Supabase SQL Editor.';
    } else if (
      authReachable &&
      !dbReachable &&
      dbQueryReport.code === 'PGRST205'
    ) {
      failureDiagnosis =
        'Supabase Auth risponde, ma la tabella public.centers non esiste nello schema cache di PostgREST (PGRST205). Esegui la migrazione SQL 001_init_smistamento_pt.sql.';
    } else {
      failureDiagnosis = errors[0] || 'Connessione Supabase incompleta.';
    }
  }

  const urlFormatMessage = inspection.urlLoaded
    ? `Valido (${SUPABASE_URL})`
    : inspection.urlError || 'URL mancante o non valido';

  const keyFormatMessage = keyInspection.valid
    ? `Valido (${keyInspection.keyType}, ${keyInspection.length} caratteri)`
    : keyInspection.reason;

  return {
    environment: envInfo.environment,
    hostname: envInfo.hostname,
    origin: envInfo.origin,
    isOnline,
    supabaseUrlUsed: SUPABASE_URL || '(non impostato)',
    keyVarName: 'VITE_SUPABASE_ANON_KEY',
    keyPreview: maskKeyPreview(SUPABASE_ANON_KEY),
    urlLoaded: inspection.urlLoaded,
    urlFormatValid: inspection.urlLoaded,
    urlFormatMessage,
    keyLoaded: inspection.keyLoaded,
    keyFormatValid: keyInspection.valid,
    keyFormatMessage,
    sdkImportValid,
    clientInitialized,
    clientInitMessage,
    clientInitStack: lastClientInitStack,
    corsAndNetworkCheck,
    authReachable,
    getSessionReport,
    getUserReport,
    dbQueryReport,
    rpcHealthReport,
    dbReachable,
    connected,
    failureDiagnosis,
    configInspection: inspection,
    errorDetails,
    errors,
    checkedAt: Date.now(),
  };
}
