import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  AddressRecord,
  ExtractionProgress,
  PdfDiscardedRecord,
  PdfDocumentRecord,
  PdfExtractionDebugStats,
  PdfExtractionMethod,
} from '../types/sorting';
import { normalizeBaseText, parseAddressString } from './normalizer';

if (typeof pdfWorkerUrl === 'string' && pdfWorkerUrl) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface RawExtractedRow {
  zona: string;
  subzona: string;
  prog: string;
  rawAddress: string;
  hintComune: string;
  note: string;
  scala: string;
  startPage: number;
  lineCount: number;
  crossPageMerged: boolean;
  incompleteComuneMerged: boolean;
}

interface ColumnLayout {
  subzonaMaxX: number;
  progMinX: number;
  progMaxX: number;
  indirizzoMinX: number;
  indirizzoMaxX: number;
  noteMinX?: number;
  noteMaxX?: number;
  scalaMinX?: number;
  scalaMaxX?: number;
  headerBottomY: number;
}

export interface PdfExtractionResult {
  pdfRecord: PdfDocumentRecord;
  addresses: AddressRecord[];
  debugStats: PdfExtractionDebugStats;
}

const STOP_SECTION_REGEX =
  /(?:Progressivo\s+Indirizzo\s+Tipo|Itinerario\s+Appoggi|Itinerario\s+Vuotatura|Elenco\s+Cassette|Chi\s+Svuota|Codice\s+Cassetta|Cliente\s+Indirizzo\s+Cliente|Tipo\s+Ufficio|Domande\s+attive|Domande\s+chiuse|Nome\s+Cognome\/\s*Ragione\s+Sociale|Indirizzo\s+Seguimi|\bRubrica\b\s*$)/i;

const STREET_STARTER_REGEX =
  /^(?:VIA|V\.LE|VIALE|PIAZZA|P\.ZZA|P\.ZA|PIAZZALE|P\.LE|PIAZZETTA|CORSO|C\.SO|VICOLO|V\.LO|LARGO|L\.GO|STRADA|STR\.?|SP|S\.P\.?|SS|S\.S\.?|SC|S\.C\.?|CASCINA|C\.NA|LOCALITA|LOC\.?|FRAZIONE|FRAZ\.?|BORGO|B\.GO|CONTRADA|C\.DA|SALITA|DISCESA|RIONE|PARCO|TRAVERSA|GALLERIA|CIRCONVALLAZIONE|PASSAGGIO|PORTA|LUNGADIGE|LUNGARNO|LUNGOMARE|LUNGOTEVERE|ALZAIA|RIPA|PODERE|TENUTA|MULINO|MOLINO|VILLA|RESIDENZA|QUARTIERE|ROTATORIA|ROTONDA)\b/i;

const ANY_STREET_KEYWORD_REGEX =
  /\b(?:VIA|V\.LE|VIALE|PIAZZA|P\.ZZA|P\.ZA|PIAZZALE|P\.LE|PIAZZETTA|CORSO|C\.SO|VICOLO|V\.LO|LARGO|L\.GO|STRADA|STR\.?|SP|S\.P\.?|SS|S\.S\.?|SC|S\.C\.?|CASCINA|C\.NA|LOCALITA|LOC\.?|FRAZIONE|FRAZ\.?|BORGO|B\.GO|CONTRADA|C\.DA|SALITA|DISCESA|RIONE|PARCO|TRAVERSA|GALLERIA|CIRCONVALLAZIONE|PASSAGGIO|PORTA|PODERE|TENUTA|MULINO|MOLINO|VILLA|RESIDENZA|QUARTIERE|ROTATORIA|ROTONDA)\b/i;

const BARE_STREET_PREFIX_REGEX =
  /^(?:VIA|V\.LE|VIALE|PIAZZA|P\.ZZA|P\.ZA|PIAZZALE|P\.LE|CORSO|C\.SO|VICOLO|LARGO|STRADA|STR\.?|SP|SS|SC|CASCINA|LOCALITA|LOC\.?|FRAZIONE|FRAZ\.?|BORGO|CONTRADA|SALITA)(?:\s+(?:PRIVATA|PROVINCIALE|STATALE|COMUNALE|VICINALE))?$/i;

const INCOMPLETE_TRAILING_WORD_REGEX =
  /\b(?:DI|DEL|DELLA|DELLO|DEI|DEGLI|DELLE|DA|DAL|DALLA|AL|ALL|ALLA|AI|AGLI|ALLE|IN|SU|PER|CON|SAN|SANTA|SANTO|SANT|SANTI|DON|MONS|MONSIGNOR|PAPA|BEATO|FRA|FRATELLI|PADRE|SUOR|CAPITANO|GENERALE|TENENTE|COLONNELLO|AVVOCATO|DOTTOR|INGEGNERE|PROFESSOR|CAVALIER|ONOREVOLE|PRESIDENTE|SENATORE|PRIMO|SECONDO|TERZO|QUARTO|QUINTO|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XX|XXI|XXIV|XXV|XXVI|XXVII|XXVIII|XXIX|XXX)\s*$/i;

const NON_SUBZONA_KEYWORDS = new Set([
  'VIA',
  'VIALE',
  'VLE',
  'CORSO',
  'CSO',
  'PIAZZA',
  'PZA',
  'PZ',
  'LARGO',
  'VICOLO',
  'STRADA',
  'STR',
  'SP',
  'SS',
  'SC',
  'CA',
  'LOC',
  'FRAZ',
  'DI',
  'DA',
  'DE',
  'DEL',
  'LA',
  'LE',
  'IL',
  'LO',
  'AL',
  'IN',
  'SU',
  'SAN',
  'PAG',
  'NO',
  'SI',
]);

function detectZoneFromTextAndName(sampleTexts: string[], fileName: string): {
  zone: string;
  frazionario?: string;
} {
  const joined = sampleTexts.join('\n');

  const frazMatch = joined.match(/Frazionario\s*:?\s*(\d{4,6})/i);
  const frazionario = frazMatch ? frazMatch[1] : undefined;

  const numZonaMatch = joined.match(/Numero\s+Zona\s*:?\s*([0-9]{1,3}[A-Z]?)/i);
  if (numZonaMatch) return { zone: numZonaMatch[1].toUpperCase(), frazionario };

  const headerZonaMatch = joined.match(/Zona\s*:\s*([0-9]{1,3}[A-Z]?)\b/i);
  if (headerZonaMatch) return { zone: headerZonaMatch[1].toUpperCase(), frazionario };

  const fileZonaMatch = fileName.match(/zona[\s_-]*([0-9]{1,3}[A-Z]?)/i);
  if (fileZonaMatch) return { zone: fileZonaMatch[1].toUpperCase(), frazionario };

  const fileNumMatch = fileName.match(/\b([0-9]{1,2})\b/);
  if (fileNumMatch) return { zone: fileNumMatch[1], frazionario };

  return { zone: '1', frazionario };
}

function groupItemsIntoLines(items: PdfTextItem[], yTolerance = 4.5): Array<{ y: number; items: PdfTextItem[] }> {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: PdfTextItem[] }> = [];

  for (const item of sorted) {
    if (!item.str || !item.str.trim()) continue;
    const existing = lines.find((l) => Math.abs(l.y - item.y) <= yTolerance);
    if (existing) {
      existing.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => (Math.abs(a.x - b.x) <= 6 ? b.y - a.y : a.x - b.x));
  }
  return lines;
}

function isItinerarioTableHeaderText(text: string): boolean {
  if (STOP_SECTION_REGEX.test(text)) return false;
  const hasSub = /\bSub[\s-]*zona\b/i.test(text) || (/\bSub\b/i.test(text) && /\bzona\b/i.test(text));
  const hasProg = /\bProg(?:\.|ressivo)?\b/i.test(text);
  const hasInd = /\bIndirizzo\b/i.test(text);
  return hasSub && hasProg && hasInd;
}

export function detectPosteColumnLayout(items: PdfTextItem[]): ColumnLayout | null {
  const lines = groupItemsIntoLines(items, 12);
  for (const line of lines) {
    const lineText = line.items.map((i) => i.str).join(' ');
    if (isItinerarioTableHeaderText(lineText)) {
      const findX = (re: RegExp) => line.items.find((i) => re.test(i.str))?.x;

      const subX = findX(/^Sub/i) ?? 30;
      const progX = findX(/Prog/i) ?? subX + 22;
      const indX = findX(/Indirizzo/i) ?? progX + 24;
      const orarioX = findX(/Orario|Portiere|Tipo/i);
      const noteX = findX(/^Note$/i);
      const scalaX = findX(/^Scala$/i);
      const gcX = findX(/^GC$/i);
      const rightBoundaryX = orarioX ?? noteX ?? scalaX ?? gcX;

      // In molti PDF Poste, la colonna "Indirizzo" inizia ~18px prima dell'intestazione centrata "Indirizzo".
      // Manteniamo progMaxX vicino a progX+20 (e non solo il punto medio verso indX) così il testo indirizzo non cade in Prog.
      const progMaxX = Math.min((progX + indX) / 2 + 2, progX + 22);
      const subMaxX = Math.max(subX + 16, (subX + progX) / 2 + 1);

      return {
        subzonaMaxX: Math.min(subMaxX, progX - 3),
        progMinX: Math.min(subMaxX, progX - 3),
        progMaxX,
        indirizzoMinX: Math.min(progMaxX - 1, indX - 24),
        indirizzoMaxX: rightBoundaryX !== undefined ? rightBoundaryX - 4 : Infinity,
        noteMinX: noteX ? noteX - 18 : undefined,
        noteMaxX: scalaX ? scalaX - 4 : noteX ? noteX + 44 : undefined,
        scalaMinX: scalaX ? scalaX - 6 : undefined,
        scalaMaxX: gcX ? gcX - 4 : scalaX ? scalaX + 24 : undefined,
        headerBottomY: line.y - 14,
      };
    }
  }
  return null;
}

export function isPageNoiseLine(lineText: string): boolean {
  const t = lineText.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^Pag\.?\s*\d+(?:\s*\/\s*\d+)?$/i.test(t)) return true;
  if (/^\d{1,3}\s*\/\s*\d{1,3}$/.test(t)) return true;
  if (/Frazionario\s*:\s*\d+.*Zona\s*:/i.test(t)) return true;
  if (/Data\s+Ultima\s+Variazione/i.test(t)) return true;
  if (isItinerarioTableHeaderText(t)) return true;
  if (/^(?:Orario\s+Portiere|Tipo\s+Portiere|Abitazioni\s+Attive|Cassetta\s+Domiciliare|Cane\s+Presente|Incrocio\s+Pericoloso)/i.test(t)) {
    return true;
  }
  if (/^(?:TOTALE|RIEPILOGO|FINE\s+(?:ZONA|ELENCO|ITINERARIO)|PORTALETTERE\s*:|CAP\s*:)/i.test(t)) {
    return true;
  }
  return false;
}

export function joinAddressFragments(existing: string, fragment: string, insertCommaIfComune = false): string {
  const base = existing.replace(/\s+/g, ' ').trim();
  const add = fragment.replace(/\s+/g, ' ').trim();
  if (!base) return add;
  if (!add) return base;

  if (/^[,.;:)]/.test(add)) {
    return `${base}${add}`.replace(/\s+/g, ' ').trim();
  }

  // Parola spezzata con trattino alfabetico a fine riga (es. "CASTEL-" + "NUOVO")
  if (/[A-Za-zÀ-ÖØ-öø-ÿ]-$/.test(base) && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(add)) {
    return `${base.slice(0, -1)}${add}`.replace(/\s+/g, ' ').trim();
  }

  // Apostrofo finale (es. "SANT'" + "ANGELO")
  if (/[’'`]$/.test(base) && /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(add)) {
    return `${base}${add}`.replace(/\s+/g, ' ').trim();
  }

  if (insertCommaIfComune && !base.endsWith(',')) {
    return `${base}, ${add}`.replace(/\s+/g, ' ').trim();
  }

  return `${base} ${add}`.replace(/\s+/g, ' ').trim();
}

export function analyzeAddressCompleteness(rawAddress: string): {
  isComplete: boolean;
  hasComma: boolean;
  comuneAfterComma: string;
  needsContinuation: boolean;
  looksReadyForComune: boolean;
} {
  const clean = rawAddress.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return {
      isComplete: false,
      hasComma: false,
      comuneAfterComma: '',
      needsContinuation: true,
      looksReadyForComune: false,
    };
  }

  // Finisce con virgola o trattino
  if (/[,;:-]\s*$/.test(clean)) {
    return {
      isComplete: false,
      hasComma: clean.includes(','),
      comuneAfterComma: '',
      needsContinuation: true,
      looksReadyForComune: false,
    };
  }

  const lastCommaIdx = clean.lastIndexOf(',');
  const hasComma = lastCommaIdx !== -1;
  const streetPart = hasComma ? clean.slice(0, lastCommaIdx).trim() : clean;
  const comuneAfterComma = hasComma ? clean.slice(lastCommaIdx + 1).trim() : '';

  // E' solo un prefisso stradale (es. "VIA", "VIA PRIVATA"), "VIA 25", oppure finisce con preposizione/nome incompleto (es. "VIA PAPA", "VIA PRIMO")
  const streetTokensOnly = streetPart.split(/\s+/).filter(Boolean);
  const isBareTypePlusNumberOnly =
    streetTokensOnly.length === 2 &&
    STREET_STARTER_REGEX.test(streetTokensOnly[0]) &&
    /^\d{1,2}$/.test(streetTokensOnly[1]);

  if (
    BARE_STREET_PREFIX_REGEX.test(streetPart) ||
    isBareTypePlusNumberOnly ||
    INCOMPLETE_TRAILING_WORD_REGEX.test(streetPart)
  ) {
    return {
      isComplete: false,
      hasComma,
      comuneAfterComma,
      needsContinuation: true,
      looksReadyForComune: false,
    };
  }

  const hasCivicoOrRange =
    /\b(?:\d{1,4}(?:\s*-\s*\d{1,4}|\s*\/\s*[A-Z0-9]{1,3}|[A-Z]{1,2})?|S\.?\s*N\.?\s*C\.?)\b/i.test(
      streetPart
    );

  // Ha una virgola ma la parte comune sembra vuota o troncata (es. "CASTIRAGA", "SANT'ANGELO", "VILLANOVA DEL")
  if (hasComma) {
    const comuneWords = comuneAfterComma.split(/\s+/).filter(Boolean);
    const endsWithConnector =
      /\b(?:DEL|DELLA|DELLO|DEI|DEGLI|SUL|SULLA|NEL|NELLA|DI|DA|A|IN|SAN|SANTA|SANTO|SANT'|BORGO|PIEVE|CASALETTO|CASTIRAGA|VILLANOVA|SANT'ANGELO)\s*$/i.test(
        comuneAfterComma
      );
    const needsMoreComune = comuneWords.length === 0 || endsWithConnector;
    return {
      isComplete: !needsMoreComune && hasCivicoOrRange,
      hasComma: true,
      comuneAfterComma,
      needsContinuation: needsMoreComune,
      looksReadyForComune: false,
    };
  }

  // Nessuna virgola ancora: manca il Comune!
  return {
    isComplete: false,
    hasComma: false,
    comuneAfterComma: '',
    needsContinuation: true,
    looksReadyForComune: hasCivicoOrRange,
  };
}

function isPureComuneContinuation(line: string): boolean {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2 || t.length > 48) return false;
  if (/\d/.test(t)) return false;
  if (STREET_STARTER_REGEX.test(t)) return false;
  if (isPageNoiseLine(t)) return false;
  // Evita frasi di servizio (Orario, Portiere, No, Si)
  if (/^(?:NO|SI|SÌ|NESSUNO|PORTIERE|-)$/i.test(t)) return false;
  return /^[A-ZÀÈÉÌÒÙ'’.\s-]+$/i.test(t);
}

interface TablePageParseResult {
  rows: RawExtractedRow[];
  lastRow: RawExtractedRow | null;
  linesRead: number;
  multiLineMerges: number;
  crossPageMerges: number;
  incompleteComuneMerges: number;
  reachedStopSection: boolean;
  discarded: PdfDiscardedRecord[];
}

export function parsePosteTablePage(
  items: PdfTextItem[],
  layout: ColumnLayout,
  pageNumber: number,
  hasHeaderOnThisPage: boolean,
  defaultZone: string,
  previousRow: RawExtractedRow | null
): TablePageParseResult {
  const lines = groupItemsIntoLines(items, 4.5);
  const pageRows: RawExtractedRow[] = [];
  const discarded: PdfDiscardedRecord[] = [];
  let currentRow: RawExtractedRow | null = null;
  let startedNewRowOnPage = false;
  let linesRead = 0;
  let multiLineMerges = 0;
  let crossPageMerges = 0;
  let incompleteComuneMerges = 0;
  let reachedStopSection = false;

  for (const line of lines) {
    const joinedLine = line.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (!joinedLine) continue;

    if (STOP_SECTION_REGEX.test(joinedLine)) {
      reachedStopSection = true;
      break;
    }

    linesRead++;
    if (isPageNoiseLine(joinedLine)) continue;

    // Solo sulle pagine dove compare l'intestazione tabella scartiamo le parole dell'intestazione stessa
    if (
      hasHeaderOnThisPage &&
      line.y >= layout.headerBottomY &&
      /Sub|zona|Prog|Indirizzo|Orario|Portiere|Abitazioni|Cassetta|Presente|Scala|Note|GC/i.test(
        joinedLine
      )
    ) {
      continue;
    }

    const subTokens: string[] = [];
    const progTokens: string[] = [];
    const indTokens: string[] = [];
    const noteTokens: string[] = [];
    const scalaTokens: string[] = [];

    for (const item of line.items) {
      const s = item.str.trim();
      if (!s) continue;

      if (item.x <= layout.subzonaMaxX) {
        // A volte Subzona e Prog sono uniti in un item: "A 14"
        const combinedSubProg = s.match(/^([A-Z0-9]{1,3})\s+(\d{1,5})$/i);
        if (combinedSubProg && !NON_SUBZONA_KEYWORDS.has(combinedSubProg[1].toUpperCase())) {
          subTokens.push(combinedSubProg[1]);
          progTokens.push(combinedSubProg[2]);
        } else if (
          /^(?=.*[A-Z0-9])[A-Z0-9]{1,4}$/i.test(s) &&
          !NON_SUBZONA_KEYWORDS.has(s.toUpperCase())
        ) {
          subTokens.push(s);
        } else {
          // Testo lungo o parola indirizzo spostata a sinistra
          indTokens.push(s);
        }
      } else if (item.x >= layout.progMinX && item.x <= layout.progMaxX) {
        // Se nella colonna Prog c'è "14 VIA PAPA", separa numero e indirizzo
        const combinedProgInd = s.match(/^(\d{1,5})\s+(.+)$/);
        if (combinedProgInd) {
          progTokens.push(combinedProgInd[1]);
          indTokens.push(combinedProgInd[2]);
        } else if (/^\d{1,5}$/.test(s)) {
          progTokens.push(s);
        } else {
          // Testo alfabetico a cavallo tra Prog e Indirizzo appartiene all'Indirizzo!
          indTokens.push(s);
        }
      } else if (item.x >= layout.indirizzoMinX && item.x < layout.indirizzoMaxX) {
        indTokens.push(s);
      } else if (
        layout.noteMinX !== undefined &&
        layout.noteMaxX !== undefined &&
        item.x >= layout.noteMinX &&
        item.x <= layout.noteMaxX
      ) {
        noteTokens.push(s);
      } else if (
        layout.scalaMinX !== undefined &&
        layout.scalaMaxX !== undefined &&
        item.x >= layout.scalaMinX &&
        item.x <= layout.scalaMaxX
      ) {
        scalaTokens.push(s);
      }
    }

    let subVal = subTokens.join('').toUpperCase().trim();
    const progVal = progTokens.join('').trim();
    const indVal = indTokens.join(' ').replace(/\s+/g, ' ').trim();
    const noteVal = noteTokens.join(' ').replace(/\s+/g, ' ').trim();
    const scalaVal = scalaTokens.join(' ').replace(/\s+/g, ' ').trim();

    const validSubFormat =
      /^(?=.*[A-Z])[A-Z0-9]{1,4}$/.test(subVal) && !NON_SUBZONA_KEYWORDS.has(subVal);
    const validProgFormat = /^\d{1,5}$/.test(progVal);

    // Se Subzona è vuota ma c'è un Progressivo numerico + Indirizzo e conosciamo già la Subzona precedente, eredita Subzona
    if (!subVal && validProgFormat && indVal && (currentRow || previousRow)) {
      subVal = (currentRow ?? previousRow)!.subzona;
    }

    const isNewRowHeader =
      (validSubFormat || (/^(?=.*[A-Z])[A-Z0-9]{1,4}$/.test(subVal) && validProgFormat)) &&
      validProgFormat;

    if (isNewRowHeader) {
      startedNewRowOnPage = true;
      currentRow = {
        zona: defaultZone,
        subzona: subVal || 'A',
        prog: progVal,
        rawAddress: indVal,
        hintComune: '',
        note: noteVal,
        scala: scalaVal,
        startPage: pageNumber,
        lineCount: 1,
        crossPageMerged: false,
        incompleteComuneMerged: false,
      };
      pageRows.push(currentRow);
    } else if (!startedNewRowOnPage && previousRow) {
      // Continuazione a cavallo di pagina! (es. "GIOVANNI PAOLO I 15" o "MAGGIO 12" o "VIDARDO" in cima alla pagina successiva)
      if (indVal) {
        const beforeState = analyzeAddressCompleteness(previousRow.rawAddress);
        const shouldInsertComma = beforeState.looksReadyForComune && isPureComuneContinuation(indVal);
        previousRow.rawAddress = joinAddressFragments(previousRow.rawAddress, indVal, shouldInsertComma);
        previousRow.lineCount++;
        previousRow.crossPageMerged = true;
        crossPageMerges++;
        if (beforeState.needsContinuation && (beforeState.hasComma || shouldInsertComma)) {
          previousRow.incompleteComuneMerged = true;
          incompleteComuneMerges++;
        }
      }
      if (noteVal) {
        previousRow.note = `${previousRow.note} ${noteVal}`.replace(/\s+/g, ' ').trim();
      }
      if (scalaVal && !previousRow.scala) {
        previousRow.scala = scalaVal;
      }
    } else if (currentRow) {
      // Continuazione multi-riga nella stessa cella/riga successiva
      if (indVal) {
        const beforeState = analyzeAddressCompleteness(currentRow.rawAddress);
        const shouldInsertComma = beforeState.looksReadyForComune && isPureComuneContinuation(indVal);
        currentRow.rawAddress = joinAddressFragments(currentRow.rawAddress, indVal, shouldInsertComma);
        currentRow.lineCount++;
        multiLineMerges++;
        if (beforeState.needsContinuation && (beforeState.hasComma || shouldInsertComma)) {
          currentRow.incompleteComuneMerged = true;
          incompleteComuneMerges++;
        }
      }
      if (noteVal) {
        currentRow.note = `${currentRow.note} ${noteVal}`.replace(/\s+/g, ' ').trim();
      }
      if (scalaVal) {
        currentRow.scala = currentRow.scala
          ? `${currentRow.scala}, ${scalaVal}`
          : scalaVal;
      }
    } else if (indVal) {
      discarded.push({
        page: pageNumber,
        subzona: subVal || undefined,
        prog: progVal || undefined,
        rawText: joinedLine,
        reason: 'Riga senza intestazione Subzona/Progressivo e senza record precedente da completare.',
      });
    }
  }

  return {
    rows: pageRows,
    lastRow: currentRow ?? previousRow,
    linesRead,
    multiLineMerges,
    crossPageMerges,
    incompleteComuneMerges,
    reachedStopSection,
    discarded,
  };
}

export interface GenericStreamLine {
  page: number;
  text: string;
}

export interface GenericStreamResult {
  rows: RawExtractedRow[];
  linesRead: number;
  multiLineMerges: number;
  crossPageMerges: number;
  incompleteComuneMerges: number;
  discarded: PdfDiscardedRecord[];
}

/**
 * Ricostruzione multi-riga e multi-pagina basata su campi (Subzona, Progressivo, Indirizzo)
 * e verifica di completezza indirizzo/comune.
 */
export function reconstructGenericRecordStream(
  lines: GenericStreamLine[],
  defaultZone: string
): GenericStreamResult {
  const rows: RawExtractedRow[] = [];
  const discarded: PdfDiscardedRecord[] = [];
  let currentSubzone = 'A';
  let currentComune = '';
  let autoProg = 1;
  let currentRow: RawExtractedRow | null = null;
  let lastRowPage = 0;

  let linesRead = 0;
  let multiLineMerges = 0;
  let crossPageMerges = 0;
  let incompleteComuneMerges = 0;

  for (const entry of lines) {
    const line = entry.text.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (STOP_SECTION_REGEX.test(line)) {
      break;
    }

    linesRead++;
    if (isPageNoiseLine(line)) continue;

    // Intercetta intestazioni di subzona/comune es. "SUBZONA B - COMUNE DI CASTIRAGA VIDARDO"
    const subHeader = line.match(/\bSUB[\s-]*ZONA\s*:?\s*([A-Z0-9]{1,3})\b/i);
    if (subHeader && !ANY_STREET_KEYWORD_REGEX.test(line)) {
      currentSubzone = subHeader[1].toUpperCase();
    }
    const comuneHeader = line.match(/\bCOMUNE\s*(?:DI)?\s*:?\s*([A-Z'ÀÈÉÌÒÙ\s-]{3,40})$/i);
    if (comuneHeader && !ANY_STREET_KEYWORD_REGEX.test(line)) {
      currentComune = comuneHeader[1].trim();
      continue;
    }

    // 1. Verifica se la riga inizia un NUOVO record tramite campi:
    //    a) "[Zona][Subzona] [Prog?] [Indirizzo]" es. "4A 12 VIA PAPA" o "4 B VIA PRIMO"
    //    b) "[Subzona] [Prog] [Indirizzo]" es. "A 14 VIA PAPA" o "B 102 VIA PRIMO"
    //    c) "[Prog] [Indirizzo]" es. "14 VIA PAPA" (se già in subzona)
    let newZona = defaultZone;
    let newSubzona = currentSubzone;
    let newProg = '';
    let newAddressPart = '';
    let hasExplicitHeader = false;

    const zSubMatch = line.match(/^([0-9]{1,2})\s*([A-Z]{1,2})\s+(?:(\d{1,5})\s+)?(.+)$/);
    if (
      zSubMatch &&
      !NON_SUBZONA_KEYWORDS.has(zSubMatch[2].toUpperCase()) &&
      ANY_STREET_KEYWORD_REGEX.test(zSubMatch[4])
    ) {
      newZona = zSubMatch[1];
      newSubzona = zSubMatch[2].toUpperCase();
      currentSubzone = newSubzona;
      newProg = zSubMatch[3] || String(autoProg++);
      newAddressPart = zSubMatch[4].trim();
      hasExplicitHeader = true;
    } else {
      const subProgMatch = line.match(/^([A-Z]{1,3}|[0-9]{1,2}[A-Z]{1,2})\s+(\d{1,5})\s+(.+)$/);
      if (
        subProgMatch &&
        !NON_SUBZONA_KEYWORDS.has(subProgMatch[1].toUpperCase()) &&
        !/^(?:GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)$/i.test(
          subProgMatch[3].split(/\s+/)[0] || ''
        )
      ) {
        newSubzona = subProgMatch[1].toUpperCase();
        currentSubzone = newSubzona;
        newProg = subProgMatch[2];
        newAddressPart = subProgMatch[3].trim();
        hasExplicitHeader = true;
      } else {
        const progOnlyMatch = line.match(/^(\d{1,5})\s+(.+)$/);
        if (progOnlyMatch && STREET_STARTER_REGEX.test(progOnlyMatch[2])) {
          newProg = progOnlyMatch[1];
          newAddressPart = progOnlyMatch[2].trim();
          hasExplicitHeader = true;
        }
      }
    }

    // 2. Se NON ha intestazione esplicita (Subzona/Prog), controlla se la riga precedente è incompleta
    //    oppure se questa riga NON inizia una nuova via (es. "GIOVANNI PAOLO I 15", "MAGGIO 12", "VIDARDO")
    if (!hasExplicitHeader && currentRow) {
      const prevState = analyzeAddressCompleteness(currentRow.rawAddress);
      const startsNewStreet = STREET_STARTER_REGEX.test(line);

      // Se la riga precedente terminava esattamente su un prefisso stradale puro (es. "VIA" + "PROVINCIALE 12")
      // o è un frammento di continuazione (senza nuovo prefisso stradale), uniscila sempre!
      const prevEndsBareType = BARE_STREET_PREFIX_REGEX.test(currentRow.rawAddress.trim());
      const shouldMergeAsContinuation =
        !startsNewStreet || prevEndsBareType;

      if (shouldMergeAsContinuation && line.length >= 2) {
        const isComunePart = isPureComuneContinuation(line);
        const shouldInsertComma = prevState.looksReadyForComune && isComunePart;
        currentRow.rawAddress = joinAddressFragments(
          currentRow.rawAddress,
          line,
          shouldInsertComma
        );
        currentRow.lineCount++;

        if (entry.page > lastRowPage) {
          currentRow.crossPageMerged = true;
          crossPageMerges++;
        } else {
          multiLineMerges++;
        }

        if (prevState.needsContinuation && (prevState.hasComma || shouldInsertComma || isComunePart)) {
          currentRow.incompleteComuneMerged = true;
          incompleteComuneMerges++;
        }

        lastRowPage = entry.page;
        continue;
      }
    }

    // 3. Se la riga inizia direttamente con un tipo stradale (es. "VIA ROMA 10, CASTIRAGA VIDARDO")
    if (!hasExplicitHeader && STREET_STARTER_REGEX.test(line)) {
      newProg = String(autoProg++);
      newAddressPart = line;
      hasExplicitHeader = true;
    }

    if (hasExplicitHeader && newAddressPart) {
      // Eventuale suffisso tabella in coda es. "... 2B"
      const trailingSub = newAddressPart.match(/^(.+?)\s+(?:ZONA\s+)?([0-9]{0,2})([A-Z])$/i);
      if (
        trailingSub &&
        trailingSub[1].length > 8 &&
        !/\b(?:BIS|TER|QUATER|SCALA|I|V|X)\b/i.test(trailingSub[3]) &&
        !/,\s*[A-Z'ÀÈÉÌÒÙ\s]+$/i.test(newAddressPart)
      ) {
        if (trailingSub[2]) newZona = trailingSub[2];
        newSubzona = trailingSub[3].toUpperCase();
        newAddressPart = trailingSub[1].trim();
      }

      currentRow = {
        zona: newZona,
        subzona: newSubzona,
        prog: newProg,
        rawAddress: newAddressPart,
        hintComune: currentComune,
        note: '',
        scala: '',
        startPage: entry.page,
        lineCount: 1,
        crossPageMerged: false,
        incompleteComuneMerged: false,
      };
      rows.push(currentRow);
      lastRowPage = entry.page;
    } else if (line.length >= 2) {
      discarded.push({
        page: entry.page,
        rawText: line,
        reason: 'Riga non riconducibile a Subzona/Progressivo/Indirizzo né a continuazione di un record aperto.',
      });
    }
  }

  return {
    rows,
    linesRead,
    multiLineMerges,
    crossPageMerges,
    incompleteComuneMerges,
    discarded,
  };
}

async function renderPageToCanvas(page: pdfjsLib.PDFPageProxy, scale = 2.0): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D non disponibile');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

async function tryServerAiOcr(
  canvas: HTMLCanvasElement,
  defaultZone: string,
  pageNumber: number
): Promise<RawExtractedRow[] | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    const resp = await fetch('/api/ocr/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: dataUrl,
        mimeType: 'image/jpeg',
        defaultZone,
      }),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok || !contentType.includes('application/json')) return null;
    const data = await resp.json();
    if (!Array.isArray(data?.rows)) return null;
    return data.rows
      .filter((r: { indirizzoCompleto?: string }) => typeof r?.indirizzoCompleto === 'string' && r.indirizzoCompleto.trim())
      .map((r: {
        zona?: string;
        subzona?: string;
        prog?: string;
        indirizzoCompleto: string;
        comune?: string;
        note?: string;
        scala?: string;
      }, idx: number) => ({
        zona: (r.zona || data.detectedZone || defaultZone || '1').trim(),
        subzona: (r.subzona || 'A').trim().toUpperCase(),
        prog: (r.prog || String(idx + 1)).trim(),
        rawAddress: r.indirizzoCompleto.trim(),
        hintComune: (r.comune || '').trim(),
        note: (r.note || '').trim(),
        scala: (r.scala || '').trim(),
        startPage: pageNumber,
        lineCount: 1,
        crossPageMerged: false,
        incompleteComuneMerged: false,
      }));
  } catch {
    return null;
  }
}

export async function extractPdfToCenterRecords(options: {
  centerId: string;
  fileName: string;
  buffer: ArrayBuffer;
  preferAiOcr?: boolean;
  onProgress?: (progress: ExtractionProgress) => void;
}): Promise<PdfExtractionResult> {
  const { centerId, fileName, buffer, preferAiOcr = false, onProgress } = options;
  const pdfId = crypto.randomUUID();
  const clonedData = new Uint8Array(buffer.slice(0));

  onProgress?.({
    fileName,
    stage: 'reading',
    currentPage: 0,
    totalPages: 0,
    extractedSoFar: 0,
    message: 'Apertura documento PDF...',
  });

  const loadingTask = pdfjsLib.getDocument({ data: clonedData });
  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;

  // Rilevamento rapido metadati dalle prime 4 pagine
  const headerSamples: string[] = [];
  for (let p = 1; p <= Math.min(4, totalPages); p++) {
    const page = await pdfDoc.getPage(p);
    const tc = await page.getTextContent();
    const txt = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    headerSamples.push(txt);
  }
  const { zone: defaultZone, frazionario } = detectZoneFromTextAndName(headerSamples, fileName);

  const posteRows: RawExtractedRow[] = [];
  const genericStreamLines: GenericStreamLine[] = [];
  const aiOcrRows: RawExtractedRow[] = [];

  let activePosteLayout: ColumnLayout | null = null;
  let inItinerarioSection = false;
  let lastRowRef: RawExtractedRow | null = null;
  let ocrPagesCount = 0;
  let nativePagesCount = 0;
  let usedAiOcr = false;
  let usedPosteTable = false;
  let usedGenericLines = false;

  let posteLinesRead = 0;
  let posteMultiLineMerges = 0;
  let posteCrossPageMerges = 0;
  let posteIncompleteComuneMerges = 0;
  const discardedRecords: PdfDiscardedRecord[] = [];

  // Worker Tesseract creato solo se necessario per pagine scansionate
  let tesseractWorker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;

  try {
    for (let p = 1; p <= totalPages; p++) {
      const page = await pdfDoc.getPage(p);
      const tc = await page.getTextContent();

      const items: PdfTextItem[] = [];
      let rawCharCount = 0;
      for (const it of tc.items) {
        if ('str' in it && it.str) {
          const trimmed = it.str.trim();
          rawCharCount += trimmed.length;
          items.push({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            width: it.width,
          });
        }
      }

      const fullPageText = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();

      // Caso 1: Pagina scansionata / immagine senza testo selezionabile
      if (rawCharCount < 35) {
        ocrPagesCount++;
        onProgress?.({
          fileName,
          stage: 'ocr',
          currentPage: p,
          totalPages,
          extractedSoFar: posteRows.length + aiOcrRows.length,
          message: `OCR pagina ${p} di ${totalPages}...`,
        });

        const canvas = await renderPageToCanvas(page, 2.0);
        let ocrRows: RawExtractedRow[] | null = null;

        if (preferAiOcr) {
          ocrRows = await tryServerAiOcr(canvas, defaultZone, p);
          if (ocrRows && ocrRows.length > 0) {
            usedAiOcr = true;
            aiOcrRows.push(...ocrRows);
          }
        }

        if (!ocrRows) {
          if (!tesseractWorker) {
            const { createWorker } = await import('tesseract.js');
            tesseractWorker = await createWorker('ita');
          }
          const {
            data: { text },
          } = await tesseractWorker.recognize(canvas);
          usedGenericLines = true;
          for (const textLine of text.split(/\r?\n/)) {
            const clean = textLine.replace(/\s+/g, ' ').trim();
            if (clean) {
              genericStreamLines.push({ page: p, text: clean });
            }
          }
        }
        continue;
      }

      nativePagesCount++;

      // Controlla se questa pagina inaugura o ripete la tabella "Itinerario di Gita"
      const detectedLayout = detectPosteColumnLayout(items);
      const hasHeaderOnThisPage = Boolean(detectedLayout);
      if (detectedLayout) {
        activePosteLayout = detectedLayout;
        inItinerarioSection = true;
      }

      if (inItinerarioSection && activePosteLayout) {
        usedPosteTable = true;
        const pageResult = parsePosteTablePage(
          items,
          activePosteLayout,
          p,
          hasHeaderOnThisPage,
          defaultZone,
          lastRowRef
        );
        posteRows.push(...pageResult.rows);
        lastRowRef = pageResult.lastRow;
        posteLinesRead += pageResult.linesRead;
        posteMultiLineMerges += pageResult.multiLineMerges;
        posteCrossPageMerges += pageResult.crossPageMerges;
        posteIncompleteComuneMerges += pageResult.incompleteComuneMerges;
        if (pageResult.discarded.length > 0) {
          discardedRecords.push(...pageResult.discarded);
        }
        if (pageResult.reachedStopSection) {
          break;
        }
      } else if (!inItinerarioSection) {
        // Se la pagina inizia subito una sezione successiva (es. senza Itinerario di Gita) ma non è copertina
        if (STOP_SECTION_REGEX.test(fullPageText) && p > 4 && genericStreamLines.length > 0) {
          break;
        }

        // Salta pagine iniziali di copertina/indice/info generali di Poste Italiane
        const isCoverOrIndex =
          /Libretto\s+di\s+Gita|Informazioni\s+generali\s+di\s+zona|1\.\s+Informazioni\s+generali|Distanze\s+Chilometriche/i.test(
            fullPageText
          );
        if (!isCoverOrIndex && p >= 2) {
          usedGenericLines = true;
          const lines = groupItemsIntoLines(items, 4.5);
          for (const l of lines) {
            const txt = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
            if (txt) {
              genericStreamLines.push({ page: p, text: txt });
            }
          }
        }
      }

      if (p % 4 === 0 || p === totalPages) {
        onProgress?.({
          fileName,
          stage: 'analyzing',
          currentPage: p,
          totalPages,
          extractedSoFar: posteRows.length + genericStreamLines.length,
          message: `Analisi pagina ${p} di ${totalPages} (${posteRows.length || genericStreamLines.length} elementi)...`,
        });
        // Cede il thread principale per mantenere UI fluida su smartphone
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    if (tesseractWorker) {
      await tesseractWorker.terminate();
    }
  }

  // Ricostruisci in un unico stream cross-pagina tutte le righe non-tabellari / OCR
  const genericResult =
    genericStreamLines.length > 0
      ? reconstructGenericRecordStream(genericStreamLines, defaultZone)
      : {
          rows: [],
          linesRead: 0,
          multiLineMerges: 0,
          crossPageMerges: 0,
          incompleteComuneMerges: 0,
          discarded: [],
        };

  if (genericResult.discarded.length > 0) {
    discardedRecords.push(...genericResult.discarded);
  }

  const rawRows: RawExtractedRow[] = [...posteRows, ...genericResult.rows, ...aiOcrRows];

  onProgress?.({
    fileName,
    stage: 'indexing',
    currentPage: totalPages,
    totalPages,
    extractedSoFar: rawRows.length,
    message: `Normalizzazione e indicizzazione di ${rawRows.length} record...`,
  });

  const addresses: AddressRecord[] = [];
  const dedupeSeen = new Set<string>();

  for (const row of rawRows) {
    const cleanAddr = row.rawAddress.replace(/\s+/g, ' ').trim();
    if (!cleanAddr || cleanAddr.length < 3) {
      discardedRecords.push({
        page: row.startPage,
        subzona: row.subzona,
        prog: row.prog,
        rawText: cleanAddr || '(vuoto)',
        reason: 'Indirizzo vuoto o troppo corto (< 3 caratteri) anche dopo unione righe.',
      });
      continue;
    }

    const parsed = parseAddressString(cleanAddr, row.hintComune);
    if (!parsed.nomeStradaNorm) {
      discardedRecords.push({
        page: row.startPage,
        subzona: row.subzona,
        prog: row.prog,
        rawText: cleanAddr,
        reason: 'Nome strada assente dopo normalizzazione indirizzo.',
      });
      continue;
    }

    // Chiave di deduplicazione: include frazione per non collassare località omonime senza civico
    const dedupeKey = `${row.zona}|${row.subzona}|${parsed.comuneNorm}|${parsed.frazione}|${parsed.tipoStradaNorm}|${parsed.nomeStradaNorm}|${parsed.civico.civicoRaw}|${row.scala}`;
    if (dedupeSeen.has(dedupeKey)) {
      discardedRecords.push({
        page: row.startPage,
        subzona: row.subzona,
        prog: row.prog,
        rawText: cleanAddr,
        reason: `Duplicato esatto nella stessa Zona/Subzona (${row.zona}${row.subzona}).`,
      });
      continue;
    }
    dedupeSeen.add(dedupeKey);

    addresses.push({
      id: crypto.randomUUID(),
      centerId,
      pdfId,
      zona: row.zona || defaultZone,
      subzona: (row.subzona || 'A').toUpperCase(),
      prog: row.prog,
      comune: normalizeBaseText(parsed.comune) || 'SCONOSCIUTO',
      comuneNorm: parsed.comuneNorm,
      frazione: parsed.frazione,
      tipoStrada: parsed.tipoStrada,
      tipoStradaNorm: parsed.tipoStradaNorm,
      nomeStrada: parsed.nomeStrada,
      nomeStradaNorm: parsed.nomeStradaNorm,
      nomeTokens: parsed.nomeTokens,
      civicoRaw: parsed.civico.civicoRaw,
      civicoNum: parsed.civico.civicoNum,
      civicoSuffix: parsed.civico.civicoSuffix,
      civicoStart: parsed.civico.civicoStart,
      civicoEnd: parsed.civico.civicoEnd,
      parity: parsed.civico.parity,
      isSnc: parsed.civico.isSnc,
      scala: row.scala,
      note: row.note,
      rawAddress: cleanAddr,
    });
  }

  let extractionMethod: PdfExtractionMethod = 'native';
  if (usedAiOcr) extractionMethod = 'ai';
  else if (ocrPagesCount > 0 && nativePagesCount > 0) extractionMethod = 'hybrid';
  else if (ocrPagesCount > 0) extractionMethod = 'ocr';

  const multiLineMerges = posteMultiLineMerges + genericResult.multiLineMerges;
  const crossPageMerges = posteCrossPageMerges + genericResult.crossPageMerges;
  const incompleteComuneMerges =
    posteIncompleteComuneMerges + genericResult.incompleteComuneMerges;
  const reconstructedRowsCount = rawRows.filter(
    (r) => r.lineCount > 1 || r.crossPageMerged || r.incompleteComuneMerged
  ).length;

  let parserModeUsed: PdfExtractionDebugStats['parserModeUsed'] = 'poste-table';
  if (usedPosteTable && usedGenericLines) parserModeUsed = 'mixed';
  else if (usedGenericLines && ocrPagesCount > 0) parserModeUsed = 'ocr';
  else if (usedGenericLines) parserModeUsed = 'generic-multiline';

  const debugStats: PdfExtractionDebugStats = {
    fileName,
    linesRead: posteLinesRead + genericResult.linesRead,
    linesReconstructed: Math.max(reconstructedRowsCount, multiLineMerges + crossPageMerges),
    multiLineMerges,
    crossPageMerges,
    incompleteComuneMerges,
    validAddressesExtracted: addresses.length,
    discardedCount: discardedRecords.length,
    discardedRecords: discardedRecords.slice(0, 150),
    parserModeUsed,
  };

  let fileHash = '';
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0));
      fileHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      fileHash = '';
    }
  }

  const pdfRecord: PdfDocumentRecord = {
    id: pdfId,
    centerId,
    fileName,
    fileHash,
    zoneNumber: defaultZone,
    frazionario,
    fileSize: buffer.byteLength,
    pageCount: totalPages,
    extractedCount: addresses.length,
    extractionMethod,
    importedAt: Date.now(),
  };

  return { pdfRecord, addresses, debugStats };
}
