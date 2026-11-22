import {
  Building2,
  CheckCircle2,
  Clock,
  CloudDownload,
  Database,
  Layers,
  Loader2,
  MapPin,
  Mic,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react';
import type {
  AdminSession,
  CenterSyncStatus,
  DeliveryCenter,
} from '../types/sorting';

export interface HomeCenterItem {
  center: DeliveryCenter; // stato combinato (cloud se disponibile, o locale offline)
  cloudVersion: number | null;
  localVersion: number | null;
  syncStatus: CenterSyncStatus;
  hasLocalArchive: boolean;
}

interface HomeScreenProps {
  items: HomeCenterItem[];
  loading: boolean;
  isOnline: boolean;
  adminSession: AdminSession | null;
  syncingCenterIds: Set<string>;
  onOpenAdmin: () => void;
  onRefreshCloud: () => Promise<void>;
  onSyncCenter: (centerId: string) => Promise<void>;
  onUpdateCenter: (centerId: string) => Promise<void>;
  onRemoveLocalCenter: (centerId: string) => Promise<void>;
  onStartVoiceCenter: (centerId: string) => void;
  onInspectLocalArchive: (centerId: string) => void;
}

function formatDateTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderStatusLabel(status: CenterSyncStatus) {
  switch (status) {
    case 'synced':
      return {
        label: 'Sincronizzato',
        className: 'text-emerald-700 bg-emerald-50 border-emerald-200',
        icon: CheckCircle2,
      };
    case 'update_available':
      return {
        label: 'Aggiornamento disponibile',
        className: 'text-amber-800 bg-amber-50 border-amber-300',
        icon: RefreshCw,
      };
    case 'syncing':
      return {
        label: 'Sincronizzazione in corso',
        className: 'text-[#003399] bg-blue-50 border-blue-200',
        icon: Loader2,
      };
    default:
      return {
        label: 'Non sincronizzato',
        className: 'text-slate-600 bg-slate-100 border-slate-200',
        icon: CloudDownload,
      };
  }
}

export function HomeScreen({
  items,
  loading,
  isOnline,
  adminSession,
  syncingCenterIds,
  onOpenAdmin,
  onRefreshCloud,
  onSyncCenter,
  onUpdateCenter,
  onRemoveLocalCenter,
  onStartVoiceCenter,
  onInspectLocalArchive,
}: HomeScreenProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Bar Poste Italiane con pulsante [ADMIN] in alto a destra */}
      <header className="sticky top-0 z-30 bg-[#003399] text-white border-b-4 border-[#FFD100] pt-safe">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#FFD100] text-[#002677] flex items-center justify-center font-mono font-extrabold text-sm shrink-0">
              PT
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight truncate uppercase">
                SMISTAMENTO SEMIAUTOMATICO PT
              </h1>
              <p className="text-[11px] text-[#FFD100] font-semibold truncate">
                {isOnline
                  ? 'Sincronizzazione Selettiva · Offline-First'
                  : 'Modalità Offline · Database Locale Attivo'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAdmin}
            className="min-h-[44px] px-3.5 sm:px-4 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-xs sm:text-sm inline-flex items-center gap-1.5 shrink-0 transition-colors active:scale-[0.98]"
          >
            <Shield className="w-4 h-4 stroke-[2.5]" />
            <span>{adminSession ? 'PANNELLO ADMIN' : 'ADMIN'}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0A1628] tracking-tight">
              Centri di Recapito disponibili
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Sincronizza solo i Centri che ti servono sul dispositivo per lavorare anche senza connessione Internet.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void onRefreshCloud()}
            disabled={!isOnline || loading}
            className="min-h-[44px] px-4 rounded-xl border border-[#003399]/25 bg-white hover:bg-[#003399]/5 text-[#003399] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Verifica aggiornamenti</span>
          </button>
        </div>

        {loading && items.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-56 bg-white rounded-2xl border border-slate-200 animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 text-center max-w-2xl mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-[#FFD100]/25 text-[#003399] flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-extrabold text-[#0A1628]">
              Nessun Centro di Recapito pubblicato sul server
            </h3>
            <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
              Un amministratore deve accedere tramite il pulsante <strong>ADMIN</strong> in alto a destra per creare i Centri e caricare i Libretti Gita in PDF.
            </p>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="mt-6 min-h-[48px] px-5 rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm inline-flex items-center justify-center gap-2"
            >
              <Shield className="w-4 h-4" />
              <span>Accedi come Amministratore</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => {
              const { center, cloudVersion, localVersion, syncStatus, hasLocalArchive } = item;
              const isBusy = syncingCenterIds.has(center.id);
              const effectiveStatus: CenterSyncStatus = isBusy ? 'syncing' : syncStatus;
              const badge = renderStatusLabel(effectiveStatus);
              const BadgeIcon = badge.icon;

              return (
                <article
                  key={center.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between overflow-hidden"
                >
                  <div className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-lg font-extrabold text-[#003399] truncate">
                          {center.name}
                        </h3>
                        {center.notes && (
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                            {center.notes}
                          </p>
                        )}
                      </div>
                      <span className="font-mono text-xs font-extrabold text-[#002677] bg-[#FFD100]/45 px-2.5 py-1 rounded-lg shrink-0 tabular-nums">
                        v{cloudVersion ?? localVersion ?? center.version}
                      </span>
                    </div>

                    {/* Stato Sincronizzazione */}
                    <div
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 ${badge.className}`}
                    >
                      <BadgeIcon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          effectiveStatus === 'syncing' ? 'animate-spin' : ''
                        }`}
                      />
                      <span>{badge.label}</span>
                      {localVersion !== null &&
                        cloudVersion !== null &&
                        localVersion < cloudVersion && (
                          <span className="font-mono text-[11px] opacity-85 tabular-nums">
                            (locale v{localVersion} → v{cloudVersion})
                          </span>
                        )}
                    </div>

                    {/* Metriche Centro */}
                    <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-700 tabular-nums">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <Layers className="w-3.5 h-3.5 text-[#003399]" />
                        <span>{center.zones.length} zone</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-semibold">
                        <MapPin className="w-3.5 h-3.5 text-[#003399]" />
                        <span>{center.addressCount.toLocaleString('it-IT')} indirizzi</span>
                      </div>
                      <div className="col-span-2 flex items-center gap-1.5 text-slate-500">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          Agg.: {formatDateTime(center.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Azioni Selettive Dispositivo & Avvio Operativo */}
                  <div className="p-3.5 bg-slate-50 border-t border-slate-100 space-y-2">
                    {hasLocalArchive && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onStartVoiceCenter(center.id)}
                          disabled={center.addressCount === 0}
                          className="flex-1 min-h-[46px] px-3 rounded-xl bg-[#003399] hover:bg-[#002677] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                        >
                          <Mic className="w-4 h-4" />
                          <span>Modalità Operativa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onInspectLocalArchive(center.id)}
                          aria-label={`Archivio locale ${center.name}`}
                          className="min-h-[46px] px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          <Database className="w-4 h-4" />
                          <span>Archivio</span>
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {!hasLocalArchive ? (
                        <button
                          type="button"
                          disabled={!isOnline || isBusy}
                          onClick={() => void onSyncCenter(center.id)}
                          className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] disabled:opacity-50 text-[#002677] text-xs font-extrabold inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <CloudDownload className="w-4 h-4" />
                          <span>{isBusy ? 'SINCRONIZZAZIONE...' : 'SINCRONIZZA'}</span>
                        </button>
                      ) : (
                        <>
                          {effectiveStatus === 'update_available' && (
                            <button
                              type="button"
                              disabled={!isOnline || isBusy}
                              onClick={() => void onUpdateCenter(center.id)}
                              className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] disabled:opacity-50 text-[#002677] text-xs font-extrabold inline-flex items-center justify-center gap-1.5"
                            >
                              <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
                              <span>{isBusy ? 'AGGIORNAMENTO...' : 'AGGIORNA'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void onRemoveLocalCenter(center.id)}
                            className="flex-1 min-h-[44px] px-3 rounded-xl bg-white border border-slate-200 hover:border-red-300 hover:text-red-600 text-slate-600 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>RIMUOVI DAL DISPOSITIVO</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
