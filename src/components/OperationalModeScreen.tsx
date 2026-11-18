import {
  ArrowLeft,
  CheckCircle2,
  CornerDownLeft,
  History,
  Mic,
  MicOff,
  Search,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { buildCenterIndex, searchAddressInIndex } from '../engine/searchEngine';
import { formatSpokenZonePhrase, useVoiceSorting } from '../hooks/useVoiceSorting';
import type {
  AddressRecord,
  DeliveryCenter,
  SearchOutput,
  SortingHistoryItem,
} from '../types/sorting';

interface OperationalModeScreenProps {
  center: DeliveryCenter;
  addresses: AddressRecord[];
  onBack: () => void;
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

  // Ref-safe wrapper perché useVoiceSorting invoca onTranscriptQuery dentro i listener Web Speech
  const speakRef = { current: (_z: string, _s: string) => {} };

  const executeLookup = useCallback(
    (queryText: string, shouldSpeak: boolean) => {
      const cleaned = queryText.trim();
      if (!cleaned) return;
      setLastQuery(cleaned);

      const output = searchAddressInIndex(searchIndex, cleaned);
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
          };
          return [item, ...prev.slice(0, 5)];
        });

        if (shouldSpeak) {
          speakRef.current(best.record.zona, best.record.subzona);
        }
      }
    },
    [searchIndex]
  );

  const voice = useVoiceSorting({
    onTranscriptQuery: (transcript, isFinal) => {
      if (isFinal) {
        executeLookup(transcript, true);
      }
    },
  });

  speakRef.current = voice.speakZoneCode;

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    executeLookup(manualQuery, true);
  };

  const bestMatch = searchResult?.best ?? null;

  return (
    <div className="min-h-screen bg-[#001D5C] text-white flex flex-col">
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
                {center.name}
              </p>
              <p className="text-[11px] text-blue-200 truncate tabular-nums">
                {addresses.length.toLocaleString('it-IT')} indirizzi ·{' '}
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
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-4 flex flex-col justify-between gap-4 pb-safe">
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

        {/* HUGE FULL-DISPLAY RESULT CARD */}
        <section className="flex-1 flex flex-col items-center justify-center rounded-3xl bg-[#FFD100] text-[#002677] p-6 sm:p-8 shadow-2xl min-h-[260px] sm:min-h-[320px] text-center">
          {bestMatch ? (
            <>
              <p className="text-xs sm:text-sm font-extrabold uppercase tracking-[0.18em] text-[#002677]/75">
                Zona di Recapito
              </p>

              <button
                type="button"
                onClick={() =>
                  voice.speakZoneCode(bestMatch.record.zona, bestMatch.record.subzona)
                }
                title="Tocca per riascoltare"
                className="my-2 font-mono font-black tracking-tight leading-none text-[6.5rem] sm:text-[9rem] md:text-[10.5rem] tabular-nums select-none active:scale-95 transition-transform"
              >
                {bestMatch.code}
              </button>

              <div className="space-y-1 max-w-xl">
                <p className="text-base sm:text-xl font-extrabold text-[#001D5C]">
                  {bestMatch.record.tipoStrada} {bestMatch.record.nomeStrada}
                  {bestMatch.record.civicoRaw ? ` ${bestMatch.record.civicoRaw}` : ''}
                </p>
                <p className="text-xs sm:text-sm font-bold text-[#002677]/80">
                  {bestMatch.record.comune}
                  {bestMatch.record.frazione ? ` · ${bestMatch.record.frazione}` : ''}
                  {bestMatch.record.note ? ` · ${bestMatch.record.note}` : ''}
                </p>
                <p className="pt-1 text-xs font-semibold text-[#002677]/70 inline-flex items-center gap-1.5 justify-center">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    Pronunciato: “{formatSpokenZonePhrase(bestMatch.record.zona, bestMatch.record.subzona)}” · Affidabilità {bestMatch.confidence}%
                  </span>
                </p>
              </div>

              {searchResult && searchResult.alternatives.length > 0 && (
                <div className="mt-5 pt-3 border-t border-[#002677]/15 w-full max-w-xl flex flex-wrap items-center justify-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#002677]/70">
                    Alternative:
                  </span>
                  {searchResult.alternatives.slice(0, 3).map((alt) => (
                    <button
                      key={alt.record.id}
                      type="button"
                      onClick={() => {
                        setSearchResult({
                          ...searchResult,
                          best: alt,
                        });
                        voice.speakZoneCode(alt.record.zona, alt.record.subzona);
                      }}
                      className="min-h-[36px] px-2.5 rounded-lg bg-[#002677]/10 hover:bg-[#002677]/20 text-xs font-bold text-[#002677] tabular-nums"
                    >
                      <span className="font-mono font-extrabold mr-1">{alt.code}</span>
                      {alt.record.nomeStrada} ({alt.record.comune})
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : searchResult ? (
            <div className="max-w-md space-y-2">
              <p className="font-mono text-5xl sm:text-6xl font-black text-[#002677]/40">
                —
              </p>
              <p className="text-lg font-extrabold text-[#002677]">
                Indirizzo non trovato nell’archivio
              </p>
              <p className="text-xs sm:text-sm font-medium text-[#002677]/80">
                Prova a ripetere specificando prima il Comune e poi il nome della via (es. “Sant’Angelo Via De Gasperi”).
              </p>
            </div>
          ) : (
            <div className="max-w-md space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-[#002677]/10 flex items-center justify-center mx-auto">
                <Mic className="w-8 h-8 text-[#002677]" />
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-[#002677]">
                Pronto per lo smistamento
              </p>
              <p className="text-xs sm:text-sm font-semibold text-[#002677]/80">
                Attiva il microfono continuo qui sotto e leggi ad alta voce l’indirizzo dalla corrispondenza. Il risultato apparirà istantaneamente.
              </p>
            </div>
          )}
        </section>

        {/* Recent History Strip */}
        {history.length > 0 && (
          <section className="flex items-center gap-2 overflow-x-auto pb-1">
            <History className="w-4 h-4 text-blue-200/70 shrink-0" />
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => executeLookup(item.query, true)}
                className="min-h-[40px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-left shrink-0 flex items-center gap-2"
              >
                <span className="font-mono font-extrabold text-sm text-[#FFD100] tabular-nums">
                  {item.code}
                </span>
                <span className="text-xs text-blue-100 truncate max-w-[160px]">
                  {item.indirizzo}
                </span>
              </button>
            ))}
          </section>
        )}

        {/* Ergonomic Bottom Thumb-Zone Controls: Manual Fallback + Continuous Mic */}
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
