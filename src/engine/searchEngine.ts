import type { AddressRecord, ScoreBreakdown, SearchMatch, SearchOutput } from '../types/sorting';
import {
  canonicalizeItalianPhonetics,
  expandHonorifics,
  isStreetTypeToken,
  normalizeBaseText,
  normalizeComune,
  normalizeSpokenNumbers,
  normalizeStreetType,
} from './normalizer';

interface ComuneCandidateInfo {
  comuneOriginal: string;
  comuneNorm: string;
  tokens: string[];
}

export interface CenterSearchIndex {
  centerId: string;
  records: AddressRecord[];
  comuni: ComuneCandidateInfo[];
  recordsByComune: Map<string, AddressRecord[]>;
}

const indexCache = new Map<string, { count: number; index: CenterSearchIndex }>();

export function invalidateCenterIndex(centerId: string) {
  indexCache.delete(centerId);
}

export function buildCenterIndex(centerId: string, records: AddressRecord[]): CenterSearchIndex {
  const cached = indexCache.get(centerId);
  if (cached && cached.count === records.length) {
    return cached.index;
  }

  const comuniMap = new Map<string, ComuneCandidateInfo>();
  const recordsByComune = new Map<string, AddressRecord[]>();

  for (const r of records) {
    if (r.comuneNorm && !comuniMap.has(r.comuneNorm)) {
      comuniMap.set(r.comuneNorm, {
        comuneOriginal: r.comune,
        comuneNorm: r.comuneNorm,
        tokens: r.comuneNorm.split(/\s+/).filter(Boolean),
      });
    }
    const list = recordsByComune.get(r.comuneNorm) ?? [];
    list.push(r);
    recordsByComune.set(r.comuneNorm, list);
  }

  const index: CenterSearchIndex = {
    centerId,
    records,
    comuni: Array.from(comuniMap.values()),
    recordsByComune,
  };

  indexCache.set(centerId, { count: records.length, index });
  return index;
}

/**
 * Distanza di Damerau-Levenshtein ottimizzata normalizzata in [0, 1].
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));

  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + cost);
      }
      dp[i][j] = val;
    }
  }

  return 1 - dp[la][lb] / maxLen;
}

/**
 * Regola CRITICA: "PRIORITA' DEL COMUNE"
 * Se le prime parole della query corrispondono a un comune presente nel database del centro,
 * vengono interpretate PRIMA come Comune (es. "Graffignana Via Sant'Angelo" => Comune=Graffignana, Via=Sant'Angelo).
 * Non si attiva all'inizio se il primo token è esplicitamente un tipo stradale ("VIA", "PIAZZA", "CORSO", ecc.).
 */
function detectComuneWithPriority(
  tokens: string[],
  comuni: ComuneCandidateInfo[]
): {
  matchedComune: ComuneCandidateInfo | null;
  remainingTokens: string[];
  matchConfidence: number;
} {
  if (tokens.length === 0 || comuni.length === 0) {
    return { matchedComune: null, remainingTokens: tokens, matchConfidence: 0 };
  }

  // Se l'operatore inizia esplicitamente con "VIA ..." o "PIAZZA ...", il primo blocco è la strada;
  // controlliamo comunque se il comune è pronunciato in coda!
  const startsWithStreetType = isStreetTypeToken(tokens[0]);

  if (!startsWithStreetType) {
    let bestLead: { comune: ComuneCandidateInfo; consumed: number; score: number } | null = null;
    const maxPrefixLen = Math.min(4, tokens.length);

    for (let len = maxPrefixLen; len >= 1; len--) {
      const sliceStr = canonicalizeItalianPhonetics(tokens.slice(0, len).join(' '));
      const sliceNoSpace = sliceStr.replace(/\s+/g, '');

      for (const c of comuni) {
        const cNoSpace = c.comuneNorm.replace(/\s+/g, '');

        // 1. Corrispondenza esatta
        if (sliceStr === c.comuneNorm || sliceNoSpace === cNoSpace) {
          return {
            matchedComune: c,
            remainingTokens: tokens.slice(len),
            matchConfidence: 1,
          };
        }

        // 2. Prefisso esatto multi-parola (es. l'utente dice "Sant'Angelo" per "SANT'ANGELO LODIGIANO",
        // oppure "Villanova" per "VILLANOVA DEL SILLARO") purché restino altri token per la via o sia l'unico input
        if (len === 1 && tokens.length > 1 && c.tokens[0] === sliceStr && sliceStr.length >= 5) {
          const score = 0.94;
          if (!bestLead || score > bestLead.score) {
            bestLead = { comune: c, consumed: len, score };
          }
        }
        if (len >= 2 && c.comuneNorm.startsWith(sliceStr + ' ')) {
          const score = 0.96;
          if (!bestLead || score > bestLead.score) {
            bestLead = { comune: c, consumed: len, score };
          }
        }

        // 3. Fuzzy match sulle prime parole (tolleranza trascrizione vocale)
        const simFull = stringSimilarity(sliceStr, c.comuneNorm);
        const simFirstToken =
          len === 1 && c.tokens.length > 0 && tokens.length > 1
            ? stringSimilarity(sliceStr, c.tokens[0]) * 0.92
            : 0;
        const sim = Math.max(simFull, simFirstToken);

        if (sim >= 0.82) {
          if (!bestLead || sim > bestLead.score || (sim === bestLead.score && len > bestLead.consumed)) {
            bestLead = { comune: c, consumed: len, score: sim };
          }
        }
      }
    }

    if (bestLead) {
      return {
        matchedComune: bestLead.comune,
        remainingTokens: tokens.slice(bestLead.consumed),
        matchConfidence: bestLead.score,
      };
    }
  }

  // Fallback: controlla se il comune è stato pronunciato alla FINE (es. "Via De Gasperi 10 Sant'Angelo Lodigiano")
  if (tokens.length >= 2) {
    let bestTrail: { comune: ComuneCandidateInfo; startIdx: number; score: number } | null = null;
    for (let len = Math.min(4, tokens.length - 1); len >= 1; len--) {
      const startIdx = tokens.length - len;
      // Non consumare un token che è un puro numero civico come comune
      if (/^\d+[A-Z]?$/.test(tokens[startIdx])) continue;

      const sliceStr = canonicalizeItalianPhonetics(tokens.slice(startIdx).join(' '));
      for (const c of comuni) {
        if (sliceStr === c.comuneNorm) {
          return {
            matchedComune: c,
            remainingTokens: tokens.slice(0, startIdx),
            matchConfidence: 1,
          };
        }
        if (len === 1 && c.tokens[0] === sliceStr && sliceStr.length >= 6) {
          const score = 0.9;
          if (!bestTrail || score > bestTrail.score) {
            bestTrail = { comune: c, startIdx, score };
          }
        }
        const sim = stringSimilarity(sliceStr, c.comuneNorm);
        if (sim >= 0.86) {
          if (!bestTrail || sim > bestTrail.score) {
            bestTrail = { comune: c, startIdx, score: sim };
          }
        }
      }
    }
    if (bestTrail) {
      return {
        matchedComune: bestTrail.comune,
        remainingTokens: tokens.slice(0, bestTrail.startIdx),
        matchConfidence: bestTrail.score,
      };
    }
  }

  return { matchedComune: null, remainingTokens: tokens, matchConfidence: 0 };
}

function extractQueryCivico(tokens: string[]): {
  streetTokens: string[];
  civico: { num: number; suffix: string } | null;
} {
  if (tokens.length === 0) return { streetTokens: [], civico: null };

  // Cerca un token civico dalla fine (evitando l'unico token se la strada fosse solo un numero)
  for (let i = tokens.length - 1; i >= 1; i--) {
    const t = tokens[i];
    const m = t.match(/^(\d{1,4})(?:\/([A-Z0-9]{1,4})|([A-Z]{1,2}))?$/);
    if (m) {
      const num = parseInt(m[1], 10);
      const suffix = (m[2] || m[3] || '').toUpperCase();
      // Controlla se l'utente ha detto "10 A" come due token separati
      let consumedNext = false;
      let finalSuffix = suffix;
      if (!finalSuffix && i + 1 < tokens.length && /^[A-Z]{1,2}$/.test(tokens[i + 1])) {
        const nextTok = tokens[i + 1];
        if (!isStreetTypeToken(nextTok)) {
          finalSuffix = nextTok;
          consumedNext = true;
        }
      }
      const nextTokens = tokens.filter((_, idx) => idx !== i && !(consumedNext && idx === i + 1));
      return {
        streetTokens: nextTokens,
        civico: { num, suffix: finalSuffix },
      };
    }
  }

  return { streetTokens: tokens, civico: null };
}

function scoreStreetTokens(queryTokens: string[], record: AddressRecord): number {
  if (queryTokens.length === 0) return 0;

  const recTokens = record.nomeTokens;
  if (recTokens.length === 0) return 0;

  const queryJoined = queryTokens.join(' ');
  const recJoined = record.nomeStradaNorm;

  if (queryJoined === recJoined) return 1.0;

  // Supporta parole concatenate ("SANTANGELO" == "SANT ANGELO" o "DEGASPERI" == "DE GASPERI")
  const qCompact = queryTokens.join('');
  const rCompact = recTokens.join('');
  if (qCompact === rCompact) return 0.99;

  // Confronto token-by-token indipendente dall'ordine (risolve "ALCIDE DE GASPERI" <-> "DE GASPERI ALCIDE")
  let matchedWeight = 0;
  let totalQueryWeight = 0;
  const usedRecIndices = new Set<number>();

  for (const qt of queryTokens) {
    // Parole più lunghe e cognomi pesano leggermente di più di articoli/preposizioni
    const w = qt.length <= 2 ? 0.5 : 1.0;
    totalQueryWeight += w;

    let bestTokSim = 0;
    let bestIdx = -1;
    for (let j = 0; j < recTokens.length; j++) {
      if (usedRecIndices.has(j)) continue;
      const rt = recTokens[j];
      if (qt === rt) {
        bestTokSim = 1;
        bestIdx = j;
        break;
      }
      // Match prefisso su cognome lungo (es. utente legge solo "Gasperi" o abbreviazione)
      if (qt.length >= 4 && rt.startsWith(qt)) {
        const pSim = 0.88;
        if (pSim > bestTokSim) {
          bestTokSim = pSim;
          bestIdx = j;
        }
      } else {
        const sim = stringSimilarity(qt, rt);
        if (sim >= 0.72 && sim > bestTokSim) {
          bestTokSim = sim;
          bestIdx = j;
        }
      }
    }

    if (bestIdx !== -1) {
      usedRecIndices.add(bestIdx);
      matchedWeight += w * bestTokSim;
    }
  }

  if (totalQueryWeight === 0) return 0;
  const queryCoverage = matchedWeight / totalQueryWeight;

  // Bonus / penalità in base a quanti token del record sono stati coperti (preferisce match completi ma permette parziali come "Via De Gasperi" -> "VIA DE GASPERI ALCIDE")
  const recCoverage = usedRecIndices.size / recTokens.length;
  const compactSim = stringSimilarity(qCompact, rCompact);

  // Se quasi tutti i token pronunciati corrispondono a token del record (anche se il record ha nome di battesimo/titolo in più)
  const combined = queryCoverage * 0.72 + recCoverage * 0.16 + compactSim * 0.12;
  return Math.min(1, combined);
}

function scoreCivico(
  queryCivico: { num: number; suffix: string } | null,
  record: AddressRecord
): { score: number; mode: ScoreBreakdown['civicoMatched'] } {
  if (!queryCivico) {
    return { score: 0, mode: 'none' };
  }

  const { num, suffix } = queryCivico;

  // 1. Corrispondenza esatta numero singolo
  if (record.civicoNum !== null && record.civicoNum === num) {
    if (suffix && record.civicoSuffix) {
      if (suffix === record.civicoSuffix) return { score: 1200, mode: 'exact' };
      return { score: 900, mode: 'exact' };
    }
    if (!suffix && !record.civicoSuffix) {
      return { score: 1200, mode: 'exact' };
    }
    return { score: 1050, mode: 'exact' };
  }

  // 2. Corrispondenza in intervallo civico + parità (es. 1-99 solo dispari / 2-120 pari)
  if (record.civicoStart !== null && record.civicoEnd !== null) {
    if (num >= record.civicoStart && num <= record.civicoEnd) {
      const isEven = num % 2 === 0;
      if (record.parity === 'even' && !isEven) {
        return { score: -200, mode: 'none' }; // Fuori parità!
      }
      if (record.parity === 'odd' && isEven) {
        return { score: -200, mode: 'none' }; // Fuori parità!
      }
      return { score: 1100, mode: 'range' };
    }
  }

  // 3. Se sulla stessa via esiste il civico vicino, piccolo punteggio di prossimità
  if (record.civicoNum !== null) {
    const diff = Math.abs(record.civicoNum - num);
    if (diff <= 4) return { score: 250 - diff * 30, mode: 'street-fallback' };
    if (diff <= 20) return { score: 100, mode: 'street-fallback' };
  }

  return { score: 40, mode: 'street-fallback' };
}

export function searchAddressInIndex(index: CenterSearchIndex, rawQuery: string): SearchOutput {
  const t0 = performance.now();
  const normalizedSpoken = normalizeSpokenNumbers(rawQuery);
  const rawTokens = normalizedSpoken.split(/\s+/).filter(Boolean);

  if (rawTokens.length === 0 || index.records.length === 0) {
    return {
      queryRaw: rawQuery,
      detectedComune: null,
      detectedTipo: null,
      detectedStreetQuery: '',
      detectedCivico: null,
      best: null,
      alternatives: [],
      elapsedMs: performance.now() - t0,
    };
  }

  // 1. PRIORITA' DEL COMUNE
  const { matchedComune, remainingTokens, matchConfidence: comuneMatchConf } = detectComuneWithPriority(
    rawTokens,
    index.comuni
  );

  // 2. Estrazione Tipo Strada + Civico dai token rimanenti
  let workTokens = [...remainingTokens];
  let detectedTipo: string | null = null;

  if (workTokens.length > 0 && isStreetTypeToken(workTokens[0])) {
    detectedTipo = normalizeStreetType(workTokens[0]);
    workTokens = workTokens.slice(1);
    // Gestisce "VIA PRIVATA" o "STRADA PROVINCIALE"
    if (
      (detectedTipo === 'VIA' && workTokens[0] === 'PRIVATA') ||
      (detectedTipo === 'STRADA' &&
        (workTokens[0] === 'PROVINCIALE' || workTokens[0] === 'STATALE' || workTokens[0] === 'COMUNALE'))
    ) {
      if (detectedTipo === 'STRADA') {
        detectedTipo = `STRADA ${workTokens[0]}`;
      }
      workTokens = workTokens.slice(1);
    }
  }

  const { streetTokens, civico: queryCivico } = extractQueryCivico(workTokens);
  const queryStreetTokens = expandHonorifics(
    canonicalizeItalianPhonetics(streetTokens.join(' ')).split(/\s+/).filter(Boolean)
  );

  // Pool candidati: se Comune rilevato con priorità, restringi prima ai record di quel Comune
  // (mantenendo comunque il fallback sull'intero centro se la via non esiste in quel comune)
  const primaryPool = matchedComune
    ? index.recordsByComune.get(matchedComune.comuneNorm) ?? index.records
    : index.records;

  const evaluatePool = (pool: AddressRecord[], comuneMatchedInPool: boolean): SearchMatch[] => {
    const results: SearchMatch[] = [];

    for (const rec of pool) {
      const streetRatio = scoreStreetTokens(queryStreetTokens, rec);
      // Scarta falsi positivi molto deboli se abbiamo una query stradale
      if (queryStreetTokens.length > 0 && streetRatio < 0.42) continue;

      // Gerarchia punteggi: 1. Comune -> 2. Nome della via -> 3. Civico -> 4. Tipo strada
      const comuneScore = comuneMatchedInPool ? Math.round(4500 * comuneMatchConf) : 0;
      const streetScore = Math.round(streetRatio * 3000);
      const { score: civicoScore, mode: civicoMatched } = scoreCivico(queryCivico, rec);
      const tipoScore =
        detectedTipo && rec.tipoStradaNorm === detectedTipo
          ? 200
          : detectedTipo && rec.tipoStradaNorm !== detectedTipo
            ? -30
            : 0;

      const totalScore = comuneScore + streetScore + civicoScore + tipoScore;

      // Confidenza normalizzata 0..100 per l'UI
      const maxPossible = (comuneMatchedInPool ? 4500 : 0) + 3000 + (queryCivico ? 1200 : 0) + (detectedTipo ? 200 : 0);
      const confidence = Math.max(
        0,
        Math.min(100, Math.round((totalScore / Math.max(1, maxPossible)) * 100))
      );

      results.push({
        record: rec,
        code: `${rec.zona}${rec.subzona}`,
        confidence,
        breakdown: {
          comuneScore,
          streetScore,
          civicoScore,
          tipoScore,
          totalScore,
          comuneMatched: comuneMatchedInPool,
          civicoMatched,
        },
      });
    }

    results.sort((a, b) => {
      if (b.breakdown.totalScore !== a.breakdown.totalScore) {
        return b.breakdown.totalScore - a.breakdown.totalScore;
      }
      return a.record.prog.localeCompare(b.record.prog, 'it', { numeric: true });
    });

    return results;
  };

  let matches = evaluatePool(primaryPool, Boolean(matchedComune));

  // Se il comune era stato rilevato ma non c'è nessun match stradale in quel comune, prova sull'intero centro
  if (matches.length === 0 && matchedComune) {
    matches = evaluatePool(index.records, false);
  }

  // Deduplica alternative mostrando codici/vie distinte rilevanti (mantenendo però sempre il best top)
  const dedupedAlternatives: SearchMatch[] = [];
  const seenKeys = new Set<string>();
  const best = matches[0] ?? null;
  if (best) {
    seenKeys.add(`${best.code}|${best.record.comuneNorm}|${best.record.nomeStradaNorm}`);
  }

  for (let i = 1; i < matches.length && dedupedAlternatives.length < 4; i++) {
    const m = matches[i];
    const key = `${m.code}|${m.record.comuneNorm}|${m.record.nomeStradaNorm}`;
    if (!seenKeys.has(key) || m.breakdown.civicoMatched === 'exact') {
      seenKeys.add(key);
      dedupedAlternatives.push(m);
    }
  }

  return {
    queryRaw: rawQuery,
    detectedComune: matchedComune?.comuneOriginal ?? null,
    detectedTipo,
    detectedStreetQuery: queryStreetTokens.join(' '),
    detectedCivico: queryCivico,
    best,
    alternatives: dedupedAlternatives,
    elapsedMs: performance.now() - t0,
  };
}
