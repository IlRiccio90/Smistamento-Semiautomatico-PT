/**
 * Configurazione centralizzata Supabase distribuita automaticamente con l'app.
 * Sicurezza: utilizza ESCLUSIVAMENTE Project URL e Publishable Key (Anon Key).
 * Non inserire MAI la Service Role Key (o chiavi sb_secret_*) nel codice frontend.
 */

const EMBEDDED_SUPABASE_URL = '';
const EMBEDDED_SUPABASE_ANON_KEY = '';

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isPublishableKeySafe(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed.length < 20) return false;

  // Blocca esplicitamente chiavi segrete Supabase
  if (trimmed.startsWith('sb_secret_')) {
    return false;
  }

  // Se JWT (eyJ...), verifica che il claim role non sia service_role
  if (trimmed.startsWith('eyJ') && trimmed.split('.').length === 3) {
    try {
      const payloadB64 = trimmed.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payloadJson = JSON.parse(atob(payloadB64)) as { role?: string };
      if (payloadJson?.role === 'service_role') {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export const SUPABASE_URL: string = normalizeUrl(
  EMBEDDED_SUPABASE_URL || String(import.meta.env.VITE_SUPABASE_URL || '')
);

export const SUPABASE_ANON_KEY: string = (
  EMBEDDED_SUPABASE_ANON_KEY || String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
).trim();

export function hasCentralizedSupabaseConfig(): boolean {
  return Boolean(
    SUPABASE_URL &&
      isValidHttpUrl(SUPABASE_URL) &&
      SUPABASE_ANON_KEY &&
      isPublishableKeySafe(SUPABASE_ANON_KEY)
  );
}
