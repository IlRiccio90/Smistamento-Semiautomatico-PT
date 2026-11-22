import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseClientConfigured = Boolean(
  supabaseUrl && supabaseUrl.trim() && supabaseAnonKey && supabaseAnonKey.trim()
);

export const supabase: SupabaseClient | null = isSupabaseClientConfigured
  ? createClient(supabaseUrl!.trim(), supabaseAnonKey!.trim(), {
      auth: {
        persistSession: false, // Sessioni admin gestite in memoria per massima sicurezza
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
