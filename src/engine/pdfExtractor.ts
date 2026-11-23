import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  AddressRecord,
  ExtractionProgress,
  PdfDocumentRecord,
  PdfExtractionMethod,
} from '../types/sorting';
import { normalizeBaseText, parseAddressString } from './normalizer';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

interface RawExtractedRow {
  zona: string;
  subzona: string;
  prog: string;
  rawAddress: string;
  hintComune: string;
  note: string;
  scala: string;
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
}

const STOP_SECTION_REGEX =
  /(?:Progressivo\s+Indirizzo\s+Tipo|Itinerario\s+Appoggi|Itinerario\s+Vuotatura|Elenco\s+Cassette|Chi\s+Svuota|Codice\s+Cassetta|Cliente\s+Indirizzo\s+Cliente|Tipo\s+Ufficio|Domande\s+attive|Domande\s+chiuse|Nome\s+Cognome\/\s*Ragione\s+Sociale|Indirizzo\s+Seguimi|Rubrica\s*$)/i;

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

function groupItemsIntoLines(items: PdfTextItem[], yTolerance = 4): Array<{ y: number; items: PdfTextItem[] }> {
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
    line.items.sort((a, b) => (Math.abs(a.x - b.x) <= 8 ? b.y - a.y : a.x - b.x));
  }
  return lines;
}

function isPosteHeaderText(text: string): boolean {
  return (
    /\bSub\b/i.test(text) &&
    /\bzona\b/i.test(text) &&
    /\bProg\.?/i.test(text) &&
    /\bIndirizzo\b/i.test(text)
  );
}

function detectPosteColumnLayout(items: PdfTextItem[]): ColumnLayout | null {
  const lines = groupItemsIntoLines(items, 12);
  for (const line of lines) {
    const lineText = line.items.map((i) => i.str).join(' ');
    if (isPosteHeaderText(lineText)) {
      const findX = (re: RegExp) => line.items.find((i) => re.test(i.str))?.x;

      const subX = findX(/^Sub$/i) ?? 30;
      const progX = findX(/Prog/i) ?? subX + 22;
      const indX = findX(/Indirizzo/i) ?? progX + 24;
      const orarioX = findX(/Orario|Portiere|Tipo/i) ?? indX + 68;
      const noteX = findX(/^Note$/i);
      const scalaX = findX(/^Scala$/i);
      const gcX = findX(/^GC$/i);

      return {
        subzonaMaxX: (subX + progX) / 2 + 2,
        progMinX: (subX + progX) / 2,
        progMaxX: (progX + indX) / 2 + 2,
        indirizzoMinX: (progX + indX) / 2,
        indirizzoMaxX: orarioX - 6,
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

function isPageNoiseLine(lineText: string): boolean {
  const t = lineText.trim();
  if (!t) return true;
  if (/^Pag\.\s*\d+\/\d+$/i.test(t)) return true;
  if (/Frazionario\s*:\s*\d+.*Zona\s*:/i.test(t)) return true;
  if (/Data\s+Ultima\s+Variazione/i.test(t)) return true;
  if (isPosteHeaderText(t)) return true;
  return false;
}

function parsePosteTablePage(
  items: PdfTextItem[],
  layout: ColumnLayout,
  defaultZone: string,
  previousRow: RawExtractedRow | null
): { rows: RawExtractedRow[]; lastRow: RawExtractedRow | null } {
  const lines = groupItemsIntoLines(items, 4);
  const pageRows: RawExtractedRow[] = [];
  let currentRow: RawExtractedRow | null = null;
  let startedNewRowOnPage = false;

  for (const line of lines) {
    const joinedLine = line.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (isPageNoiseLine(joinedLine)) continue;

    // Ignora parti dell'intestazione tabella stessa
    if (line.y >= layout.headerBottomY && /Orario|Portiere|Abitazioni|Cassetta|Presente/i.test(joinedLine)) {
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
        subTokens.push(s);
      } else if (item.x >= layout.progMinX && item.x <= layout.progMaxX) {
        progTokens.push(s);
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

    const subVal = subTokens.join('').toUpperCase().trim();
    const progVal = progTokens.join('').trim();
    const indVal = indTokens.join(' ').replace(/\s+/g, ' ').trim();
    const noteVal = noteTokens.join(' ').replace(/\s+/g, ' ').trim();
    const scalaVal = scalaTokens.join(' ').replace(/\s+/g, ' ').trim();

    const isNewRowHeader = /^[A-Z]{1,3}$/.test(subVal) && /^\d{1,5}$/.test(progVal);

    if (isNewRowHeader) {
      startedNewRowOnPage = true;
      currentRow = {
        zona: defaultZone,
        subzona: subVal,
        prog: progVal,
        rawAddress: indVal,
        hintComune: '',
        note: noteVal,
        scala: scalaVal,
      };
      pageRows.push(currentRow);
    } else if (!startedNewRowOnPage && previousRow) {
      // Continuazione a cavallo di pagina! (es. "LODIGIANO" o "DEL TERRORISMO 15, SANT'ANGELO LODIGIANO" in cima alla pagina successiva)
      if (indVal) {
        previousRow.rawAddress = `${previousRow.rawAddress} ${indVal}`.replace(/\s+/g, ' ').trim();
      }
      if (noteVal) {
        previousRow.note = `${previousRow.note} ${noteVal}`.replace(/\s+/g, ' ').trim();
      }
      if (scalaVal && !previousRow.scala) {
        previousRow.scala = scalaVal;
      }
    } else if (currentRow) {
      // Continuazione multi-riga nella stessa cella
      if (indVal) {
        currentRow.rawAddress = `${currentRow.rawAddress} ${indVal}`.replace(/\s+/g, ' ').trim();
      }
      if (noteVal) {
        currentRow.note = `${currentRow.note} ${noteVal}`.replace(/\s+/g, ' ').trim();
      }
      if (scalaVal) {
        currentRow.scala = currentRow.scala
          ? `${currentRow.scala}, ${scalaVal}`
          : scalaVal;
      }
    }
  }

  return {
    rows: pageRows,
    lastRow: currentRow ?? previousRow,
  };
}

/**
 * Parser adattivo per PDF con tabelle generiche o formato non standard Poste
 * (es. elenco testo, tabelle 3/4 colonne, intervalli civici 1-99 / 2-120 solo pari/dispari).
 */
function parseGenericLines(textLines: string[], defaultZone: string): RawExtractedRow[] {
  const rows: RawExtractedRow[] = [];
  let currentSubzone = 'A';
  let currentComune = '';
  let autoProg = 1;

  const streetStarterRegex =
    /\b(?:VIA|V\.LE|VIALE|PIAZZA|P\.ZZA|P\.ZA|PIAZZALE|CORSO|C\.SO|VICOLO|LARGO|STRADA|SP|SS|CASCINA|LOCALITA|LOC\.|FRAZIONE|FRAZ\.|BORGO|CONTRADA|SALITA)\b/i;

  for (const rawLine of textLines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 5 || isPageNoiseLine(line)) continue;

    // Intercetta eventuali intestazioni di subzona/comune es. "SUBZONA B - COMUNE DI LODI"
    const subHeader = line.match(/\bSUB[\s-]*ZONA\s*:?\s*([A-Z0-9]{1,3})\b/i);
    if (subHeader && !streetStarterRegex.test(line)) {
      currentSubzone = subHeader[1].toUpperCase();
    }
    const comuneHeader = line.match(/\bCOMUNE\s*(?:DI)?\s*:?\s*([A-Z'ÀÈÉÌÒÙ\s]{3,35})$/i);
    if (comuneHeader && !streetStarterRegex.test(line)) {
      currentComune = comuneHeader[1].trim();
      continue;
    }

    if (!streetStarterRegex.test(line)) continue;

    // Cerca prefisso "Zona Subzona" es. "2 B" o "2B" oppure "A 12 Via ..."
    let zona = defaultZone;
    let subzona = currentSubzone;
    let prog = String(autoProg++);
    let addressPart = line;

    const zSubPrefix = line.match(/^([0-9]{1,2})\s*([A-Z]{1,2})\s+(?:\d+\s+)?(.+)$/);
    if (zSubPrefix && streetStarterRegex.test(zSubPrefix[3])) {
      zona = zSubPrefix[1];
      subzona = zSubPrefix[2].toUpperCase();
      addressPart = zSubPrefix[3];
    } else {
      const subProgPrefix = line.match(/^([A-Z]{1,2})\s+(\d{1,5})\s+(.+)$/);
      if (subProgPrefix && streetStarterRegex.test(subProgPrefix[3])) {
        subzona = subProgPrefix[1].toUpperCase();
        prog = subProgPrefix[2];
        addressPart = subProgPrefix[3];
      }
    }

    // Eventuale suffisso tabella "| B" o "; 2B" in coda
    const trailingSub = addressPart.match(/^(.+?)\s+(?:ZONA\s+)?([0-9]{0,2})([A-Z])$/i);
    if (trailingSub && trailingSub[1].length > 8 && !/\b(?:BIS|TER|SCALA)\b/i.test(trailingSub[3])) {
      if (trailingSub[2]) zona = trailingSub[2];
      subzona = trailingSub[3].toUpperCase();
      addressPart = trailingSub[1].trim();
    }

    rows.push({
      zona,
      subzona,
      prog,
      rawAddress: addressPart,
      hintComune: currentComune,
      note: '',
      scala: '',
    });
  }

  return rows;
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
  defaultZone: string
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

  const rawRows: RawExtractedRow[] = [];
  let activePosteLayout: ColumnLayout | null = null;
  let inItinerarioSection = false;
  let lastRowRef: RawExtractedRow | null = null;
  let ocrPagesCount = 0;
  let nativePagesCount = 0;
  let usedAiOcr = false;

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

      // Se siamo già entrati in "Itinerario di Gita" e incontriamo una sezione successiva, terminiamo!
      if (inItinerarioSection && STOP_SECTION_REGEX.test(fullPageText)) {
        break;
      }

      // Caso 1: Pagina scansionata / immagine senza testo selezionabile
      if (rawCharCount < 35) {
        ocrPagesCount++;
        onProgress?.({
          fileName,
          stage: 'ocr',
          currentPage: p,
          totalPages,
          extractedSoFar: rawRows.length,
          message: `OCR pagina ${p} di ${totalPages}...`,
        });

        const canvas = await renderPageToCanvas(page, 2.0);
        let ocrRows: RawExtractedRow[] | null = null;

        if (preferAiOcr) {
          ocrRows = await tryServerAiOcr(canvas, defaultZone);
          if (ocrRows && ocrRows.length > 0) {
            usedAiOcr = true;
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
          const textLines = text.split(/\r?\n/);
          ocrRows = parseGenericLines(textLines, defaultZone);
        }

        if (ocrRows.length > 0) {
          rawRows.push(...ocrRows);
          lastRowRef = ocrRows[ocrRows.length - 1];
        }
        continue;
      }

      nativePagesCount++;

      // Controlla se questa pagina inaugura la tabella "Itinerario di Gita"
      const detectedLayout = detectPosteColumnLayout(items);
      if (detectedLayout) {
        activePosteLayout = detectedLayout;
        inItinerarioSection = true;
      }

      if (inItinerarioSection && activePosteLayout) {
        const { rows, lastRow } = parsePosteTablePage(
          items,
          activePosteLayout,
          defaultZone,
          lastRowRef
        );
        rawRows.push(...rows);
        lastRowRef = lastRow;
      } else if (!inItinerarioSection) {
        // Salta pagine iniziali di copertina/indice/info generali di Poste Italiane
        const isCoverOrIndex =
          /Libretto\s+di\s+Gita|Informazioni\s+generali\s+di\s+zona|1\.\s+Informazioni\s+generali/i.test(
            fullPageText
          );
        if (!isCoverOrIndex && p >= 2) {
          const lines = groupItemsIntoLines(items, 4).map((l) =>
            l.items.map((i) => i.str).join(' ')
          );
          const generic = parseGenericLines(lines, defaultZone);
          if (generic.length > 0) {
            rawRows.push(...generic);
            lastRowRef = generic[generic.length - 1];
          }
        }
      }

      if (p % 4 === 0 || p === totalPages) {
        onProgress?.({
          fileName,
          stage: 'analyzing',
          currentPage: p,
          totalPages,
          extractedSoFar: rawRows.length,
          message: `Analisi pagina ${p} di ${totalPages} (${rawRows.length} indirizzi)...`,
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
    if (!cleanAddr || cleanAddr.length < 3) continue;

    const parsed = parseAddressString(cleanAddr, row.hintComune);
    if (!parsed.nomeStradaNorm) continue;

    // Chiave di deduplicazione per evitare duplicati inutili mantenendo però scale/civici distinti
    const dedupeKey = `${row.zona}|${row.subzona}|${parsed.comuneNorm}|${parsed.tipoStradaNorm}|${parsed.nomeStradaNorm}|${parsed.civico.civicoRaw}|${row.scala}`;
    if (dedupeSeen.has(dedupeKey)) continue;
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

  return { pdfRecord, addresses };
}
