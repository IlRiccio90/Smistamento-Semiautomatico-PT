export type CivicParity = 'all' | 'even' | 'odd';

export interface DeliveryCenter {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  pdfCount: number;
  addressCount: number;
  zones: string[];
  comuni: string[];
}

export type PdfExtractionMethod = 'native' | 'ocr' | 'hybrid' | 'ai';

export interface PdfDocumentRecord {
  id: string;
  centerId: string;
  fileName: string;
  zoneNumber: string;
  frazionario?: string;
  fileSize: number;
  pageCount: number;
  extractedCount: number;
  extractionMethod: PdfExtractionMethod;
  importedAt: number;
}

export interface AddressRecord {
  id: string;
  centerId: string;
  pdfId: string;
  zona: string;
  subzona: string;
  prog: string;
  comune: string;
  comuneNorm: string;
  frazione: string;
  tipoStrada: string;
  tipoStradaNorm: string;
  nomeStrada: string;
  nomeStradaNorm: string;
  nomeTokens: string[];
  civicoRaw: string;
  civicoNum: number | null;
  civicoSuffix: string;
  civicoStart: number | null;
  civicoEnd: number | null;
  parity: CivicParity;
  isSnc: boolean;
  scala: string;
  note: string;
  rawAddress: string;
}

export interface ExtractionProgress {
  fileName: string;
  stage: 'reading' | 'analyzing' | 'ocr' | 'indexing' | 'saving' | 'done' | 'error';
  currentPage: number;
  totalPages: number;
  extractedSoFar: number;
  message: string;
}

export interface ScoreBreakdown {
  comuneScore: number;
  streetScore: number;
  civicoScore: number;
  tipoScore: number;
  totalScore: number;
  comuneMatched: boolean;
  civicoMatched: 'exact' | 'range' | 'street-fallback' | 'none';
}

export interface SearchMatch {
  record: AddressRecord;
  code: string; // e.g. "2B"
  confidence: number; // 0..100
  breakdown: ScoreBreakdown;
}

export interface SearchOutput {
  queryRaw: string;
  detectedComune: string | null;
  detectedTipo: string | null;
  detectedStreetQuery: string;
  detectedCivico: { num: number; suffix: string } | null;
  best: SearchMatch | null;
  alternatives: SearchMatch[];
  elapsedMs: number;
}

export interface SortingHistoryItem {
  id: string;
  timestamp: number;
  query: string;
  code: string;
  comune: string;
  indirizzo: string;
  confidence: number;
}
