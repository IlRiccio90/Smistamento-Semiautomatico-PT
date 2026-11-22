import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => unknown) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => unknown) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

const ITALIAN_ZONE_NUMBERS: Record<string, string> = {
  '0': 'zero',
  '1': 'uno',
  '2': 'due',
  '3': 'tre',
  '4': 'quattro',
  '5': 'cinque',
  '6': 'sei',
  '7': 'sette',
  '8': 'otto',
  '9': 'nove',
  '10': 'dieci',
  '11': 'undici',
  '12': 'dodici',
  '13': 'tredici',
  '14': 'quattordici',
  '15': 'quindici',
  '16': 'sedici',
  '17': 'diciassette',
  '18': 'diciotto',
  '19': 'diciannove',
  '20': 'venti',
};

export function formatSpokenZonePhrase(zona: string, subzona: string): string {
  const zClean = zona.trim();
  const zWord = ITALIAN_ZONE_NUMBERS[zClean] ?? zClean;
  const subClean = subzona.trim().toUpperCase();
  return `Zona ${zWord} ${subClean}`.trim();
}

export function formatReliableZoneSpeech(
  zona: string,
  subzona: string,
  confidence: number
): string {
  const zClean = zona.trim();
  const zWord = ITALIAN_ZONE_NUMBERS[zClean] ?? zClean;
  const subClean = subzona.trim().toUpperCase();
  if (confidence >= 95) {
    return `Zona ${zWord} ${subClean}`.trim();
  }
  if (confidence >= 80) {
    return `Probabile zona ${zWord} ${subClean}`.trim();
  }
  return `Attenzione. Corrispondenza incerta. Probabile zona ${zWord} ${subClean}`.trim();
}

export interface UseVoiceSortingOptions {
  onTranscriptQuery: (transcript: string, isFinal: boolean, speechConfidence?: number) => void;
}

export function useVoiceSorting({ onTranscriptQuery }: UseVoiceSortingOptions) {
  const [isSupported] = useState<boolean>(() => Boolean(getSpeechRecognitionCtor()));
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [lastFinalText, setLastFinalText] = useState('');
  const [micError, setMicError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListeningRef = useRef(false);
  const suppressUntilRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const interimFallbackTimerRef = useRef<number | null>(null);
  const onQueryRef = useRef(onTranscriptQuery);
  const italianVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    onQueryRef.current = onTranscriptQuery;
  }, [onTranscriptQuery]);

  // Seleziona la migliore voce italiana disponibile sul dispositivo
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const itVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('it'));
      italianVoiceRef.current =
        itVoices.find((v) => v.localService) ?? itVoices[0] ?? null;
    };
    pickVoice();
    window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', pickVoice);
    };
  }, []);

  const speakPhrase = useCallback(
    (phrase: string) => {
      if (voiceMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = 'it-IT';
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        if (italianVoiceRef.current) {
          utterance.voice = italianVoiceRef.current;
        }
        utterance.onstart = () => {
          setIsSpeaking(true);
          suppressUntilRef.current = Date.now() + 3400;
        };
        utterance.onend = () => {
          setIsSpeaking(false);
          suppressUntilRef.current = Date.now() + 450;
        };
        utterance.onerror = () => {
          setIsSpeaking(false);
          suppressUntilRef.current = Date.now() + 250;
        };
        window.speechSynthesis.speak(utterance);
      } catch {
        setIsSpeaking(false);
      }
    },
    [voiceMuted]
  );

  const speakZoneCode = useCallback(
    (zona: string, subzona: string, confidence = 100) => {
      speakPhrase(formatReliableZoneSpeech(zona, subzona, confidence));
    },
    [speakPhrase]
  );

  const clearTimers = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (interimFallbackTimerRef.current !== null) {
      window.clearTimeout(interimFallbackTimerRef.current);
      interimFallbackTimerRef.current = null;
    }
  }, []);

  const startRecognitionInstance = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setMicError('Riconoscimento vocale non supportato da questo browser. Usa Android Chrome o inserisci l’indirizzo manualmente.');
      wantListeningRef.current = false;
      setIsListening(false);
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }

      const rec = new Ctor();
      rec.lang = 'it-IT';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 2;

      rec.onstart = () => {
        setMicError(null);
        setIsListening(true);
      };

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        // Evita auto-ascolto durante la pronuncia vocale di risposta
        if (Date.now() < suppressUntilRef.current) {
          return;
        }

        let interimAccum = '';
        let finalAccum = '';
        let confidenceSum = 0;
        let confidenceCount = 0;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const alt = res[0];
          const text = alt?.transcript?.trim() ?? '';
          if (!text) continue;

          // Filtra eventuale eco della sintesi vocale
          if (/^(?:attenzione\.\s+corrispondenza\s+incerta\.\s+)?(?:probabile\s+)?zona\s+(?:uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|\d+)\s+[a-z]$/i.test(text)) {
            continue;
          }

          if (typeof alt?.confidence === 'number' && alt.confidence > 0) {
            confidenceSum += alt.confidence;
            confidenceCount++;
          }

          if (res.isFinal) {
            finalAccum += (finalAccum ? ' ' : '') + text;
          } else {
            interimAccum += (interimAccum ? ' ' : '') + text;
          }
        }

        const avgSpeechConf =
          confidenceCount > 0 ? confidenceSum / confidenceCount : undefined;

        if (interimAccum) {
          setInterimText(interimAccum);
          if (interimFallbackTimerRef.current !== null) {
            window.clearTimeout(interimFallbackTimerRef.current);
          }
          const snapshot = interimAccum;
          interimFallbackTimerRef.current = window.setTimeout(() => {
            if (Date.now() >= suppressUntilRef.current && snapshot.length >= 4) {
              setLastFinalText(snapshot);
              setInterimText('');
              onQueryRef.current(snapshot, true, avgSpeechConf);
            }
          }, 950);
        }

        if (finalAccum) {
          if (interimFallbackTimerRef.current !== null) {
            window.clearTimeout(interimFallbackTimerRef.current);
            interimFallbackTimerRef.current = null;
          }
          setInterimText('');
          setLastFinalText(finalAccum);
          onQueryRef.current(finalAccum, true, avgSpeechConf);
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setMicError('Permesso microfono negato. Consenti l’accesso al microfono dalle impostazioni del browser.');
          wantListeningRef.current = false;
          setIsListening(false);
          return;
        }
        if (event.error === 'audio-capture') {
          setMicError('Nessun microfono rilevato sul dispositivo.');
          wantListeningRef.current = false;
          setIsListening(false);
          return;
        }
        // 'no-speech' e 'aborted' sono normali durante l'ascolto continuo -> riavvio automatico
      };

      rec.onend = () => {
        if (wantListeningRef.current) {
          restartTimerRef.current = window.setTimeout(() => {
            if (wantListeningRef.current) {
              startRecognitionInstance();
            }
          }, 180);
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      if (wantListeningRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          if (wantListeningRef.current) startRecognitionInstance();
        }, 500);
      }
    }
  }, []);

  const startListening = useCallback(() => {
    clearTimers();
    setMicError(null);
    wantListeningRef.current = true;
    startRecognitionInstance();
  }, [clearTimers, startRecognitionInstance]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    clearTimers();
    setInterimText('');
    setIsListening(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, [clearTimers]);

  const toggleListening = useCallback(() => {
    if (wantListeningRef.current || isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearTimers();
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [clearTimers]);

  return {
    isSupported,
    isListening,
    isSpeaking,
    voiceMuted,
    setVoiceMuted,
    interimText,
    lastFinalText,
    micError,
    startListening,
    stopListening,
    toggleListening,
    speakZoneCode,
    speakPhrase,
  };
}
