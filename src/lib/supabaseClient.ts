import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  hasCentralizedSupabaseConfig,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '../config/supabaseConfig';

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return hasCentralizedSupabaseConfig();
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!hasCentralizedSupabaseConfig()) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return cachedClient;
}
