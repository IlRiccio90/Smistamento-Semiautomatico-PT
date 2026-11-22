import {
  ArrowLeft,
  CheckCircle2,
  Database,
  FileText,
  Mic,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildCenterIndex, searchAddressInIndex } from '../engine/searchEngine';
import type {
  AddressRecord,
  DeliveryCenter,
  PdfDocumentRecord,
} from '../types/sorting';

interface CenterDetailScreenProps {
  center: DeliveryCenter;
  pdfs: PdfDocumentRecord[];
  addresses: AddressRecord[];
  onBack: () => void;
  onStartOperational: () => void;
}

const METHOD_LABELS: Record<PdfDocumentRecord['extractionMethod'], string> = {
  native: 'Testo PDF',
  ocr: 'OCR Locale',
  hybrid: 'Ibrido PDF+OCR',
  ai: 'OCR Avanzato',
};

export function CenterDetailScreen({
  center,
  pdfs,
  addresses,
  onBack,
  onStartOperational,
}: CenterDetailScreenProps) {
  const [activeTab, setActiveTab] = useState<'archivio' | 'libretti'>('archivio');
  const [searchFilter, setSearchFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState<string>('ALL');
  const [comuneFilter, setComuneFilter] = useState<string>('ALL');
  const [displayLimit, setDisplayLimit] = useState(80);

  const searchIndex = useMemo(
    () => buildCenterIndex(center.id, addresses),
    [center.id, addresses]
  );

  const filteredAddresses = useMemo(() => {
    const q = searchFilter.trim();
    if (q.length >= 2) {
      const res = searchAddressInIndex(searchIndex, q);
      const list: AddressRecord[] = [];
      if (res.best) list.push(res.best.record);
      for (const alt of res.alternatives) list.push(alt.record);
      const qUpper = q.toUpperCase();
      const seen = new Set(list.map((r) => r.id));
      for (const r of addresses) {
        if (list.length >= 120) break;
        if (seen.has(r.id)) continue;
        if (
          r.rawAddress.toUpperCase().includes(qUpper) ||
          r.comune.toUpperCase().includes(qUpper) ||
          r.note.toUpperCase().includes(qUpper)
        ) {
          list.push(r);
          seen.add(r.id);
        }
      }
      return list.filter((r) => {
        if (zoneFilter !== 'ALL' && `${r.zona}${r.subzona}` !== zoneFilter) return false;
        if (comuneFilter !== 'ALL' && r.comune !== comuneFilter) return false;
        return true;
      });
    }

    return addresses.filter((r) => {
      if (zoneFilter !== 'ALL' && `${r.zona}${r.subzona}` !== zoneFilter) return false;
      if (comuneFilter !== 'ALL' && r.comune !== comuneFilter) return false;
      return true;
    });
  }, [addresses, comuneFilter, searchFilter, searchIndex, zoneFilter]);

  const zoneSubzoneOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of addresses) {
      set.add(`${a.zona}${a.subzona}`);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
  }, [addresses]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Compact Sticky Top Bar */}
      <header className="sticky top-0 z-30 bg-[#003399] text-white border-b-4 border-[#FFD100] pt-safe">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onBack}
              aria-label="Torna ai centri"
              className="min-h-[44px] min-w-[44px] -ml-1 rounded-xl flex items-center justify-center hover:bg-white/10 active:scale-95 transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-extrabold truncate">
                {center.name}
              </h1>
              <p className="text-[11px] text-[#FFD100] font-semibold truncate tabular-nums">
                Archivio Locale v{center.localVersion ?? center.version} ·{' '}
                {addresses.length.toLocaleString('it-IT')} indirizzi offline
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onStartOperational}
            disabled={addresses.length === 0}
            className="min-h-[40px] px-3.5 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] disabled:bg-white/20 disabled:text-white/50 text-[#002677] font-extrabold text-xs sm:text-sm inline-flex items-center gap-1.5 shrink-0 transition-colors active:scale-[0.98]"
          >
            <Mic className="w-4 h-4" />
            <span>Smista Ora</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-5 pb-operative">
        {/* Hero Operational Launch Card */}
        <section className="bg-[#002677] text-white rounded-3xl p-5 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#FFD100]">
              Database Offline Sincronizzato
            </p>
            <h2 className="text-lg sm:text-xl font-extrabold mt-1">
              Ricerca vocale e manuale 100% locale
            </h2>
            <p className="text-xs sm:text-sm text-blue-100/90 mt-1">
              {addresses.length > 0
                ? `Archivio locale pronto senza rete: ${addresses.length.toLocaleString('it-IT')} vie e civici su ${center.comuni.length} ${center.comuni.length === 1 ? 'comune' : 'comuni'}.`
                : 'Questo Centro non contiene ancora indirizzi sincronizzati.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onStartOperational}
            disabled={addresses.length === 0}
            className="min-h-[52px] px-6 rounded-2xl bg-[#FFD100] hover:bg-[#EBC000] disabled:bg-white/15 disabled:text-white/40 text-[#002677] font-extrabold text-sm sm:text-base inline-flex items-center justify-center gap-2 shrink-0 transition-all active:scale-[0.98]"
          >
            <Mic className="w-5 h-5" />
            <span>Avvia Smistamento</span>
          </button>
        </section>

        {/* Sub-navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 mb-6">
          <button
            type="button"
            onClick={() => setActiveTab('archivio')}
            className={`min-h-[44px] px-4 text-sm font-extrabold border-b-2 transition-colors inline-flex items-center gap-2 ${
              activeTab === 'archivio'
                ? 'border-[#003399] text-[#003399]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Database className="w-4 h-4" />
            <span className="tabular-nums">
              ARCHIVIO LOCALE ({addresses.length.toLocaleString('it-IT')})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('libretti')}
            className={`min-h-[44px] px-4 text-sm font-extrabold border-b-2 transition-colors inline-flex items-center gap-2 ${
              activeTab === 'libretti'
                ? 'border-[#003399] text-[#003399]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>ZONE SINCRONIZZATE ({pdfs.length})</span>
          </button>
        </div>

        {activeTab === 'archivio' ? (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-6 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchFilter}
                  onChange={(e) => {
                    setSearchFilter(e.target.value);
                    setDisplayLimit(80);
                  }}
                  placeholder="Cerca indirizzo, via, comune o civico..."
                  className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
              <div className="sm:col-span-3">
                <select
                  aria-label="Filtra per Comune"
                  value={comuneFilter}
                  onChange={(e) => setComuneFilter(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm bg-white focus:outline-none focus:border-[#003399]"
                >
                  <option value="ALL">Tutti i Comuni ({center.comuni.length})</option>
                  {center.comuni.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <select
                  aria-label="Filtra per Zona e Subzona"
                  value={zoneFilter}
                  onChange={(e) => setZoneFilter(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm bg-white focus:outline-none focus:border-[#003399]"
                >
                  <option value="ALL">Tutte le Zone ({zoneSubzoneOptions.length})</option>
                  {zoneSubzoneOptions.map((z) => (
                    <option key={z} value={z}>
                      Zona {z}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-xs font-semibold text-slate-500 tabular-nums px-1">
              Visualizzati {Math.min(displayLimit, filteredAddresses.length).toLocaleString('it-IT')} su{' '}
              {filteredAddresses.length.toLocaleString('it-IT')} indirizzi locali
            </div>

            {filteredAddresses.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
                Nessun indirizzo trovato con i filtri selezionati.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {filteredAddresses.slice(0, displayLimit).map((addr) => (
                    <div
                      key={addr.id}
                      className="p-3.5 sm:px-5 flex items-center justify-between gap-3 hover:bg-slate-50/80"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#0A1628] truncate">
                          {addr.tipoStrada} {addr.nomeStrada}
                          {addr.civicoRaw ? (
                            <span className="font-mono text-[#003399] ml-1.5">
                              {addr.civicoRaw}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5 truncate">
                          {addr.comune}
                          {addr.frazione ? ` (${addr.frazione})` : ''}
                          {addr.note ? ` · ${addr.note}` : ''}
                          {addr.scala ? ` · Scala ${addr.scala}` : ''}
                        </p>
                      </div>
                      <div className="font-mono font-extrabold text-base sm:text-lg px-3 py-1.5 rounded-xl bg-[#FFD100] text-[#002677] shrink-0 tabular-nums">
                        {addr.zona}
                        {addr.subzona}
                      </div>
                    </div>
                  ))}
                </div>

                {filteredAddresses.length > displayLimit && (
                  <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                    <button
                      type="button"
                      onClick={() => setDisplayLimit((prev) => prev + 100)}
                      className="min-h-[44px] px-5 rounded-xl bg-white border border-slate-300 text-sm font-bold text-[#003399] hover:bg-slate-100"
                    >
                      Mostra altri 100 indirizzi
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-600">
              Metadati dei Libretti Gita inclusi nella sincronizzazione locale (i PDF originali restano solo sul server centrale).
            </p>
            {pdfs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
                Nessun metadato di libretto presente su questo dispositivo.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pdfs.map((pdf) => (
                  <div
                    key={pdf.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3.5"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#003399] text-[#FFD100] flex flex-col items-center justify-center shrink-0 font-mono font-extrabold">
                      <span className="text-[9px] uppercase tracking-wider text-blue-200 leading-none">
                        Zona
                      </span>
                      <span className="text-lg leading-tight tabular-nums">
                        {pdf.zoneNumber}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-extrabold text-[#0A1628] truncate">
                          {pdf.fileName}
                        </p>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                        {pdf.extractedCount.toLocaleString('it-IT')} indirizzi ·{' '}
                        {pdf.pageCount} pagine · {METHOD_LABELS[pdf.extractionMethod]}
                        {pdf.frazionario ? ` · Fraz. ${pdf.frazionario}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
