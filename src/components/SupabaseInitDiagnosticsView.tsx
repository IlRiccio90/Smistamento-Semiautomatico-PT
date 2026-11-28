import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Globe,
  KeyRound,
  RefreshCw,
  ServerCrash,
  ShieldCheck,
  Wifi,
  XCircle,
} from 'lucide-react';
import type {
  DiagnosticCallReport,
  SupabaseConnectionDiagnostics,
} from '../lib/supabaseClient';

interface SupabaseInitDiagnosticsViewProps {
  diagnostics: SupabaseConnectionDiagnostics | null;
  loading: boolean;
  onRefresh: () => Promise<void> | void;
  onBackHome: () => void;
}

function StatusBadge({ ok, labelOk = 'SI', labelFail = 'NO' }: { ok: boolean; labelOk?: string; labelFail?: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-extrabold text-xs sm:text-sm shrink-0">
      <CheckCircle2 className="w-4 h-4 shrink-0" />
      <span>{labelOk}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 font-extrabold text-xs sm:text-sm shrink-0">
      <XCircle className="w-4 h-4 shrink-0" />
      <span>{labelFail}</span>
    </span>
  );
}

function CallReportCard({
  title,
  report,
  neutralOk = false,
}: {
  title: string;
  report: DiagnosticCallReport;
  neutralOk?: boolean;
}) {
  const borderClass = report.ok
    ? neutralOk
      ? 'border-slate-200 bg-slate-50/70'
      : 'border-emerald-200 bg-emerald-50/40'
    : 'border-red-200 bg-red-50/50';

  return (
    <div className={`rounded-2xl border p-4 space-y-2 ${borderClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs sm:text-sm font-extrabold text-[#0A1628]">{title}</p>
        <span
          className={`text-[11px] font-mono font-extrabold px-2.5 py-1 rounded-lg border ${
            report.ok
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-100 text-red-800 border-red-300'
          }`}
        >
          {report.statusLabel}
        </span>
      </div>

      <p className="text-xs font-semibold text-slate-800 break-words">
        {report.message}
      </p>

      {(report.code || report.httpStatus || report.hint || report.details) && (
        <div className="text-[11px] font-mono bg-white border border-slate-200 rounded-xl p-2.5 space-y-1 text-slate-700 break-words">
          {report.code && (
            <p>
              <strong>Codice errore:</strong> {report.code}
              {report.httpStatus ? ` · HTTP ${report.httpStatus}` : ''}
            </p>
          )}
          {report.hint && (
            <p className="text-amber-900">
              <strong>Hint Supabase:</strong> {report.hint}
            </p>
          )}
          {report.details && (
            <p>
              <strong>Dettagli:</strong> {report.details}
            </p>
          )}
        </div>
      )}

      <details className="text-[11px] text-slate-600">
        <summary className="cursor-pointer font-bold hover:text-[#003399]">
          Risposta tecnica completa
        </summary>
        <pre className="mt-1.5 rounded-xl bg-slate-900 text-slate-100 p-3 overflow-x-auto text-[11px] whitespace-pre-wrap break-all">
          {report.rawSummary}
          {report.stack ? `\n\nStack essenziale:\n${report.stack}` : ''}
        </pre>
      </details>
    </div>
  );
}

export function SupabaseInitDiagnosticsView({
  diagnostics,
  loading,
  onRefresh,
  onBackHome,
}: SupabaseInitDiagnosticsViewProps) {
  const buildMeta = diagnostics?.configInspection.buildMeta;

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FB]">
      <header className="sticky top-0 z-30 bg-[#002677] text-white border-b-4 border-[#FFD100] pt-safe">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackHome}
              aria-label="Torna alla Home"
              className="min-h-[44px] min-w-[44px] -ml-1 rounded-xl flex items-center justify-center hover:bg-white/10 shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#FFD100] shrink-0" />
                <h1 className="text-sm sm:text-base font-extrabold tracking-tight truncate uppercase">
                  Diagnostica Inizializzazione Supabase
                </h1>
              </div>
              <p className="text-[11px] text-blue-200 truncate">
                Analisi completa SDK, Auth, Database, CORS e Variabili Ambiente
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void onRefresh()}
            className="min-h-[42px] px-3.5 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-xs inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Riesegui Test</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 pt-6 pb-operative space-y-5">
        {!diagnostics ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-sm font-bold text-slate-600">
            Esecuzione diagnostica Supabase in corso...
          </div>
        ) : (
          <>
            {/* Motivo preciso se connessione fallita */}
            {!diagnostics.connected && diagnostics.failureDiagnosis && (
              <section
                role="alert"
                className="bg-red-50 rounded-3xl border-2 border-red-300 p-5 sm:p-6 space-y-3"
              >
                <div className="flex items-start gap-2.5 text-red-900">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-red-700 mt-0.5" />
                  <div className="space-y-1">
                    <h2 className="text-sm sm:text-base font-extrabold">
                      Motivo preciso mancata connessione Supabase
                    </h2>
                    <p className="text-xs sm:text-sm font-semibold text-red-900 break-words">
                      {diagnostics.failureDiagnosis}
                    </p>
                  </div>
                </div>

                {diagnostics.dbQueryReport.code === '42501' && (
                  <div className="rounded-2xl bg-slate-900 text-slate-100 p-3.5 text-[11px] font-mono space-y-1.5">
                    <p className="text-[#FFD100] font-bold">
                      SQL da eseguire in Supabase SQL Editor per abilitare la lettura pubblica dei Centri:
                    </p>
                    <pre className="whitespace-pre-wrap break-all select-all">
{`grant usage on schema public to anon, authenticated;
grant select on public.centers, public.center_pdfs, public.center_addresses to anon, authenticated;
grant insert, update, delete on public.centers, public.center_pdfs, public.center_addresses to authenticated;
grant select, insert, update on public.admin_profiles to authenticated;
grant insert on public.activity_logs to anon, authenticated;
grant select on public.activity_logs to authenticated;
grant select, insert, update, delete on public.center_backups to authenticated;`}
                    </pre>
                  </div>
                )}
              </section>
            )}

            {/* Riepilogo stato generale & Ambiente */}
            <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-[#003399] text-[#FFD100] flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Ambiente
                    </p>
                    <p className="text-lg font-extrabold text-[#003399]">
                      {diagnostics.environment}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-slate-600 font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 break-all">
                  Host: {diagnostics.hostname || 'sconosciuto'} ·{' '}
                  {diagnostics.isOnline ? 'Rete Online' : 'Rete Offline'}
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                <div className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-[#0A1628]">
                      Supabase URL caricato
                    </p>
                    <p className="text-xs text-slate-700 mt-0.5 font-mono break-all">
                      URL utilizzato: <strong>{diagnostics.supabaseUrlUsed}</strong>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                      Origine: {buildMeta?.urlSource || 'none'} · Formato:{' '}
                      {diagnostics.urlFormatMessage}
                    </p>
                  </div>
                  <StatusBadge ok={diagnostics.urlLoaded} />
                </div>

                <div className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-[#0A1628]">
                      Supabase Key caricata
                    </p>
                    <p className="text-xs text-slate-700 mt-0.5 font-mono break-all">
                      Nome chiave utilizzata: <strong>{diagnostics.keyVarName}</strong> ·{' '}
                      {diagnostics.keyPreview}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                      Origine: {buildMeta?.keySource || 'none'} · Formato:{' '}
                      {diagnostics.keyFormatMessage}
                    </p>
                  </div>
                  <StatusBadge ok={diagnostics.keyLoaded} />
                </div>

                <div className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-[#0A1628]">
                      Inizializzazione client (@supabase/supabase-js createClient)
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5 break-words">
                      Import SDK: {diagnostics.sdkImportValid ? 'Valido' : 'Mancante'} ·{' '}
                      {diagnostics.clientInitMessage}
                    </p>
                  </div>
                  <StatusBadge ok={diagnostics.clientInitialized} />
                </div>

                <div className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-[#0A1628]">
                      Connessione Supabase
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Rete/CORS: {diagnostics.corsAndNetworkCheck.ok ? 'OK' : 'Errore'} · Auth:{' '}
                      {diagnostics.authReachable ? 'OK' : 'Non raggiungibile'} · Query DB:{' '}
                      {diagnostics.dbReachable ? 'OK' : 'Fallita'}
                    </p>
                  </div>
                  <StatusBadge ok={diagnostics.connected} />
                </div>
              </div>
            </section>

            {/* Verifiche tecniche live: Rete/CORS, getSession, getUser, Query DB */}
            <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 text-[#003399]">
                <Database className="w-5 h-5 shrink-0" />
                <h2 className="text-base font-extrabold">
                  Risposte reali SDK Supabase, Auth, CORS e Query Database
                </h2>
              </div>

              <div className="space-y-3">
                <CallReportCard
                  title="1. Rete / Blocchi CORS & Endpoint Auth (/auth/v1/settings)"
                  report={diagnostics.corsAndNetworkCheck}
                />
                <CallReportCard
                  title="2. Risposta supabase.auth.getSession()"
                  report={diagnostics.getSessionReport}
                  neutralOk
                />
                <CallReportCard
                  title="3. Risposta supabase.auth.getUser()"
                  report={diagnostics.getUserReport}
                  neutralOk
                />
                <CallReportCard
                  title="4. Query di test Database (from('centers').select('id').limit(1))"
                  report={diagnostics.dbQueryReport}
                />
                {diagnostics.rpcHealthReport && (
                  <CallReportCard
                    title="5. Verifica secondaria RPC PostgreSQL (check_admin_status)"
                    report={diagnostics.rpcHealthReport}
                  />
                )}
              </div>
            </section>

            {/* Elenco completo errori con codice, messaggio e stack essenziale */}
            {diagnostics.errorDetails.length > 0 ? (
              <section
                role="alert"
                className="bg-red-50 rounded-3xl border-2 border-red-200 p-5 sm:p-6 space-y-3"
              >
                <div className="flex items-center gap-2.5 text-red-800">
                  <ServerCrash className="w-5 h-5 shrink-0" />
                  <h2 className="text-base font-extrabold">
                    Dettaglio errori restituiti da Supabase ({diagnostics.errorDetails.length})
                  </h2>
                </div>
                <ul className="space-y-3">
                  {diagnostics.errorDetails.map((errItem, idx) => (
                    <li
                      key={`${idx}-${errItem.code}-${errItem.source}`}
                      className="rounded-2xl bg-white border border-red-200 p-4 text-xs text-red-950 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-extrabold text-[#0A1628]">
                          #{idx + 1} · {errItem.source}
                        </span>
                        <span className="font-mono font-bold px-2 py-0.5 rounded bg-red-100 text-red-800">
                          {errItem.code}
                          {errItem.httpStatus ? ` (HTTP ${errItem.httpStatus})` : ''}
                        </span>
                      </div>
                      <p className="font-semibold text-red-900 break-words">
                        <strong>Messaggio:</strong> {errItem.message}
                      </p>
                      {errItem.hint && (
                        <p className="font-mono text-[11px] text-amber-900 break-words">
                          <strong>Hint:</strong> {errItem.hint}
                        </p>
                      )}
                      {errItem.details && (
                        <p className="font-mono text-[11px] text-slate-700 break-words">
                          <strong>Dettagli:</strong> {errItem.details}
                        </p>
                      )}
                      {errItem.stack && (
                        <pre className="mt-1.5 rounded-xl bg-slate-900 text-slate-100 p-2.5 overflow-x-auto text-[11px] whitespace-pre-wrap break-all">
                          {errItem.stack}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <section className="bg-emerald-50 rounded-3xl border border-emerald-200 p-5 flex items-center gap-3 text-emerald-900">
                <ShieldCheck className="w-6 h-6 text-emerald-700 shrink-0" />
                <div>
                  <h2 className="text-sm font-extrabold">
                    Inizializzazione e connessione Supabase completamente operative
                  </h2>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    URL, Publishable Key, createClient(), CORS, Auth e Database PostgreSQL hanno risposto correttamente in{' '}
                    <strong>{diagnostics.environment}</strong>.
                  </p>
                </div>
              </section>
            )}

            {/* Riepilogo configurazione verificata */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 text-xs text-slate-600 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#003399] shrink-0" />
                <span>
                  Solo chiave pubblica: <strong>{diagnostics.keyVarName}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-[#003399] shrink-0" />
                <span>
                  Build Vite: <strong>{buildMeta?.buildMode || 'production'}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#003399] shrink-0" />
                <span>
                  Ultimo controllo:{' '}
                  <strong>{new Date(diagnostics.checkedAt).toLocaleTimeString('it-IT')}</strong>
                </span>
              </div>
            </section>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onBackHome}
                className="w-full min-h-[48px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm"
              >
                Torna alla Home
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
