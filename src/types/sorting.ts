export type CivicParity = 'all' | 'even' | 'odd';

export type UserRole = 'operator' | 'admin';

export type CenterSyncStatus =
  | 'not_synced'
  | 'syncing'
  | 'synced'
  | 'update_available';

export interface DeliveryCenter {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  localVersion?: number;
  syncedAt?: number;
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
  fileHash?: string;
  zoneNumber: string;
  frazionario?: string;
  storagePath?: string;
  fileSize: number;
  pageCount: number;
  extractedCount: number;
  extractionMethod: PdfExtractionMethod;
  versionAdded?: number;
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
  versionChanged?: number;
}

export interface ExtractionProgress {
  fileName: string;
  stage: 'reading' | 'analyzing' | 'ocr' | 'indexing' | 'saving' | 'uploading' | 'done' | 'error';
  currentPage: number;
  totalPages: number;
  extractedSoFar: number;
  message: string;
}

export type ReliabilityTier = 'high' | 'medium' | 'low';

export interface ScoreBreakdown {
  comuneScore: number;
  streetScore: number;
  civicoScore: number;
  tipoScore: number;
  totalScore: number;
  comuneMatched: boolean;
  civicoMatched: 'exact' | 'range' | 'street-fallback' | 'none';
  fuzzyPenalty: number;
  ambiguityPenalty: number;
  speechQuality: number;
}

export interface SearchMatch {
  record: AddressRecord;
  code: string; // e.g. "2B"
  confidence: number; // 0..100
  reliabilityTier: ReliabilityTier;
  reliabilityLabel: string;
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
  reliabilityTier: ReliabilityTier;
}

export interface AdminUserRecord {
  id: string;
  email: string;
  role: 'admin';
  active: boolean;
  mustChangePassword: boolean;
  hasPassword: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdminSession {
  token: string;
  email: string;
  role: 'admin';
  mustChangePassword: boolean;
  backendMode: 'supabase' | 'local-cloud';
}

export interface ActivityLogEntry {
  id: string;
  actorEmail: string;
  actorRole: 'admin' | 'operator' | 'system';
  action:
    | 'login_admin'
    | 'logout_admin'
    | 'creazione_centro'
    | 'modifica_centro'
    | 'eliminazione_centro'
    | 'caricamento_pdf'
    | 'sostituzione_pdf'
    | 'eliminazione_pdf'
    | 'rigenerazione_db'
    | 'sincronizzazione'
    | 'aggiornamento_incrementale'
    | 'backup_creato'
    | 'backup_ripristinato'
    | 'gestione_admin';
  centerId?: string;
  centerName?: string;
  details: string;
  createdAt: number;
}

export interface CenterBackupRecord {
  id: string;
  centerId: string;
  centerName: string;
  centerVersion: number;
  reason: 'auto' | 'manual' | 'export';
  createdBy: string;
  createdAt: number;
  pdfCount: number;
  addressCount: number;
}

export interface CloudSyncDeltaResponse {
  mode: 'full' | 'delta';
  center: DeliveryCenter;
  fromVersion: number;
  toVersion: number;
  upsertedPdfs: PdfDocumentRecord[];
  deletedPdfIds: string[];
  upsertedAddresses: AddressRecord[];
  deletedAddressIds: string[];
}

export interface AdminAuthDiagnostics {
  email: string;
  authUserExists: boolean;
  emailConfirmed: boolean;
  validSession: boolean;
  adminProfileExists: boolean;
  hasAdminRole: boolean;
  allPassed: boolean;
  errorMessage?: string;
}

export interface DiagnosticsSnapshot {
  backendMode: 'supabase' | 'local-cloud';
  cloudCentersCount: number;
  cloudPdfsCount: number;
  cloudAddressesCount: number;
  cloudTotalStorageBytes: number;
  localCentersCount: number;
  localPdfsCount: number;
  localAddressesCount: number;
  browserStorageUsageBytes: number | null;
  browserStorageQuotaBytes: number | null;
  lastGlobalSyncAt: number | null;
  authDiagnostics?: AdminAuthDiagnostics;
  centerVersions: Array<{
    centerId: string;
    name: string;
    localVersion: number | null;
    cloudVersion: number;
  }>;
}
