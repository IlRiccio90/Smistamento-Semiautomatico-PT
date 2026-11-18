import {
  Building2,
  ChevronRight,
  Download,
  FileText,
  FolderPlus,
  Loader2,
  MapPin,
  Mic,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { DeliveryCenter, ExtractionProgress } from '../types/sorting';

interface HomeScreenProps {
  centers: DeliveryCenter[];
  loading: boolean;
  installButtonSlot?: React.ReactNode;
  sampleProgress: ExtractionProgress | null;
  onSelectCenter: (centerId: string) => void;
  onStartVoiceCenter: (centerId: string) => void;
  onCreateCenter: (name: string, notes: string) => Promise<void>;
  onDeleteCenter: (centerId: string) => Promise<void>;
  onImportSampleCenter: () => Promise<void>;
}

export function HomeScreen({
  centers,
  loading,
  sampleProgress,
  onSelectCenter,
  onStartVoiceCenter,
  onCreateCenter,
  onDeleteCenter,
  onImportSampleCenter,
}: HomeScreenProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [centerName, setCenterName] = useState('');
  const [centerNotes, setCenterNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!centerName.trim() || creating) return;
    setCreating(true);
    try {
      await onCreateCenter(centerName, centerNotes);
      setCenterName('');
      setCenterNotes('');
      setShowCreateModal(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky Top Brand Header (<= 15% viewport height) */}
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
                Centri di Recapito · Archivio Locale
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="min-h-[44px] px-3.5 sm:px-4 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-sm inline-flex items-center gap-1.5 shrink-0 transition-colors active:scale-[0.98]"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Nuovo Centro</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 pb-24">
        {/* Progress card during sample import */}
        {sampleProgress && (
          <div className="mb-6 bg-white rounded-2xl border border-[#003399]/20 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Loader2 className="w-5 h-5 text-[#003399] animate-spin shrink-0" />
                <p className="text-sm font-bold text-[#003399] truncate">
                  Indicizzazione {sampleProgress.fileName}
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-slate-600 tabular-nums shrink-0">
                {sampleProgress.totalPages > 0
                  ? `${sampleProgress.currentPage}/${sampleProgress.totalPages} pag.`
                  : 'Avvio...'}
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#003399] transition-all duration-150"
                style={{
                  width:
                    sampleProgress.totalPages > 0
                      ? `${Math.min(100, Math.round((sampleProgress.currentPage / sampleProgress.totalPages) * 100))}%`
                      : '15%',
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {sampleProgress.message}
            </p>
          </div>
        )}

        {/* Section Intro & Real Sample Quick-Import Action */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#0A1628] tracking-tight">
              Centri di Recapito
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Seleziona un centro per gestire i Libretti Gita in PDF o avviare lo smistamento vocale continuo.
            </p>
          </div>

          <button
            type="button"
            disabled={Boolean(sampleProgress)}
            onClick={onImportSampleCenter}
            className="min-h-[44px] px-4 rounded-xl border border-[#003399]/25 bg-white hover:bg-[#003399]/5 text-[#003399] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Importa Libretti Reali (Zona 1 e 2)</span>
          </button>
        </div>

        {/* Centers Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 bg-white rounded-2xl border border-slate-200 animate-pulse" />
            ))}
          </div>
        ) : centers.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-10 text-center max-w-2xl mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-[#FFD100]/25 text-[#003399] flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-extrabold text-[#0A1628]">
              Nessun Centro di Recapito configurato
            </h3>
            <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
              Crea un centro (es. Lodi, Codogno, Cremona, Milano Centro) e carica i Libretti Gita in PDF, oppure importa subito i libretti reali Zona 1 e Zona 2 inclusi.
            </p>
            <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="min-h-[48px] px-5 rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm inline-flex items-center justify-center gap-2"
              >
                <FolderPlus className="w-4 h-4" />
                Crea Nuovo Centro
              </button>
              <button
                type="button"
                disabled={Boolean(sampleProgress)}
                onClick={onImportSampleCenter}
                className="min-h-[48px] px-5 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Carica Zona 1 & 2 Reali
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {centers.map((center) => (
              <article
                key={center.id}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:border-[#003399]/40 transition-colors flex flex-col justify-between overflow-hidden"
              >
                <div
                  onClick={() => onSelectCenter(center.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectCenter(center.id);
                    }
                  }}
                  className="p-5 cursor-pointer flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-lg font-extrabold text-[#003399] truncate">
                        {center.name}
                      </h3>
                      {center.notes && (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                          {center.notes}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                  </div>

                  {/* Unboxed crisp metadata row */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-700 tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-[#003399]" />
                      {center.pdfCount} {center.pdfCount === 1 ? 'PDF' : 'PDF'}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#003399]" />
                      {center.addressCount.toLocaleString('it-IT')} indirizzi
                    </span>
                    {center.zones.length > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono text-[#002677]">
                          Zone {center.zones.join(', ')}
                        </span>
                      </>
                    )}
                  </div>

                  {center.comuni.length > 0 && (
                    <p className="mt-2 text-xs text-slate-500 truncate">
                      Comuni: {center.comuni.join(', ')}
                    </p>
                  )}
                </div>

                <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onStartVoiceCenter(center.id)}
                    disabled={center.addressCount === 0}
                    className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#003399] hover:bg-[#002677] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                  >
                    <Mic className="w-4 h-4" />
                    <span>Smistamento Vocale</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectCenter(center.id)}
                    className="min-h-[44px] px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold"
                  >
                    Libretti
                  </button>
                  <button
                    type="button"
                    aria-label={`Elimina centro ${center.name}`}
                    onClick={() => setConfirmDeleteId(center.id)}
                    className="min-h-[44px] min-w-[44px] rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Bottom mobile quick action CTA when centers exist */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-20 p-3 bg-gradient-to-t from-[#F5F7FB] via-[#F5F7FB] to-transparent pb-safe">
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="w-full min-h-[48px] rounded-xl bg-[#003399] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#003399]/20 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Nuovo Centro di Recapito</span>
        </button>
      </div>

      {/* Create Center Modal / Bottom Sheet */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 shadow-2xl pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-extrabold text-[#003399]">
                Nuovo Centro di Recapito
              </h2>
              <button
                type="button"
                aria-label="Chiudi"
                onClick={() => setShowCreateModal(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="center-name"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Nome del Centro *
                </label>
                <input
                  id="center-name"
                  type="text"
                  required
                  autoFocus
                  value={centerName}
                  onChange={(e) => setCenterName(e.target.value)}
                  placeholder="Es. Lodi, Codogno, Cremona, Milano Centro..."
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 bg-white text-sm font-medium text-[#0A1628] focus:outline-none focus:border-[#003399] focus:ring-2 focus:ring-[#003399]/15"
                />
              </div>

              <div>
                <label
                  htmlFor="center-notes"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Note operative (opzionale)
                </label>
                <textarea
                  id="center-notes"
                  rows={3}
                  value={centerNotes}
                  onChange={(e) => setCenterNotes(e.target.value)}
                  placeholder="Es. Frazionario 38687, aree extraurbane, turni mattina..."
                  className="w-full p-3.5 rounded-xl border border-slate-300 bg-white text-sm text-[#0A1628] focus:outline-none focus:border-[#003399] focus:ring-2 focus:ring-[#003399]/15"
                />
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 min-h-[48px] rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={!centerName.trim() || creating}
                  className="flex-1 min-h-[48px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm disabled:opacity-50"
                >
                  {creating ? 'Salvataggio...' : 'Crea Centro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-extrabold text-[#0A1628]">
              Eliminare questo centro?
            </h3>
            <p className="text-sm text-slate-600 mt-2">
              Verranno rimossi definitivamente tutti i libretti PDF caricati e il relativo archivio indicizzato.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 text-slate-700 font-bold text-sm"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = confirmDeleteId;
                  setConfirmDeleteId(null);
                  await onDeleteCenter(id);
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
