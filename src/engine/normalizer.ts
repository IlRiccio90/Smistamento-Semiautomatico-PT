import type { CivicParity } from '../types/sorting';

/**
 * Mappa canonica delle abbreviazioni e forme dei tipi stradali italiani.
 */
const STREET_TYPE_MAP: Record<string, string> = {
  VIA: 'VIA',
  V: 'VIA',
  'V.': 'VIA',
  VLE: 'VIALE',
  'V.LE': 'VIALE',
  VIALE: 'VIALE',
  PIAZZA: 'PIAZZA',
  PZ: 'PIAZZA',
  PZA: 'PIAZZA',
  'P.ZA': 'PIAZZA',
  PZZA: 'PIAZZA',
  'P.ZZA': 'PIAZZA',
  PIAZZALE: 'PIAZZALE',
  PLE: 'PIAZZALE',
  'P.LE': 'PIAZZALE',
  PIAZZETTA: 'PIAZZETTA',
  CORSO: 'CORSO',
  CSO: 'CORSO',
  'C.SO': 'CORSO',
  VICOLO: 'VICOLO',
  VLO: 'VICOLO',
  'V.LO': 'VICOLO',
  LARGO: 'LARGO',
  LGO: 'LARGO',
  'L.GO': 'LARGO',
  STRADA: 'STRADA',
  STR: 'STRADA',
  'STR.': 'STRADA',
  'STRADA PROVINCIALE': 'STRADA PROVINCIALE',
  SP: 'STRADA PROVINCIALE',
  'S.P': 'STRADA PROVINCIALE',
  'S.P.': 'STRADA PROVINCIALE',
  'STRADA STATALE': 'STRADA STATALE',
  SS: 'STRADA STATALE',
  'S.S': 'STRADA STATALE',
  'S.S.': 'STRADA STATALE',
  'STRADA COMUNALE': 'STRADA COMUNALE',
  SC: 'STRADA COMUNALE',
  'S.C': 'STRADA COMUNALE',
  LOCALITA: 'LOCALITA',
  LOC: 'LOCALITA',
  'LOC.': 'LOCALITA',
  FRAZIONE: 'FRAZIONE',
  FRAZ: 'FRAZIONE',
  'FRAZ.': 'FRAZIONE',
  CASCINA: 'CASCINA',
  CNA: 'CASCINA',
  'C.NA': 'CASCINA',
  BORGO: 'BORGO',
  BGO: 'BORGO',
  'B.GO': 'BORGO',
  CONTRADA: 'CONTRADA',
  CDA: 'CONTRADA',
  'C.DA': 'CONTRADA',
  SALITA: 'SALITA',
  DISCESA: 'DISCESA',
  RIONE: 'RIONE',
  PARCO: 'PARCO',
  TRAVERSA: 'TRAVERSA',
  GALLERIA: 'GALLERIA',
  CIRCONVALLAZIONE: 'CIRCONVALLAZIONE',
  PASSAGGIO: 'PASSAGGIO',
  PORTA: 'PORTA',
  LUNGADIGE: 'LUNGADIGE',
  LUNGARNO: 'LUNGARNO',
  LUNGOMARE: 'LUNGOMARE',
  LUNGOTEVERE: 'LUNGOTEVERE',
  ALZAIA: 'ALZAIA',
  RIPA: 'RIPA',
  CA: 'CASCINA',
  PODERE: 'PODERE',
  TENUTA: 'TENUTA',
  MULINO: 'MULINO',
  MOLINO: 'MOLINO',
  VILLA: 'VILLA',
  RESIDENZA: 'RESIDENZA',
  QUARTIERE: 'QUARTIERE',
  ROTATORIA: 'ROTATORIA',
  ROTONDA: 'ROTONDA',
};

const MULTIWORD_STREET_TYPES = [
  'STRADA PROVINCIALE',
  'STRADA STATALE',
  'STRADA COMUNALE',
  'STRADA VICINALE',
  'STRADA CONSORTILE',
  'VIA PRIVATA',
];

const ALL_SINGLE_STREET_TYPES = new Set(Object.keys(STREET_TYPE_MAP));

const HONORIFIC_ABBREVIATIONS: Record<string, string> = {
  S: 'SAN',
  ST: 'SAN',
  MONS: 'MONSIGNOR',
  CAV: 'CAVALIER',
  ING: 'INGEGNERE',
  AVV: 'AVVOCATO',
  DOTT: 'DOTTOR',
  DR: 'DOTTOR',
  PROF: 'PROFESSOR',
  CAP: 'CAPITANO',
  GEN: 'GENERALE',
  TEN: 'TENENTE',
  COL: 'COLONNELLO',
  ON: 'ONOREVOLE',
  PRES: 'PRESIDENTE',
  SEN: 'SENATORE',
  FR: 'FRATELLI',
  FLLI: 'FRATELLI',
  SS: 'SANTI',
};

/**
 * Parole italiane comuni per i numeri pronunciati a voce durante la lettura.
 */
const ITALIAN_UNITS: Record<string, number> = {
  zero: 0,
  uno: 1,
  un: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
};

const ITALIAN_TENS: Record<string, number> = {
  venti: 20,
  vent: 20,
  trenta: 30,
  trent: 30,
  quaranta: 40,
  quarant: 40,
  cinquanta: 50,
  cinquant: 50,
  sessanta: 60,
  sessant: 60,
  settanta: 70,
  settant: 70,
  ottanta: 80,
  ottant: 80,
  novanta: 90,
  novant: 90,
};

export function normalizeBaseText(input: string): string {
  if (!input) return '';
  let s = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .toUpperCase();

  // Normalizza apostrofi e punteggiatura in spazi
  s = s.replace(/[’'`´"]/g, ' ');
  // Mantieni lettere, cifre, trattini e barre solo dove utili; converti altri simboli in spazio
  s = s.replace(/[,;:.()[\]{}!?]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Rende equivalenti forme come "SANT ANGELO", "SANT'ANGELO", "SANTANGELO", "SAN T ANGELO"
 */
export function canonicalizeItalianPhonetics(normText: string): string {
  return normText
    .replace(/\bSANT\s+ANGELO\b/g, 'SANTANGELO')
    .replace(/\bSANT\s+([AEIOU])/g, 'SANT$1')
    .replace(/\bSAN\s+([A-Z]+)/g, 'SAN $1')
    .replace(/\bSANTA\s+([A-Z]+)/g, 'SANTA $1')
    .replace(/\bSANTO\s+([A-Z]+)/g, 'SANTO $1')
    .replace(/\bDELL\s+([AEIOU])/g, 'DELL$1')
    .replace(/\bALL\s+([AEIOU])/g, 'ALL$1')
    .replace(/\bD\s+([AEIOU])/g, 'D$1')
    .replace(/\bL\s+([AEIOU])/g, 'L$1');
}

export function expandHonorifics(tokens: string[]): string[] {
  return tokens.map((t) => HONORIFIC_ABBREVIATIONS[t] ?? t);
}

export function normalizeComune(comune: string): string {
  const base = normalizeBaseText(comune)
    .replace(/\b(LO|MI|CR|PV|BG|BS|MB|MN|CO|VA|LC|SO|PC|PR)\b$/g, '') // rimuove sigla provincia in coda
    .trim();
  return canonicalizeItalianPhonetics(base);
}

export function normalizeStreetType(rawType: string): string {
  const clean = normalizeBaseText(rawType).replace(/\./g, '');
  return STREET_TYPE_MAP[clean] ?? clean;
}

export function isStreetTypeToken(token: string): boolean {
  const clean = normalizeBaseText(token).replace(/\./g, '');
  return ALL_SINGLE_STREET_TYPES.has(clean);
}

export function tokenizeStreetName(name: string): string[] {
  const norm = canonicalizeItalianPhonetics(normalizeBaseText(name));
  const rawTokens = norm.split(/\s+/).filter(Boolean);
  const expanded = expandHonorifics(rawTokens);
  // Rimuove articoli o preposizioni troppo corti solo come ausilio, ma tiene sigle significative
  return expanded.filter((t) => t.length > 0);
}

/**
 * Converte numeri parlati in italiano (es. "venticinque" -> "25", "dieci barra a" -> "10/A")
 */
export function normalizeSpokenNumbers(text: string): string {
  const words = normalizeBaseText(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'BARRA' || w === 'BARRATO' || w === 'SLASH') {
      if (out.length > 0 && /^\d+$/.test(out[out.length - 1]) && i + 1 < words.length) {
        const nextWord = words[i + 1];
        if (nextWord.length <= 3) {
          out[out.length - 1] = `${out[out.length - 1]}/${nextWord}`;
          i++;
          continue;
        }
      }
      continue;
    }

    const parsedNum = parseItalianNumberWord(w.toLowerCase());
    if (parsedNum !== null) {
      out.push(String(parsedNum));
    } else {
      out.push(w);
    }
  }

  return out.join(' ');
}

function parseItalianNumberWord(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  if (word in ITALIAN_UNITS) return ITALIAN_UNITS[word];
  if (word in ITALIAN_TENS) return ITALIAN_TENS[word];

  // Composti 21..99 es. "ventidue", "trentacinque", "ottantotto"
  for (const [tensKey, tensVal] of Object.entries(ITALIAN_TENS)) {
    if (word.startsWith(tensKey)) {
      const rest = word.slice(tensKey.length);
      if (rest in ITALIAN_UNITS && ITALIAN_UNITS[rest] >= 1 && ITALIAN_UNITS[rest] <= 9) {
        return tensVal + ITALIAN_UNITS[rest];
      }
    }
  }

  // Centinaia semplici es. "cento", "duecento"
  if (word === 'cento') return 100;
  const centoMatch = word.match(/^(due|tre|quattro|cinque|sei|sette|otto|nove)cento(.*)$/);
  if (centoMatch) {
    const hundreds = (ITALIAN_UNITS[centoMatch[1]] ?? 0) * 100;
    const remainder = centoMatch[2];
    if (!remainder) return hundreds;
    const remVal = parseItalianNumberWord(remainder);
    if (remVal !== null) return hundreds + remVal;
  }

  return null;
}

export interface ParsedCivicoInfo {
  civicoRaw: string;
  civicoNum: number | null;
  civicoSuffix: string;
  civicoStart: number | null;
  civicoEnd: number | null;
  parity: CivicParity;
  isSnc: boolean;
}

export function extractCivicoDetails(textSegment: string): {
  cleanedStreet: string;
  civico: ParsedCivicoInfo;
} {
  let work = textSegment.trim();
  let parity: CivicParity = 'all';

  if (/\b(?:SOLO\s+)?PARI\b/i.test(work)) {
    parity = 'even';
    work = work.replace(/\b(?:SOLO\s+)?PARI\b/gi, ' ').trim();
  } else if (/\b(?:SOLO\s+)?DISPARI\b/i.test(work)) {
    parity = 'odd';
    work = work.replace(/\b(?:SOLO\s+)?DISPARI\b/gi, ' ').trim();
  }

  let isSnc = false;
  if (/\bS\.?\s*N\.?\s*C\.?\b/i.test(work)) {
    isSnc = true;
  }

  // Cerca intervallo civico es. "1-99", "2 - 120", "DAL 10 AL 50"
  const rangeMatch =
    work.match(/\b(?:DAL\s+)?(\d{1,4})\s*(?:-|AL|\/)\s*(\d{1,4})\b(?=\s|$|,)/i);
  if (rangeMatch && !work.match(/\b\d{1,4}\/[A-Z]\b/i)) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    // Verifica che non sia una barra di scala/interno tipo "16/3" se il secondo numero è <= 20 e non è un range chiaro
    const hasExplicitRangeKeyword = /\b(?:DAL|AL|-)\b/i.test(rangeMatch[0]) || parity !== 'all' || b - a > 4;
    if (hasExplicitRangeKeyword && b >= a) {
      const cleanedStreet = work.replace(rangeMatch[0], ' ').replace(/\s+/g, ' ').trim();
      return {
        cleanedStreet,
        civico: {
          civicoRaw: `${a}-${b}${parity === 'even' ? ' pari' : parity === 'odd' ? ' dispari' : ''}`,
          civicoNum: null,
          civicoSuffix: '',
          civicoStart: a,
          civicoEnd: b,
          parity,
          isSnc,
        },
      };
    }
  }

  // Cerca "SNC 1" o "SNC"
  const sncNumMatch = work.match(/\bS\.?\s*N\.?\s*C\.?(?:\s+(\d{1,4}[A-Z]?))?\b/i);
  if (sncNumMatch) {
    const raw = sncNumMatch[0].trim();
    const num = sncNumMatch[1] ? parseInt(sncNumMatch[1], 10) : null;
    const cleanedStreet = work.replace(sncNumMatch[0], ' ').replace(/\s+/g, ' ').trim();
    return {
      cleanedStreet,
      civico: {
        civicoRaw: raw,
        civicoNum: num,
        civicoSuffix: '',
        civicoStart: num,
        civicoEnd: num,
        parity,
        isSnc: true,
      },
    };
  }

  // Cerca civico singolo in coda (o prima della virgola), inclusi suffissi tipo "10", "33/C", "16/3", "27A", "12 BIS"
  // Attenzione a date/anni storici nelle vie (es. "VIA IV NOVEMBRE", "VIA 25 APRILE 12", "VIA 1 MAGGIO 8"):
  // prendiamo l'ULTIMO token numerico significativo alla fine della parte strada!
  const trailingCivicoMatch = work.match(
    /(?:^|\s)(?:N\.?\s*|NR\.?\s*)?(\d{1,4})(?:\s*\/\s*([A-Z0-9]{1,4})|([A-Z]{1,2})|\s+(BIS|TER|QUATER))?\s*$/i
  );

  if (trailingCivicoMatch) {
    const fullMatch = trailingCivicoMatch[0];
    const num = parseInt(trailingCivicoMatch[1], 10);
    const suffix = (trailingCivicoMatch[2] || trailingCivicoMatch[3] || trailingCivicoMatch[4] || '')
      .toUpperCase()
      .trim();
    const prefixBeforeNum = work.slice(0, work.length - fullMatch.length).trim();
    // Se prima del numero non c'è nulla (es. "25 APRILE" troncato), non togliere l'unico token
    if (prefixBeforeNum.length > 0) {
      const civicoRaw = suffix ? `${num}/${suffix}` : `${num}`;
      return {
        cleanedStreet: prefixBeforeNum,
        civico: {
          civicoRaw,
          civicoNum: num,
          civicoSuffix: suffix,
          civicoStart: num,
          civicoEnd: num,
          parity,
          isSnc: false,
        },
      };
    }
  }

  return {
    cleanedStreet: work,
    civico: {
      civicoRaw: parity === 'even' ? 'PARI' : parity === 'odd' ? 'DISPARI' : '',
      civicoNum: null,
      civicoSuffix: '',
      civicoStart: null,
      civicoEnd: null,
      parity,
      isSnc,
    },
  };
}

export interface ParsedAddressFields {
  comune: string;
  comuneNorm: string;
  frazione: string;
  tipoStrada: string;
  tipoStradaNorm: string;
  nomeStrada: string;
  nomeStradaNorm: string;
  nomeTokens: string[];
  civico: ParsedCivicoInfo;
}

export function parseAddressString(rawAddress: string, hintComune = ''): ParsedAddressFields {
  const cleanedRaw = rawAddress.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

  // Separa per virgola: normalmente "[Indirizzo + Civico], [Frazione opzionale], [Comune]"
  const parts = cleanedRaw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let streetAndCivicoPart = parts[0] || cleanedRaw;
  let comune = hintComune.trim();
  let frazione = '';

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    // Controlla se l'ultima parte è solo un numero/civico (es. "VIALE ITALIA, 29")
    if (/^\d+[A-Z/]*$/i.test(lastPart) && parts.length === 2) {
      streetAndCivicoPart = `${parts[0]} ${lastPart}`;
    } else {
      comune = lastPart;
      if (parts.length >= 3) {
        frazione = parts.slice(1, -1).join(', ');
      }
      // Alcuni indirizzi hanno "VIA X, 10, COMUNE"
      if (parts.length >= 3 && /^\d+(?:\s*[-/]\s*\d+|\/[A-Z]+)?$/i.test(parts[1])) {
        streetAndCivicoPart = `${parts[0]} ${parts[1]}`;
        frazione = parts.slice(2, -1).join(', ');
      }
    }
  }

  // Rimuove eventuale CAP davanti al comune (es. "26866 SANT'ANGELO LODIGIANO") e trattini spuri
  comune = comune
    .replace(/^[-–—\s]+/, '')
    .replace(/^\b\d{5}\b\s*-?\s*/g, '')
    .replace(/\s+\b(?:LO|MI|CR|PV|BG|BS|MB|MN)\b$/i, '')
    .trim();

  const { cleanedStreet, civico } = extractCivicoDetails(streetAndCivicoPart);

  // Estrae Tipo Strada + Nome Strada
  const upperStreet = normalizeBaseText(cleanedStreet);
  let tipoStrada = '';
  let tipoStradaNorm = '';
  let nomeStrada = cleanedStreet.trim();

  let matchedMulti = false;
  for (const multi of MULTIWORD_STREET_TYPES) {
    if (upperStreet.startsWith(multi + ' ')) {
      tipoStrada = multi;
      tipoStradaNorm = multi === 'VIA PRIVATA' ? 'VIA' : multi;
      // Taglia dalla stringa originale circa lo stesso numero di parole
      const wordCount = multi.split(' ').length;
      nomeStrada = cleanedStreet.trim().split(/\s+/).slice(wordCount).join(' ');
      matchedMulti = true;
      break;
    }
  }

  if (!matchedMulti) {
    const rawWords = cleanedStreet.trim().split(/\s+/);
    if (rawWords.length >= 2) {
      const firstClean = normalizeBaseText(rawWords[0]).replace(/\./g, '');
      if (ALL_SINGLE_STREET_TYPES.has(firstClean)) {
        tipoStrada = rawWords[0].toUpperCase().replace(/\.$/, '');
        tipoStradaNorm = normalizeStreetType(firstClean);
        nomeStrada = rawWords.slice(1).join(' ');
      }
    }
  }

  nomeStrada = nomeStrada.replace(/^[-–—\s]+/, '').trim();

  // Caso particolare: "VIA PRIVATA ..." -> mantieni PRIVATA se il resto è vuoto, altrimenti già estratto
  if (!nomeStrada && cleanedStreet) {
    nomeStrada = cleanedStreet;
  }

  const nomeTokens = tokenizeStreetName(nomeStrada);
  const nomeStradaNorm = nomeTokens.join(' ');
  const comuneNorm = normalizeComune(comune);

  return {
    comune: comune || 'SCONOSCIUTO',
    comuneNorm,
    frazione,
    tipoStrada: tipoStradaNorm || tipoStrada || 'VIA',
    tipoStradaNorm: tipoStradaNorm || 'VIA',
    nomeStrada: nomeStrada.trim(),
    nomeStradaNorm,
    nomeTokens,
    civico,
  };
}
