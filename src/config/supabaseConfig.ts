/**
 * Configurazione Supabase frontend.
 * Sicurezza: utilizza ESCLUSIVAMENTE import.meta.env.VITE_SUPABASE_URL e
 * import.meta.env.VITE_SUPABASE_ANON_KEY.
 * Non utilizzare MAI SUPABASE_SERVICE_ROLE_KEY nel frontend.
 */

declare const __SUPABASE_BUILD_META__:
  | {
      urlSource: string;
      keySource: string;
      buildMode: string;
      builtAt: string;
    }
  | undefined;

function normalizeValue(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\/+$/, '');
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export type KeyInspectionResult =
  | { valid: true; keyType: 'sb_publishable' | 'jwt_anon' | 'custom_anon'; length: number }
  | { valid: false; reason: string; length: number };

export function inspectPublishableKey(key: string): KeyInspectionResult {
  const trimmed = key.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) {
    return {
      valid: false,
      length: 0,
      reason:
        'Variabile VITE_SUPABASE_ANON_KEY assente o vuota nella build.',
    };
  }

  if (trimmed.startsWith('sb_secret_')) {
    return {
      valid: false,
      length: trimmed.length,
      reason:
        'Chiave segreta (sb_secret_*) bloccata nel frontend per sicurezza: utilizzare esclusivamente VITE_SUPABASE_ANON_KEY.',
    };
  }

  if (trimmed.length < 20) {
    return {
      valid: false,
      length: trimmed.length,
      reason: `VITE_SUPABASE_ANON_KEY incompleta o troppo corta (${trimmed.length} caratteri). Verifica il valore completo della chiave anon.`,
    };
  }

  if (trimmed.startsWith('eyJ')) {
    const parts = trimmed.split('.');
    if (parts.length !== 3) {
      return {
        valid: false,
        length: trimmed.length,
        reason:
          'VITE_SUPABASE_ANON_KEY JWT malformata (numero segmenti JWT diverso da 3). Verifica di non aver troncato la chiave.',
      };
    }
    try {
      const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payloadJson = JSON.parse(atob(payloadB64)) as { role?: string };
      if (payloadJson?.role === 'service_role') {
        return {
          valid: false,
          length: trimmed.length,
          reason:
            'SUPABASE_SERVICE_ROLE_KEY (role=service_role) rilevata e bloccata nel frontend: utilizzare esclusivamente VITE_SUPABASE_ANON_KEY.',
        };
      }
      return { valid: true, keyType: 'jwt_anon', length: trimmed.length };
    } catch {
      return {
        valid: false,
        length: trimmed.length,
        reason:
          'Payload JWT di VITE_SUPABASE_ANON_KEY non decodificabile (possibile carattere non valido o chiave troncata).',
      };
    }
  }

  if (trimmed.startsWith('sb_publishable_')) {
    return { valid: true, keyType: 'sb_publishable', length: trimmed.length };
  }

  return { valid: true, keyType: 'custom_anon', length: trimmed.length };
}

export function isPublishableKeySafe(key: string): boolean {
  return inspectPublishableKey(key).valid;
}

export const SUPABASE_URL: string = normalizeValue(
  typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_SUPABASE_URL : ''
);

export const SUPABASE_ANON_KEY: string = String(
  typeof import.meta.env !== 'undefined'
    ? import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    : ''
)
  .trim()
  .replace(/^["']|["']$/g, '');

export function getSupabaseBuildMeta(): {
  urlSource: string;
  keySource: string;
  buildMode: string;
  builtAt: string;
} {
  if (typeof __SUPABASE_BUILD_META__ !== 'undefined') {
    return __SUPABASE_BUILD_META__;
  }

  return {
    urlSource: SUPABASE_URL ? 'VITE_SUPABASE_URL' : 'none',
    keySource: SUPABASE_ANON_KEY ? 'VITE_SUPABASE_ANON_KEY' : 'none',
    buildMode: 'runtime',
    builtAt: '',
  };
}

export interface SupabaseConfigInspection {
  urlLoaded: boolean;
  keyLoaded: boolean;
  urlHost: string | null;
  urlError: string | null;
  keyError: string | null;
  keyType: string | null;
  keyLength: number;
  buildMeta: ReturnType<typeof getSupabaseBuildMeta>;
  ready: boolean;
}

export function inspectSupabaseConfig(): SupabaseConfigInspection {
  const buildMeta = getSupabaseBuildMeta();

  let urlLoaded = false;
  let urlHost: string | null = null;
  let urlError: string | null = null;

  if (!SUPABASE_URL) {
    urlError = 'Variabile VITE_SUPABASE_URL mancante o vuota nella build.';
  } else if (!isValidHttpUrl(SUPABASE_URL)) {
    urlError = `VITE_SUPABASE_URL non valido ("${SUPABASE_URL}"): deve iniziare con https:// (es. https://xxxx.supabase.co).`;
  } else {
    urlLoaded = true;
    try {
      urlHost = new URL(SUPABASE_URL).host;
    } catch {
      urlHost = null;
    }
  }

  const keyInspection = inspectPublishableKey(SUPABASE_ANON_KEY);
  const keyLoaded = keyInspection.valid;
  const keyError = keyInspection.valid ? null : keyInspection.reason;
  const keyType = keyInspection.valid ? keyInspection.keyType : null;

  return {
    urlLoaded,
    keyLoaded,
    urlHost,
    urlError,
    keyError,
    keyType,
    keyLength: keyInspection.length,
    buildMeta,
    ready: urlLoaded && keyLoaded,
  };
}

export function hasCentralizedSupabaseConfig(): boolean {
  return inspectSupabaseConfig().ready;
}
