import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CornerDownLeft,
  History,
  Mic,
  MicOff,
  Search,
  ShieldAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { buildCenterIndex, searchAddressInIndex } from '../engine/searchEngine';
import { formatReliableZoneSpeech, useVoiceSorting } from '../hooks/useVoiceSorting';
import type {
  AddressRecord,
  DeliveryCenter,
  ReliabilityTier,
  SearchOutput,
  SortingHistoryItem,
} from '../types/sorting';

interface OperationalModeScreenProps {
  center: DeliveryCenter;
  addresses: AddressRecord[];
  onBack: () => void;
}

function getTierStyles(tier: ReliabilityTier) {
  if (tier === 'high') {
    return {
      card: 'bg-emerald-600 text-white border-emerald-400/50',
      subText: 'text-emerald-100',
      badge: 'bg-emerald-900/35 text-white border border-white/25',
      altBtn: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
      divider: 'border-white/20',
      icon: CheckCircle2,
    };
  }
  if (tier === 'medium') {
    return {
      card: 'bg-[#FFD100] text-[#002677] border-[#EBC000]',
      subText: 'text-[#002677]/80',
      badge: 'bg-[#002677] text-[#FFD100] border border-[#002677]',
      altBtn: 'bg-[#002677]/12 hover:bg-[#002677]/20 text-[#002677] border border-[#002677]/15',
      divider: 'border-[#002677]/15',
      icon: AlertTriangle,
    };
  }
  return {
    card: 'bg-red-600 text-white border-red-400/50',
    subText: 'text-red-100',
    badge: 'bg-red-950/45 text-white border border-white/30',
    altBtn: 'bg-white/15 hover:bg-white/25 text-white border border-white/25',
    divider: 'border-white/25',
    icon: ShieldAlert,
  };
}

export function OperationalModeScreen({
  center,
  addresses,
  onBack,
}: OperationalModeScreenProps) {
  const [manualQuery, setManualQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [searchResult, setSearchResult] = useState<SearchOutput | null>(null);
  const [history, setHistory] = useState<SortingHistoryItem[]>([]);

  const searchIndex = useMemo(
    () => buildCenterIndex(center.id, addresses),
    [center.id, addresses]
  );

  const speakRef = { current: (_z: string, _s: string, _c: number) => {} };

  const executeLookup = useCallback(
    (queryText: string, shouldSpeak: boolean, speechConfidence?: number) => {
      const cleaned = queryText.trim();
      if (!cleaned) return;
      setLastQuery(cleaned);

      // Ricerca eseguita esclusivamente sul database locale IndexedDB
      const output = searchAddressInIndex(searchIndex, cleaned, { speechConfidence });
      setSearchResult(output);

      if (output.best) {
        const best = output.best;
        setHistory((prev) => {
          const item: SortingHistoryItem = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            query: cleaned,
            code: best.code,
            comune: best.record.comune,
            indirizzo: `${best.record.tipoStrada} ${best.record.nomeStrada}${best.record.civicoRaw ? ' ' + best.record.civicoRaw : ''}`,
            confidence: best.confidence,
            reliabilityTier: best.reliabilityTier,
          };
          return [item, ...prev.slice(0, 5)];
        });

        if (shouldSpeak) {
          speakRef.current(best.record.zona, best.record.subzona, best.confidence);
        }
      }
    },
    [searchIndex]
  );

  const voice = useVoiceSorting({
    onTranscriptQuery: (transcript, isFinal, speechConfidence) => {
      if (isFinal) {
        executeLookup(transcript, true, speechConfidence);
      }
    },
  });

  speakRef.current = voice.speakZoneCode;

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    executeLookup(manualQuery, true, 1);
  };

  const bestMatch = searchResult?.best ?? null;
  const tierStyles = bestMatch ? getTierStyles(bestMatch.reliabilityTier) : null;
  const TierIcon = tierStyles?.icon ?? CheckCircle2;

  return (
    <div className="min-h-[100dvh] bg-[#001D5C] text-white flex flex-col">
      {/* Compact Sticky Top Bar */}
      <header className="sticky top-0 z-30 bg-[#002677]/95 backdrop-blur-md border-b border-white/10 pt-safe">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => {
                voice.stopListening();
                onBack();
              }}
              aria-label="Esci da modalità operativa"
              className="min-h-[44px] min-w-[44px] -ml-1 rounded-xl flex items-center justify-center hover:bg-white/10 active:scale-95 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-extrabold truncate text-[#FFD100]">
                {center.name} · v{center.localVersion ?? center.version}
              </p>
              <p className="text-[11px] text-blue-200 truncate tabular-nums">
                {addresses.length.toLocaleString('it-IT')} indirizzi locali ·{' '}
                {voice.isListening ? 'Microfono attivo' : 'In attesa'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => voice.setVoiceMuted((m) => !m)}
            aria-label={voice.voiceMuted ? 'Riattiva sintesi vocale' : 'Silenzia sintesi vocale'}
            className="min-h-[44px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
          >
            {voice.voiceMuted ? (
              <>
                <VolumeX className="w-4 h-4 text-red-300" />
                <span className="hidden sm:inline">Voce Off</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 text-[#FFD100]" />
                <span className="hidden sm:inline">Voce On</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main High-Contrast Sorting Display */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 pt-4 pb-operative flex flex-col justify-between gap-4">
        {/* Stato Ascolto + Ultimo Indirizzo Riconosciuto */}
        <section className="rounded-2xl bg-white/8 border border-white/12 px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold uppercase tracking-wider text-blue-200">
              {voice.isSpeaking
                ? 'Pronuncia risultato...'
                : voice.isListening
                  ? 'Ascolto continuo attivo — leggi un indirizzo'
                  : 'Premi il microfono per iniziare lo smistamento'}
            </span>
            {searchResult && (
              <span className="font-mono text-[11px] text-blue-200/80 tabular-nums shrink-0">
                {searchResult.elapsedMs.toFixed(1)} ms
              </span>
            )}
          </div>

          <p className="mt-1.5 text-sm sm:text-base font-semibold text-white min-h-[1.5rem] truncate">
            {voice.interimText ? (
              <span className="text-[#FFD100]">{voice.interimText}</span>
            ) : lastQuery ? (
              <span>“{lastQuery}”</span>
            ) : (
              <span className="text-blue-200/60">
                Esempio: “Sant’Angelo Lodigiano Via Alcide De Gasperi 10”
              </span>
            )}
          </p>

          {voice.micError && (
            <p className="mt-2 text-xs font-semibold text-amber-300">
              {voice.micError}
            </p>
          )}
        </section>

        {/* HUGE RELIABILITY-COLORED FULL-DISPLAY RESULT CARD */}
        {bestMatch && tierStyles ? (
          <section
            className={`flex-1 flex flex-col items-center justify-center rounded-3xl border-2 p-5 sm:p-8 shadow-2xl min-h-[220px] sm:min-h-[280px] text-center transition-colors ${tierStyles.card}`}
          >
            {/* Stato Affidabilità & Percentuale */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 mb-2">
              <span
                className={`px-3 py-1 rounded-xl text-xs sm:text-sm font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 ${tierStyles.badge}`}
              >
                <TierIcon className="w-4 h-4" />
                <span>{bestMatch.reliabilityLabel}</span>
              </span>
              <span className="font-mono text-lg sm:text-xl font-black tabular-nums">
                {bestMatch.confidence}%
              </span>
            </div>

            <button
              type="button"
              onClick={() =>
                voice.speakZoneCode(
                  bestMatch.record.zona,
                  bestMatch.record.subzona,
                  bestMatch.confidence
                )
              }
              title="Tocca per riascoltare"
              className="my-1 font-mono font-black tracking-tight leading-none text-[6rem] sm:text-[8.5rem] md:text-[10rem] tabular-nums select-none active:scale-95 transition-transform"
            >
              {bestMatch.code}
            </button>

            <div className="space-y-1 max-w-xl">
              <p className="text-base sm:text-xl font-extrabold">
                {bestMatch.record.tipoStrada} {bestMatch.record.nomeStrada}
                {bestMatch.record.civicoRaw ? ` ${bestMatch.record.civicoRaw}` : ''}
              </p>
              <p className={`text-xs sm:text-sm font-bold ${tierStyles.subText}`}>
                {bestMatch.record.comune}
                {bestMatch.record.frazione ? ` · ${bestMatch.record.frazione}` : ''}
                {bestMatch.record.note ? ` · ${bestMatch.record.note}` : ''}
              </p>
              <p className={`pt-1 text-xs font-semibold ${tierStyles.subText}`}>
                Voce: “
                {formatReliableZoneSpeech(
                  bestMatch.record.zona,
                  bestMatch.record.subzona,
                  bestMatch.confidence
                )}
                ”
              </p>
            </div>

            {/* Quando affidabilità < 80% mostra sempre le 3 migliori alternative */}
            {searchResult &&
              searchResult.alternatives.length > 0 &&
              (bestMatch.confidence < 80 || bestMatch.reliabilityTier !== 'high') && (
                <div
                  className={`mt-5 pt-4 border-t ${tierStyles.divider} w-full max-w-xl`}
                >
                  <p className={`text-[11px] font-extrabold uppercase tracking-wider mb-2 ${tierStyles.subText}`}>
                    {bestMatch.confidence < 80
                      ? '3 migliori alternative trovate:'
                      : 'Altre corrispondenze possibili:'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {searchResult.alternatives.slice(0, 3).map((alt) => (
                      <button
                        key={alt.record.id}
                        type="button"
                        onClick={() => {
                          setSearchResult({
                            ...searchResult,
                            best: alt,
                          });
                          voice.speakZoneCode(
                            alt.record.zona,
                            alt.record.subzona,
                            alt.confidence
                          );
                        }}
                        className={`min-h-[48px] px-3 py-2 rounded-xl text-left transition-colors ${tierStyles.altBtn}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-black text-base tabular-nums">
                            {alt.code}
                          </span>
                          <span className="font-mono text-xs font-extrabold tabular-nums">
                            {alt.confidence}%
                          </span>
                        </div>
                        <p className="text-[11px] font-bold truncate mt-0.5">
                          {alt.record.nomeStrada}
                        </p>
                        <p className="text-[10px] opacity-80 truncate">
                          {alt.record.comune}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </section>
        ) : searchResult ? (
          <section className="flex-1 flex flex-col items-center justify-center rounded-3xl bg-red-600 text-white border-2 border-red-400/50 p-6 sm:p-8 shadow-2xl min-h-[220px] sm:min-h-[280px] text-center">
            <div className="max-w-md space-y-2">
              <p className="font-mono text-5xl sm:text-6xl font-black opacity-80">
                —
              </p>
              <p className="text-lg font-extrabold">
                Indirizzo non trovato nell’archivio locale
              </p>
              <p className="text-xs sm:text-sm font-medium text-red-100">
                Prova a ripetere specificando prima il Comune e poi il nome della via (es. “Sant’Angelo Via De Gasperi”).
              </p>
            </div>
          </section>
        ) : (
          <section className="flex-1 flex flex-col items-center justify-center rounded-3xl bg-[#FFD100] text-[#002677] p-6 sm:p-8 shadow-2xl min-h-[220px] sm:min-h-[280px] text-center">
            <div className="max-w-md space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-[#002677]/10 flex items-center justify-center mx-auto">
                <Mic className="w-8 h-8 text-[#002677]" />
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-[#002677]">
                Pronto per lo smistamento offline
              </p>
              <p className="text-xs sm:text-sm font-semibold text-[#002677]/80">
                Attiva il microfono continuo qui sotto e leggi ad alta voce l’indirizzo dalla corrispondenza. Tutte le ricerche avvengono sul database locale.
              </p>
            </div>
          </section>
        )}

        {/* Recent History Strip */}
        {history.length > 0 && (
          <section className="flex items-center gap-2 overflow-x-auto pb-1">
            <History className="w-4 h-4 text-blue-200/70 shrink-0" />
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => executeLookup(item.query, true, 1)}
                className="min-h-[40px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-left shrink-0 flex items-center gap-2"
              >
                <span
                  className={`font-mono font-extrabold text-sm tabular-nums ${
                    item.reliabilityTier === 'high'
                      ? 'text-emerald-300'
                      : item.reliabilityTier === 'medium'
                        ? 'text-[#FFD100]'
                        : 'text-red-300'
                  }`}
                >
                  {item.code} ({item.confidence}%)
                </span>
                <span className="text-xs text-blue-100 truncate max-w-[150px]">
                  {item.indirizzo}
                </span>
              </button>
            ))}
          </section>
        )}

        {/* Ergonomic Bottom Thumb-Zone Controls */}
        <section className="space-y-3">
          <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-blue-200/70 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="Oppure digita indirizzo (es. Sant'Angelo Via De Gasperi 10)"
                className="w-full min-h-[48px] pl-10 pr-3 rounded-2xl bg-white/10 border border-white/15 text-sm text-white placeholder:text-blue-200/60 focus:outline-none focus:border-[#FFD100]"
              />
            </div>
            <button
              type="submit"
              aria-label="Cerca indirizzo"
              className="min-h-[48px] min-w-[48px] px-4 rounded-2xl bg-white/15 hover:bg-white/25 text-white font-bold text-sm inline-flex items-center justify-center gap-1.5 shrink-0"
            >
              <CornerDownLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Cerca</span>
            </button>
          </form>

          <button
            type="button"
            onClick={voice.toggleListening}
            className={`w-full min-h-[64px] rounded-2xl font-extrabold text-base sm:text-lg flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl ${
              voice.isListening
                ? 'bg-red-600 hover:bg-red-700 text-white ring-4 ring-red-400/35'
                : 'bg-[#FFD100] hover:bg-[#EBC000] text-[#002677]'
            }`}
          >
            {voice.isListening ? (
              <>
                <span className="relative flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-white" />
                </span>
                <MicOff className="w-6 h-6" />
                <span>Microfono Continuo Attivo · Tocca per Fermare</span>
              </>
            ) : (
              <>
                <Mic className="w-6 h-6" />
                <span>
                  {voice.isSupported
                    ? 'Attiva Microfono Continuo'
                    : 'Microfono non supportato su questo browser'}
                </span>
              </>
            )}
          </button>
        </section>
      </main>
    </div>
  );
}
