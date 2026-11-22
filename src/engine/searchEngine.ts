import type {
  AddressRecord,
  ReliabilityTier,
  ScoreBreakdown,
  SearchMatch,
  SearchOutput,
} from '../types/sorting';
import {
  canonicalizeItalianPhonetics,
  expandHonorifics,
  isStreetTypeToken,
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

const indexCache = new Map<string, { count: number; versionSig: string; index: CenterSearchIndex }>();

export function invalidateCenterIndex(centerId: string) {
  indexCache.delete(centerId);
}

export function buildCenterIndex(centerId: string, records: AddressRecord[]): CenterSearchIndex {
  const versionSig =
    records.length > 0
      ? `${records[0].id}:${records[records.length - 1].id}:${records.length}`
      : '0';
  const cached = indexCache.get(centerId);
  if (cached && cached.count === records.length && cached.versionSig === versionSig) {
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

  indexCache.set(centerId, { count: records.length, versionSig, index });
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
 */
function detectComuneWithPriority(
  tokens: string[],
  comuni: ComuneCandidateInfo[]
): {
  matchedComune: ComuneCandidateInfo | null;
  remainingTokens: string[];
  matchConfidence: number;
  isExactComune: boolean;
} {
  if (tokens.length === 0 || comuni.length === 0) {
    return {
      matchedComune: null,
      remainingTokens: tokens,
      matchConfidence: 0,
      isExactComune: false,
    };
  }

  const startsWithStreetType = isStreetTypeToken(tokens[0]);

  if (!startsWithStreetType) {
    let bestLead: {
      comune: ComuneCandidateInfo;
      consumed: number;
      score: number;
      exact: boolean;
    } | null = null;
    const maxPrefixLen = Math.min(4, tokens.length);

    for (let len = maxPrefixLen; len >= 1; len--) {
      const sliceStr = canonicalizeItalianPhonetics(tokens.slice(0, len).join(' '));
      const sliceNoSpace = sliceStr.replace(/\s+/g, '');

      for (const c of comuni) {
        const cNoSpace = c.comuneNorm.replace(/\s+/g, '');

        if (sliceStr === c.comuneNorm || sliceNoSpace === cNoSpace) {
          return {
            matchedComune: c,
            remainingTokens: tokens.slice(len),
            matchConfidence: 1,
            isExactComune: true,
          };
        }

        if (len === 1 && tokens.length > 1 && c.tokens[0] === sliceStr && sliceStr.length >= 5) {
          const score = 0.96;
          if (!bestLead || score > bestLead.score) {
            bestLead = { comune: c, consumed: len, score, exact: true };
          }
        }
        if (len >= 2 && c.comuneNorm.startsWith(sliceStr + ' ')) {
          const score = 0.98;
          if (!bestLead || score > bestLead.score) {
            bestLead = { comune: c, consumed: len, score, exact: true };
          }
        }

        const simFull = stringSimilarity(sliceStr, c.comuneNorm);
        const simFirstToken =
          len === 1 && c.tokens.length > 0 && tokens.length > 1
            ? stringSimilarity(sliceStr, c.tokens[0]) * 0.92
            : 0;
        const sim = Math.max(simFull, simFirstToken);

        if (sim >= 0.8) {
          if (!bestLead || sim > bestLead.score || (sim === bestLead.score && len > bestLead.consumed)) {
            bestLead = { comune: c, consumed: len, score: sim, exact: false };
          }
        }
      }
    }

    if (bestLead) {
      return {
        matchedComune: bestLead.comune,
        remainingTokens: tokens.slice(bestLead.consumed),
        matchConfidence: bestLead.score,
        isExactComune: bestLead.exact,
      };
    }
  }

  if (tokens.length >= 2) {
    let bestTrail: {
      comune: ComuneCandidateInfo;
      startIdx: number;
      score: number;
      exact: boolean;
    } | null = null;
    for (let len = Math.min(4, tokens.length - 1); len >= 1; len--) {
      const startIdx = tokens.length - len;
      if (/^\d+[A-Z]?$/.test(tokens[startIdx])) continue;

      const sliceStr = canonicalizeItalianPhonetics(tokens.slice(startIdx).join(' '));
      for (const c of comuni) {
        if (sliceStr === c.comuneNorm) {
          return {
            matchedComune: c,
            remainingTokens: tokens.slice(0, startIdx),
            matchConfidence: 1,
            isExactComune: true,
          };
        }
        if (len === 1 && c.tokens[0] === sliceStr && sliceStr.length >= 6) {
          const score = 0.92;
          if (!bestTrail || score > bestTrail.score) {
            bestTrail = { comune: c, startIdx, score, exact: true };
          }
        }
        const sim = stringSimilarity(sliceStr, c.comuneNorm);
        if (sim >= 0.84) {
          if (!bestTrail || sim > bestTrail.score) {
            bestTrail = { comune: c, startIdx, score: sim, exact: false };
          }
        }
      }
    }
    if (bestTrail) {
      return {
        matchedComune: bestTrail.comune,
        remainingTokens: tokens.slice(0, bestTrail.startIdx),
        matchConfidence: bestTrail.score,
        isExactComune: bestTrail.exact,
      };
    }
  }

  return {
    matchedComune: null,
    remainingTokens: tokens,
    matchConfidence: 0,
    isExactComune: false,
  };
}

function extractQueryCivico(tokens: string[]): {
  streetTokens: string[];
  civico: { num: number; suffix: string } | null;
} {
  if (tokens.length === 0) return { streetTokens: [], civico: null };

  for (let i = tokens.length - 1; i >= 1; i--) {
    const t = tokens[i];
    const m = t.match(/^(\d{1,4})(?:\/([A-Z0-9]{1,4})|([A-Z]{1,2}))?$/);
    if (m) {
      const num = parseInt(m[1], 10);
      const suffix = (m[2] || m[3] || '').toUpperCase();
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

function scoreStreetTokens(
  queryTokens: string[],
  record: AddressRecord
): { ratio: number; exactTokenRatio: number; fuzzyAmount: number } {
  if (queryTokens.length === 0) {
    return { ratio: 0, exactTokenRatio: 0, fuzzyAmount: 1 };
  }

  const recTokens = record.nomeTokens;
  if (recTokens.length === 0) {
    return { ratio: 0, exactTokenRatio: 0, fuzzyAmount: 1 };
  }

  const queryJoined = queryTokens.join(' ');
  const recJoined = record.nomeStradaNorm;

  if (queryJoined === recJoined) {
    return { ratio: 1.0, exactTokenRatio: 1.0, fuzzyAmount: 0 };
  }

  const qCompact = queryTokens.join('');
  const rCompact = recTokens.join('');
  if (qCompact === rCompact) {
    return { ratio: 0.99, exactTokenRatio: 1.0, fuzzyAmount: 0.02 };
  }

  let matchedWeight = 0;
  let exactWeight = 0;
  let totalQueryWeight = 0;
  const usedRecIndices = new Set<number>();

  for (const qt of queryTokens) {
    const w = qt.length <= 2 ? 0.5 : 1.0;
    totalQueryWeight += w;

    let bestTokSim = 0;
    let bestIsExact = false;
    let bestIdx = -1;
    for (let j = 0; j < recTokens.length; j++) {
      if (usedRecIndices.has(j)) continue;
      const rt = recTokens[j];
      if (qt === rt) {
        bestTokSim = 1;
        bestIsExact = true;
        bestIdx = j;
        break;
      }
      if (qt.length >= 4 && rt.startsWith(qt)) {
        const pSim = 0.9;
        if (pSim > bestTokSim) {
          bestTokSim = pSim;
          bestIsExact = false;
          bestIdx = j;
        }
      } else {
        const sim = stringSimilarity(qt, rt);
        if (sim >= 0.68 && sim > bestTokSim) {
          bestTokSim = sim;
          bestIsExact = false;
          bestIdx = j;
        }
      }
    }

    if (bestIdx !== -1) {
      usedRecIndices.add(bestIdx);
      matchedWeight += w * bestTokSim;
      if (bestIsExact) exactWeight += w;
    }
  }

  if (totalQueryWeight === 0) {
    return { ratio: 0, exactTokenRatio: 0, fuzzyAmount: 1 };
  }

  const queryCoverage = matchedWeight / totalQueryWeight;
  const exactTokenRatio = exactWeight / totalQueryWeight;
  const recCoverage = usedRecIndices.size / recTokens.length;
  const compactSim = stringSimilarity(qCompact, rCompact);

  // Ordine invertito completo (es. "ALCIDE DE GASPERI" <-> "DE GASPERI ALCIDE") merita affidabilità piena
  const allQueryTokensExact = exactTokenRatio >= 0.99 && recCoverage >= 0.99;
  if (allQueryTokensExact) {
    return { ratio: 0.995, exactTokenRatio: 1, fuzzyAmount: 0 };
  }

  // Se tutti i token pronunciati sono esatti ma mancano nome di battesimo/titoli nel parlato (es. "Via De Gasperi" -> "VIA DE GASPERI ALCIDE")
  if (exactTokenRatio >= 0.99 && queryTokens.length >= 1) {
    return {
      ratio: Math.min(0.985, 0.92 + recCoverage * 0.06),
      exactTokenRatio,
      fuzzyAmount: 0.04,
    };
  }

  const combined = queryCoverage * 0.74 + recCoverage * 0.14 + compactSim * 0.12;
  const fuzzyAmount = Math.max(0, 1 - exactTokenRatio);
  return {
    ratio: Math.min(1, combined),
    exactTokenRatio,
    fuzzyAmount,
  };
}

function scoreCivico(
  queryCivico: { num: number; suffix: string } | null,
  record: AddressRecord
): { score: number; mode: ScoreBreakdown['civicoMatched']; civicoConfidence: number } {
  if (!queryCivico) {
    return { score: 0, mode: 'none', civicoConfidence: 0.96 };
  }

  const { num, suffix } = queryCivico;

  if (record.civicoNum !== null && record.civicoNum === num) {
    if (suffix && record.civicoSuffix) {
      if (suffix === record.civicoSuffix) {
        return { score: 1200, mode: 'exact', civicoConfidence: 1.0 };
      }
      return { score: 860, mode: 'exact', civicoConfidence: 0.88 };
    }
    if (!suffix && !record.civicoSuffix) {
      return { score: 1200, mode: 'exact', civicoConfidence: 1.0 };
    }
    return { score: 1050, mode: 'exact', civicoConfidence: 0.96 };
  }

  if (record.civicoStart !== null && record.civicoEnd !== null) {
    if (num >= record.civicoStart && num <= record.civicoEnd) {
      const isEven = num % 2 === 0;
      if (record.parity === 'even' && !isEven) {
        return { score: -250, mode: 'none', civicoConfidence: 0.45 };
      }
      if (record.parity === 'odd' && isEven) {
        return { score: -250, mode: 'none', civicoConfidence: 0.45 };
      }
      return { score: 1120, mode: 'range', civicoConfidence: 0.99 };
    }
  }

  if (record.civicoNum !== null) {
    const diff = Math.abs(record.civicoNum - num);
    if (diff <= 4) {
      return { score: 250 - diff * 30, mode: 'street-fallback', civicoConfidence: 0.84 };
    }
    if (diff <= 20) {
      return { score: 110, mode: 'street-fallback', civicoConfidence: 0.78 };
    }
  }

  return { score: 40, mode: 'street-fallback', civicoConfidence: 0.74 };
}

export function getReliabilityMeta(confidence: number): {
  tier: ReliabilityTier;
  label: string;
} {
  if (confidence >= 95) {
    return { tier: 'high', label: 'Alta affidabilità' };
  }
  if (confidence >= 80) {
    return { tier: 'medium', label: 'Verificare' };
  }
  return { tier: 'low', label: 'Bassa affidabilità' };
}

export interface SearchQueryOptions {
  speechConfidence?: number; // 0..1 proveniente da Web Speech API (1 per digitazione manuale)
}

export function searchAddressInIndex(
  index: CenterSearchIndex,
  rawQuery: string,
  options: SearchQueryOptions = {}
): SearchOutput {
  const t0 = performance.now();
  const speechQuality =
    typeof options.speechConfidence === 'number' && options.speechConfidence > 0
      ? Math.max(0.4, Math.min(1, options.speechConfidence))
      : 1;

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
  const {
    matchedComune,
    remainingTokens,
    matchConfidence: comuneMatchConf,
    isExactComune,
  } = detectComuneWithPriority(rawTokens, index.comuni);

  // 2. Estrazione Tipo Strada + Civico dai token rimanenti
  let workTokens = [...remainingTokens];
  let detectedTipo: string | null = null;

  if (workTokens.length > 0 && isStreetTypeToken(workTokens[0])) {
    detectedTipo = normalizeStreetType(workTokens[0]);
    workTokens = workTokens.slice(1);
    if (
      (detectedTipo === 'VIA' && workTokens[0] === 'PRIVATA') ||
      (detectedTipo === 'STRADA' &&
        (workTokens[0] === 'PROVINCIALE' ||
          workTokens[0] === 'STATALE' ||
          workTokens[0] === 'COMUNALE'))
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

  const primaryPool = matchedComune
    ? index.recordsByComune.get(matchedComune.comuneNorm) ?? index.records
    : index.records;

  const evaluatePool = (
    pool: AddressRecord[],
    comuneMatchedInPool: boolean
  ): Array<{ match: SearchMatch; rawConf: number }> => {
    const results: Array<{ match: SearchMatch; rawConf: number }> = [];

    for (const rec of pool) {
      const { ratio: streetRatio, fuzzyAmount } = scoreStreetTokens(queryStreetTokens, rec);
      if (queryStreetTokens.length > 0 && streetRatio < 0.36) continue;

      const comuneScore = comuneMatchedInPool ? Math.round(4500 * comuneMatchConf) : 0;
      const streetScore = Math.round(streetRatio * 3000);
      const { score: civicoScore, mode: civicoMatched, civicoConfidence } = scoreCivico(
        queryCivico,
        rec
      );
      const tipoScore =
        detectedTipo && rec.tipoStradaNorm === detectedTipo
          ? 200
          : detectedTipo && rec.tipoStradaNorm !== detectedTipo
            ? -40
            : 0;

      const totalScore = comuneScore + streetScore + civicoScore + tipoScore;

      // Calcolo affidabilità 0-100 multi-fattore
      const comuneFactor = comuneMatchedInPool
        ? isExactComune
          ? 1.0
          : comuneMatchConf
        : index.comuni.length <= 1
          ? 0.96
          : 0.72; // Se il centro ha più comuni e non è stato specificato, leggera riduzione affidabilità
      const streetFactor = queryStreetTokens.length === 0 ? 0.65 : streetRatio;
      const fuzzyPenalty = Math.round(fuzzyAmount * 14) + (comuneMatchedInPool && !isExactComune ? 6 : 0);
      const tipoPenalty =
        detectedTipo && rec.tipoStradaNorm !== detectedTipo ? 4 : 0;
      const speechPenalty = speechQuality < 0.85 ? Math.round((0.92 - speechQuality) * 28) : 0;

      const baseQuality =
        comuneFactor * 34 +
        streetFactor * 44 +
        civicoConfidence * 22;

      const rawConf = Math.max(
        5,
        Math.min(100, Math.round(baseQuality - fuzzyPenalty - tipoPenalty - speechPenalty))
      );

      const { tier, label } = getReliabilityMeta(rawConf);

      results.push({
        rawConf,
        match: {
          record: rec,
          code: `${rec.zona}${rec.subzona}`,
          confidence: rawConf,
          reliabilityTier: tier,
          reliabilityLabel: label,
          breakdown: {
            comuneScore,
            streetScore,
            civicoScore,
            tipoScore,
            totalScore,
            comuneMatched: comuneMatchedInPool,
            civicoMatched,
            fuzzyPenalty,
            ambiguityPenalty: 0,
            speechQuality: Math.round(speechQuality * 100),
          },
        },
      });
    }

    results.sort((a, b) => {
      if (b.match.breakdown.totalScore !== a.match.breakdown.totalScore) {
        return b.match.breakdown.totalScore - a.match.breakdown.totalScore;
      }
      return a.match.record.prog.localeCompare(b.match.record.prog, 'it', { numeric: true });
    });

    return results;
  };

  let scored = evaluatePool(primaryPool, Boolean(matchedComune));
  if (scored.length === 0 && matchedComune) {
    scored = evaluatePool(index.records, false);
  }

  // Deduplica candidati mantenendo le migliori zone/subzone o vie distinte
  const distinctMatches: SearchMatch[] = [];
  const seenKeys = new Set<string>();
  for (const item of scored) {
    const rec = item.match.record;
    const key = `${item.match.code}|${rec.comuneNorm}|${rec.nomeStradaNorm}`;
    if (!seenKeys.has(key) || (distinctMatches.length === 0 && item.match.breakdown.civicoMatched === 'exact')) {
      seenKeys.add(key);
      distinctMatches.push(item.match);
    }
    if (distinctMatches.length >= 6) break;
  }

  let best = distinctMatches[0] ?? null;

  // Penalità per ambiguità se esiste una seconda zona/subzona diversa con punteggio molto vicino
  if (best && distinctMatches.length > 1) {
    const competingDiffZone = distinctMatches.find((alt) => alt.code !== best!.code);
    if (competingDiffZone) {
      const scoreGap =
        best.breakdown.totalScore - competingDiffZone.breakdown.totalScore;
      const ratioGap = scoreGap / Math.max(1, best.breakdown.totalScore);
      let ambiguityPenalty = 0;
      if (ratioGap < 0.04) ambiguityPenalty = 14;
      else if (ratioGap < 0.09) ambiguityPenalty = 8;

      if (ambiguityPenalty > 0) {
        const adjustedConf = Math.max(5, best.confidence - ambiguityPenalty);
        const meta = getReliabilityMeta(adjustedConf);
        best = {
          ...best,
          confidence: adjustedConf,
          reliabilityTier: meta.tier,
          reliabilityLabel: meta.label,
          breakdown: {
            ...best.breakdown,
            ambiguityPenalty,
          },
        };
      }
    }
  }

  // Le 3 migliori alternative ordinate per affidabilità decrescente (mai superiore al risultato principale)
  const alternatives = distinctMatches.slice(1, 4).map((alt, idx) => {
    const cappedConf = best ? Math.min(alt.confidence, Math.max(5, best.confidence - 2 - idx)) : alt.confidence;
    const meta = getReliabilityMeta(cappedConf);
    return {
      ...alt,
      confidence: cappedConf,
      reliabilityTier: meta.tier,
      reliabilityLabel: meta.label,
    };
  });

  return {
    queryRaw: rawQuery,
    detectedComune: matchedComune?.comuneOriginal ?? null,
    detectedTipo,
    detectedStreetQuery: queryStreetTokens.join(' '),
    detectedCivico: queryCivico,
    best,
    alternatives,
    elapsedMs: performance.now() - t0,
  };
}
