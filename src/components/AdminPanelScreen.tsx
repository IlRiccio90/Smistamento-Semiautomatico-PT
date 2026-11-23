import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  FileText,
  FileUp,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getLastGlobalSyncAt, getLocalStatsSummary } from '../db/indexedDb';
import { extractPdfToCenterRecords } from '../engine/pdfExtractor';
import {
  adminCheckDuplicatePdfApi,
  adminCreateBackupApi,
  adminCreateCenterApi,
  adminCreateUserApi,
  adminDeleteCenterApi,
  adminDeletePdfApi,
  adminExportCenterApi,
  adminGetDiagnosticsApi,
  adminListBackupsApi,
  adminListCenterPdfsApi,
  adminListLogsApi,
  adminListUsersApi,
  adminRegenerateCenterDbApi,
  adminRestoreBackupApi,
  adminToggleUserActiveApi,
  adminUpdateCenterApi,
  adminUploadPdfApi,
  changeAdminPasswordApi,
  logoutAdminApi,
  toFriendlyError,
  verifyAndEnsureAdminAccess,
} from '../services/cloudApi';
import type {
  ActivityLogEntry,
  AddressRecord,
  AdminSession,
  AdminUserRecord,
  CenterBackupRecord,
  DeliveryCenter,
  DiagnosticsSnapshot,
  ExtractionProgress,
  PdfDocumentRecord,
} from '../types/sorting';

interface AdminPanelScreenProps {
  session: AdminSession;
  cloudCenters: DeliveryCenter[];
  localCenters: DeliveryCenter[];
  isOnline: boolean;
  aiOcrAvailable: boolean;
  onBackHome: () => void;
  onLoggedOut: () => void;
  onCentersChanged: () => Promise<void>;
}

type AdminTab = 'centri' | 'pdf' | 'admin' | 'backup' | 'log' | 'diagnostica';

interface DuplicatePromptState {
  centerId: string;
  fileName: string;
  buffer: ArrayBuffer;
  pdfRecord: PdfDocumentRecord;
  addresses: AddressRecord[];
  duplicatePdf: PdfDocumentRecord;
  reason: string;
  resolver: (choice: 'cancel' | 'replace' | 'keep_both') => void;
}

const BUNDLED_SAMPLE_PDFS = [
  { url: '/assets/aistudio/Zona_1_4560a8da.pdf', fileName: 'Zona 1.pdf' },
  { url: '/assets/aistudio/Zona_2_8ab9d1f2.pdf', fileName: 'Zona 2.pdf' },
];

const ACTION_LABELS: Record<ActivityLogEntry['action'], string> = {
  login_admin: 'Login Admin',
  logout_admin: 'Logout Admin',
  creazione_centro: 'Creazione Centro',
  modifica_centro: 'Modifica Centro',
  eliminazione_centro: 'Eliminazione Centro',
  caricamento_pdf: 'Caricamento PDF',
  sostituzione_pdf: 'Sostituzione PDF',
  eliminazione_pdf: 'Eliminazione PDF',
  rigenerazione_db: 'Rigenerazione DB',
  sincronizzazione: 'Sincronizzazione',
  aggiornamento_incrementale: 'Aggiornamento Incrementale',
  backup_creato: 'Backup Creato',
  backup_ripristinato: 'Backup Ripristinato',
  gestione_admin: 'Gestione Admin',
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function formatDateTimeParts(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AdminPanelScreen({
  session,
  cloudCenters,
  localCenters,
  isOnline,
  aiOcrAvailable,
  onBackHome,
  onLoggedOut,
  onCentersChanged,
}: AdminPanelScreenProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('centri');
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Centri modal state
  const [showCenterModal, setShowCenterModal] = useState(false);
  const [editingCenter, setEditingCenter] = useState<DeliveryCenter | null>(null);
  const [centerNameInput, setCenterNameInput] = useState('');
  const [centerNotesInput, setCenterNotesInput] = useState('');
  const [confirmDeleteCenter, setConfirmDeleteCenter] = useState<DeliveryCenter | null>(null);

  // PDF section state
  const [selectedPdfCenterId, setSelectedPdfCenterId] = useState<string>(
    cloudCenters[0]?.id ?? ''
  );
  const [centerPdfs, setCenterPdfs] = useState<PdfDocumentRecord[]>([]);
  const [loadingPdfs, setLoadingPdfs] = useState(false);
  const [preferAiOcr, setPreferAiOcr] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePromptState | null>(null);
  const [replaceTargetPdf, setReplaceTargetPdf] = useState<PdfDocumentRecord | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  // Admin users & cambio password state
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [pwChangeNew, setPwChangeNew] = useState('');
  const [pwChangeConfirm, setPwChangeConfirm] = useState('');
  const [pwChangeLoading, setPwChangeLoading] = useState(false);

  // Backups state
  const [backups, setBackups] = useState<CenterBackupRecord[]>([]);
  const [backupCenterId, setBackupCenterId] = useState<string>(cloudCenters[0]?.id ?? '');
  const restoreJsonInputRef = useRef<HTMLInputElement | null>(null);

  // Logs state
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [logFilterText, setLogFilterText] = useState('');
  const [logActionFilter, setLogActionFilter] = useState<string>('ALL');

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);

  useEffect(() => {
    if (cloudCenters.length > 0) {
      if (!selectedPdfCenterId || !cloudCenters.some((c) => c.id === selectedPdfCenterId)) {
        setSelectedPdfCenterId(cloudCenters[0].id);
      }
      if (!backupCenterId || !cloudCenters.some((c) => c.id === backupCenterId)) {
        setBackupCenterId(cloudCenters[0].id);
      }
    } else {
      setSelectedPdfCenterId('');
      setBackupCenterId('');
    }
  }, [backupCenterId, cloudCenters, selectedPdfCenterId]);

  const clearAlerts = () => {
    setErrorBanner(null);
    setSuccessBanner(null);
  };

  const loadSelectedCenterPdfs = useCallback(async () => {
    if (!selectedPdfCenterId) {
      setCenterPdfs([]);
      return;
    }
    setLoadingPdfs(true);
    try {
      const list = await adminListCenterPdfsApi(session.token, selectedPdfCenterId);
      setCenterPdfs(list);
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore caricamento PDF.').message);
    } finally {
      setLoadingPdfs(false);
    }
  }, [selectedPdfCenterId, session.token]);

  const loadAdminUsers = useCallback(async () => {
    try {
      const users = await adminListUsersApi(session.token);
      setAdminUsers(users);
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore elenco amministratori.').message);
    }
  }, [session.token]);

  const loadBackups = useCallback(async () => {
    try {
      const list = await adminListBackupsApi(session.token);
      setBackups(list);
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore caricamento backup.').message);
    }
  }, [session.token]);

  const loadLogs = useCallback(async () => {
    try {
      const list = await adminListLogsApi(session.token);
      setLogs(list);
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore caricamento log.').message);
    }
  }, [session.token]);

  const loadDiagnostics = useCallback(async () => {
    try {
      const [cloudDiag, localStats, lastGlobalSyncAt, authCheck] = await Promise.all([
        adminGetDiagnosticsApi(session.token),
        getLocalStatsSummary(),
        getLastGlobalSyncAt(),
        verifyAndEnsureAdminAccess(),
      ]);
      let browserUsage: number | null = null;
      let browserQuota: number | null = null;
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        browserUsage = typeof est.usage === 'number' ? est.usage : null;
        browserQuota = typeof est.quota === 'number' ? est.quota : null;
      }

      const localMap = new Map(localCenters.map((c) => [c.id, c]));
      const centerVersions = cloudCenters.map((cc) => ({
        centerId: cc.id,
        name: cc.name,
        localVersion: localMap.get(cc.id)?.localVersion ?? null,
        cloudVersion: cc.version,
      }));

      setDiagnostics({
        ...cloudDiag,
        localCentersCount: localStats.centersCount,
        localPdfsCount: localStats.pdfsCount,
        localAddressesCount: localStats.addressesCount,
        browserStorageUsageBytes: browserUsage,
        browserStorageQuotaBytes: browserQuota,
        lastGlobalSyncAt,
        authDiagnostics: authCheck.diagnostics,
        centerVersions,
      });
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore caricamento diagnostica.').message);
    }
  }, [cloudCenters, localCenters, session.token]);

  useEffect(() => {
    if (activeTab === 'pdf') void loadSelectedCenterPdfs();
    if (activeTab === 'admin') void loadAdminUsers();
    if (activeTab === 'backup') void loadBackups();
    if (activeTab === 'log') void loadLogs();
    if (activeTab === 'diagnostica') void loadDiagnostics();
  }, [
    activeTab,
    loadAdminUsers,
    loadBackups,
    loadDiagnostics,
    loadLogs,
    loadSelectedCenterPdfs,
  ]);

  const handleLogout = async () => {
    await logoutAdminApi(session.token);
    onLoggedOut();
  };

  // ---- CENTRI CRUD ----
  const openCreateCenterModal = () => {
    clearAlerts();
    setEditingCenter(null);
    setCenterNameInput('');
    setCenterNotesInput('');
    setShowCenterModal(true);
  };

  const openEditCenterModal = (center: DeliveryCenter) => {
    clearAlerts();
    setEditingCenter(center);
    setCenterNameInput(center.name);
    setCenterNotesInput(center.notes);
    setShowCenterModal(true);
  };

  const handleSaveCenter = async (e: FormEvent) => {
    e.preventDefault();
    if (!centerNameInput.trim()) return;
    clearAlerts();
    setBusyMessage(editingCenter ? 'Aggiornamento Centro...' : 'Creazione Centro...');
    try {
      if (editingCenter) {
        await adminUpdateCenterApi(
          session.token,
          editingCenter.id,
          centerNameInput.trim(),
          centerNotesInput.trim()
        );
        setSuccessBanner(`Centro "${centerNameInput.trim()}" aggiornato sul server.`);
      } else {
        const created = await adminCreateCenterApi(
          session.token,
          centerNameInput.trim(),
          centerNotesInput.trim()
        );
        setSelectedPdfCenterId(created.id);
        setBackupCenterId(created.id);
        setSuccessBanner(`Centro "${created.name}" creato sul server.`);
      }
      setShowCenterModal(false);
      await onCentersChanged();
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Operazione Centro fallita.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  const handleConfirmDeleteCenter = async () => {
    if (!confirmDeleteCenter) return;
    clearAlerts();
    setBusyMessage(`Eliminazione Centro "${confirmDeleteCenter.name}" (con backup automatico)...`);
    try {
      await adminDeleteCenterApi(session.token, confirmDeleteCenter.id);
      setSuccessBanner(
        `Centro "${confirmDeleteCenter.name}" eliminato. Snapshot automatico salvato nei Backup.`
      );
      setConfirmDeleteCenter(null);
      await onCentersChanged();
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Eliminazione Centro fallita.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  // ---- PDF PIPELINE CON CONTROLLO DUPLICATI ----
  const promptDuplicateChoice = (
    payload: Omit<DuplicatePromptState, 'resolver'>
  ): Promise<'cancel' | 'replace' | 'keep_both'> => {
    return new Promise((resolve) => {
      setDuplicatePrompt({
        ...payload,
        resolver: (choice) => {
          setDuplicatePrompt(null);
          resolve(choice);
        },
      });
    });
  };

  const processAndUploadBuffers = async (
    centerId: string,
    items: Array<{ fileName: string; buffer: ArrayBuffer }>,
    explicitReplacePdf?: PdfDocumentRecord
  ) => {
    clearAlerts();
    try {
      let uploadedCount = 0;
      for (const item of items) {
        const { pdfRecord, addresses } = await extractPdfToCenterRecords({
          centerId,
          fileName: item.fileName,
          buffer: item.buffer,
          preferAiOcr,
          onProgress: (p) => setExtractionProgress(p),
        });

        if (addresses.length === 0) {
          throw new Error(
            `Nessun indirizzo estratto da "${item.fileName}". Verifica che il PDF contenga l'itinerario di gita.`
          );
        }

        let resolution: 'new' | 'replace' | 'keep_both' = 'new';
        let replacePdfId: string | undefined;

        if (explicitReplacePdf) {
          resolution = 'replace';
          replacePdfId = explicitReplacePdf.id;
        } else {
          const dup = await adminCheckDuplicatePdfApi(
            session.token,
            centerId,
            item.fileName,
            pdfRecord.fileHash || '',
            pdfRecord.zoneNumber
          );

          if (dup.duplicatePdf) {
            const choice = await promptDuplicateChoice({
              centerId,
              fileName: item.fileName,
              buffer: item.buffer,
              pdfRecord,
              addresses,
              duplicatePdf: dup.duplicatePdf,
              reason: dup.reason,
            });
            if (choice === 'cancel') {
              continue;
            }
            if (choice === 'replace') {
              resolution = 'replace';
              replacePdfId = dup.duplicatePdf.id;
            } else {
              resolution = 'keep_both';
            }
          }
        }

        setExtractionProgress({
          fileName: item.fileName,
          stage: 'uploading',
          currentPage: pdfRecord.pageCount,
          totalPages: pdfRecord.pageCount,
          extractedSoFar: addresses.length,
          message: `Salvataggio sul cloud (${addresses.length.toLocaleString('it-IT')} indirizzi)...`,
        });

        await adminUploadPdfApi(session.token, centerId, {
          pdfRecord,
          pdfBase64: arrayBufferToBase64(item.buffer),
          addresses,
          duplicateResolution: resolution,
          replacePdfId,
        });
        uploadedCount++;
      }

      await Promise.all([onCentersChanged(), loadSelectedCenterPdfs()]);
      if (uploadedCount > 0) {
        setSuccessBanner(
          `${uploadedCount} ${uploadedCount === 1 ? 'Libretto Gita elaborato' : 'Libretti Gita elaborati'} e salvato sul cloud. Versione Centro incrementata.`
        );
      }
    } catch (err) {
      setErrorBanner(
        toFriendlyError(err, 'Errore durante elaborazione o caricamento PDF.').message
      );
    } finally {
      setExtractionProgress(null);
      setReplaceTargetPdf(null);
    }
  };

  const handleSelectPdfFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !selectedPdfCenterId) return;
    const valid = Array.from(fileList).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfInputRef.current) pdfInputRef.current.value = '';
    if (valid.length === 0) return;

    const items: Array<{ fileName: string; buffer: ArrayBuffer }> = [];
    for (const f of valid) {
      items.push({ fileName: f.name, buffer: await f.arrayBuffer() });
    }
    await processAndUploadBuffers(selectedPdfCenterId, items);
  };

  const handleSelectReplaceFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !replaceTargetPdf || !selectedPdfCenterId) return;
    const file = fileList[0];
    if (replaceInputRef.current) replaceInputRef.current.value = '';
    const buffer = await file.arrayBuffer();
    await processAndUploadBuffers(
      selectedPdfCenterId,
      [{ fileName: file.name, buffer }],
      replaceTargetPdf
    );
  };

  const handleDeletePdf = async (pdf: PdfDocumentRecord) => {
    if (!selectedPdfCenterId) return;
    clearAlerts();
    setBusyMessage(`Eliminazione "${pdf.fileName}" (con backup automatico)...`);
    try {
      await adminDeletePdfApi(session.token, selectedPdfCenterId, pdf.id);
      await Promise.all([onCentersChanged(), loadSelectedCenterPdfs()]);
      setSuccessBanner(`PDF "${pdf.fileName}" rimosso e versione Centro aggiornata.`);
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore eliminazione PDF.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  const handleRegenerateDb = async () => {
    if (!selectedPdfCenterId) return;
    clearAlerts();
    setBusyMessage('Rigenerazione e deduplicazione database indirizzi...');
    try {
      const updated = await adminRegenerateCenterDbApi(session.token, selectedPdfCenterId);
      await Promise.all([onCentersChanged(), loadSelectedCenterPdfs()]);
      setSuccessBanner(
        `Database rigenerato (${updated.addressCount.toLocaleString('it-IT')} indirizzi univoci · v${updated.version}).`
      );
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore rigenerazione DB.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  const handleImportSampleCenterToCloud = async () => {
    clearAlerts();
    setBusyMessage('Creazione Centro Sant’Angelo Lodigiano e importazione Libretti Zona 1 & 2...');
    try {
      const existing = cloudCenters.find((c) =>
        c.name.toLowerCase().includes('angelo lodigiano')
      );
      const targetCenter =
        existing ??
        (await adminCreateCenterApi(
          session.token,
          'Sant’Angelo Lodigiano CD',
          'Frazionario 38687 · Libretti Gita Zona 1 e Zona 2'
        ));

      const items: Array<{ fileName: string; buffer: ArrayBuffer }> = [];
      for (const sample of BUNDLED_SAMPLE_PDFS) {
        const resp = await fetch(sample.url);
        if (!resp.ok) throw new Error(`Impossibile scaricare ${sample.fileName}`);
        items.push({ fileName: sample.fileName, buffer: await resp.arrayBuffer() });
      }
      setBusyMessage(null);
      setSelectedPdfCenterId(targetCenter.id);
      setActiveTab('pdf');
      await processAndUploadBuffers(targetCenter.id, items);
    } catch (err) {
      setBusyMessage(null);
      setErrorBanner(
        toFriendlyError(err, 'Impossibile importare i libretti reali.').message
      );
    }
  };

  // ---- AMMINISTRATORI & CAMBIO PASSWORD ----
  const handleCreateAdminUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail.trim()) return;
    clearAlerts();
    setBusyMessage('Abilitazione account amministratore...');
    try {
      await adminCreateUserApi(session.token, newAdminEmail.trim());
      setNewAdminEmail('');
      await loadAdminUsers();
      setSuccessBanner(
        'Amministratore abilitato. Al primo accesso gli verrà chiesto di creare la propria password.'
      );
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore abilitazione amministratore.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  const handleChangeOwnPassword = async (e: FormEvent) => {
    e.preventDefault();
    clearAlerts();
    if (pwChangeNew.length < 8) {
      setErrorBanner('La nuova password deve contenere almeno 8 caratteri.');
      return;
    }
    if (pwChangeNew !== pwChangeConfirm) {
      setErrorBanner('Le due password non coincidono.');
      return;
    }

    setPwChangeLoading(true);
    try {
      await changeAdminPasswordApi(session.token, pwChangeNew);
      setPwChangeNew('');
      setPwChangeConfirm('');
      setSuccessBanner('Password amministratore aggiornata con successo.');
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Impossibile aggiornare la password.').message);
    } finally {
      setPwChangeLoading(false);
    }
  };

  const handleToggleAdminActive = async (user: AdminUserRecord) => {
    clearAlerts();
    setBusyMessage(user.active ? 'Disattivazione amministratore...' : 'Attivazione amministratore...');
    try {
      await adminToggleUserActiveApi(session.token, user.id, !user.active);
      await loadAdminUsers();
      setSuccessBanner(
        `${user.email} ${!user.active ? 'attivato' : 'disattivato'} correttamente.`
      );
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Operazione non consentita.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  // ---- BACKUP & RIPRISTINO ----
  const handleCreateManualBackup = async () => {
    if (!backupCenterId) return;
    clearAlerts();
    setBusyMessage('Creazione snapshot di backup...');
    try {
      const list = await adminCreateBackupApi(session.token, backupCenterId);
      setBackups(list);
      setSuccessBanner('Backup manuale creato sul server.');
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore creazione backup.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  const handleExportCenterJson = async (centerId: string) => {
    clearAlerts();
    setBusyMessage('Esportazione archivio JSON Centro...');
    try {
      const payload = await adminExportCenterApi(session.token, centerId);
      const centerName =
        cloudCenters.find((c) => c.id === centerId)?.name.replace(/\s+/g, '_') || 'centro';
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${centerName}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await loadBackups();
      setSuccessBanner('Esportazione JSON completata.');
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore esportazione Centro.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  const handleRestoreSnapshot = async (backupId: string) => {
    clearAlerts();
    setBusyMessage('Ripristino snapshot in corso...');
    try {
      const restored = await adminRestoreBackupApi(session.token, { backupId });
      await Promise.all([onCentersChanged(), loadBackups()]);
      setSuccessBanner(`Centro "${restored.name}" ripristinato alla versione v${restored.version}.`);
    } catch (err) {
      setErrorBanner(toFriendlyError(err, 'Errore ripristino snapshot.').message);
    } finally {
      setBusyMessage(null);
    }
  };

  const handleImportJsonFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    if (restoreJsonInputRef.current) restoreJsonInputRef.current.value = '';
    clearAlerts();
    setBusyMessage('Importazione e ripristino file backup...');
    try {
      const rawText = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new Error('Il file selezionato non è un backup valido.');
      }
      const restored = await adminRestoreBackupApi(session.token, { importedPayload: parsed });
      await Promise.all([onCentersChanged(), loadBackups()]);
      setSuccessBanner(`Centro "${restored.name}" importato e pubblicato (v${restored.version}).`);
    } catch (err) {
      setErrorBanner(
        toFriendlyError(err, 'File di backup non valido o ripristino fallito.').message
      );
    } finally {
      setBusyMessage(null);
    }
  };

  // ---- LOG FILTERING ----
  const filteredLogs = useMemo(() => {
    const q = logFilterText.trim().toLowerCase();
    return logs.filter((entry) => {
      if (logActionFilter !== 'ALL' && entry.action !== logActionFilter) return false;
      if (!q) return true;
      return (
        entry.actorEmail.toLowerCase().includes(q) ||
        (entry.centerName || '').toLowerCase().includes(q) ||
        entry.details.toLowerCase().includes(q)
      );
    });
  }, [logActionFilter, logFilterText, logs]);

  const tabs: Array<{ id: AdminTab; label: string; icon: typeof Building2 }> = [
    { id: 'centri', label: '1. Centri di Recapito', icon: Building2 },
    { id: 'pdf', label: '2. Gestione PDF', icon: FileText },
    { id: 'admin', label: '3. Amministratori', icon: Users },
    { id: 'backup', label: '4. Backup', icon: HardDrive },
    { id: 'log', label: '5. Log Attività', icon: History },
    { id: 'diagnostica', label: '6. Diagnostica', icon: Activity },
  ];

  const selectedPdfCenter = cloudCenters.find((c) => c.id === selectedPdfCenterId) ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FB]">
      {/* Header Admin */}
      <header className="sticky top-0 z-30 bg-[#002677] text-white border-b-4 border-[#FFD100] pt-safe">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackHome}
              aria-label="Torna alla Home"
              className="min-h-[44px] min-w-[44px] -ml-1 rounded-xl flex items-center justify-center hover:bg-white/10 shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#FFD100] shrink-0" />
                <h1 className="text-sm sm:text-base font-extrabold tracking-tight truncate uppercase">
                  Amministrazione Sistema
                </h1>
              </div>
              <p className="text-[11px] text-blue-200 truncate">
                {session.email} · Backend:{' '}
                <span className="text-[#FFD100] font-bold">
                  {session.backendMode === 'supabase' ? 'Supabase Cloud' : 'Cloud Server Locale'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="min-h-[42px] px-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
          >
            <LogOut className="w-4 h-4" />
            <span>Esci</span>
          </button>
        </div>

        {/* Navigation 6 Sezioni */}
        <div className="bg-[#003399] border-t border-white/10 overflow-x-auto">
          <nav className="max-w-7xl mx-auto px-3 sm:px-6 flex items-center gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    clearAlerts();
                    setActiveTab(tab.id);
                  }}
                  className={`min-h-[46px] px-3.5 py-2 text-xs sm:text-sm font-extrabold whitespace-nowrap border-b-4 transition-colors inline-flex items-center gap-1.5 ${
                    active
                      ? 'border-[#FFD100] text-[#FFD100] bg-white/10'
                      : 'border-transparent text-blue-100 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6 pb-operative space-y-5">
        {busyMessage && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm font-bold text-[#003399]">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{busyMessage}</span>
          </div>
        )}

        {errorBanner && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold text-red-800"
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="p-1 rounded-lg hover:bg-red-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successBanner && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold text-emerald-800">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {successBanner}
            </span>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="p-1 rounded-lg hover:bg-emerald-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ==================== 1. CENTRI DI RECAPITO ==================== */}
        {activeTab === 'centri' && (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-[#0A1628]">
                  Gestione Centri di Recapito
                </h2>
                <p className="text-xs sm:text-sm text-slate-600">
                  Ogni modifica incrementa automaticamente la versione cloud per notificare gli operatori sincronizzati.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleImportSampleCenterToCloud()}
                  className="min-h-[46px] px-4 rounded-xl bg-white border border-[#003399]/30 hover:bg-[#003399]/5 text-[#003399] font-bold text-xs sm:text-sm inline-flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Carica Libretti Reali Zona 1 & 2</span>
                </button>
                <button
                  type="button"
                  onClick={openCreateCenterModal}
                  className="min-h-[46px] px-5 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-sm inline-flex items-center gap-2 shadow-xs"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Nuovo Centro</span>
                </button>
              </div>
            </div>

            {cloudCenters.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center">
                <Building2 className="w-10 h-10 text-[#003399] mx-auto mb-3" />
                <p className="text-base font-extrabold text-[#0A1628]">
                  Nessun Centro nel database centrale
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Crea il primo Centro oppure carica direttamente i Libretti Reali Zona 1 e 2.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cloudCenters.map((c) => {
                  const dt = formatDateTimeParts(c.updatedAt);
                  return (
                    <div
                      key={c.id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4 shadow-xs"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-lg font-extrabold text-[#003399] truncate">
                            {c.name}
                          </h3>
                          <span className="font-mono text-xs font-extrabold px-2.5 py-1 rounded-lg bg-[#FFD100]/45 text-[#002677]">
                            v{c.version}
                          </span>
                        </div>
                        {c.notes && (
                          <p className="text-xs text-slate-600 mt-1 line-clamp-2">{c.notes}</p>
                        )}
                        <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs tabular-nums">
                          <div>
                            <p className="text-slate-500">PDF</p>
                            <p className="font-extrabold text-[#0A1628] text-sm">{c.pdfCount}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Zone</p>
                            <p className="font-extrabold text-[#0A1628] text-sm">
                              {c.zones.length}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500">Indirizzi</p>
                            <p className="font-extrabold text-[#0A1628] text-sm">
                              {c.addressCount.toLocaleString('it-IT')}
                            </p>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2">
                          Ultimo agg.: {dt.date} {dt.time}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPdfCenterId(c.id);
                            setActiveTab('pdf');
                          }}
                          className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#003399] hover:bg-[#002677] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
                        >
                          <FileText className="w-4 h-4" />
                          <span>PDF ({c.pdfCount})</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Modifica ${c.name}`}
                          onClick={() => openEditCenterModal(c)}
                          className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 flex items-center justify-center"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Elimina ${c.name}`}
                          onClick={() => setConfirmDeleteCenter(c)}
                          className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50 text-red-600 flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ==================== 2. GESTIONE PDF ==================== */}
        {activeTab === 'pdf' && (
          <section className="space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="admin-pdf-center"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5"
                >
                  Seleziona Centro di Recapito
                </label>
                <select
                  id="admin-pdf-center"
                  value={selectedPdfCenterId}
                  onChange={(e) => setSelectedPdfCenterId(e.target.value)}
                  className="w-full sm:max-w-md min-h-[46px] px-3.5 rounded-xl border border-slate-300 font-bold text-sm bg-white focus:outline-none focus:border-[#003399]"
                >
                  {cloudCenters.length === 0 ? (
                    <option value="">Nessun Centro disponibile</option>
                  ) : (
                    cloudCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (v{c.version} · {c.addressCount.toLocaleString('it-IT')} indirizzi)
                      </option>
                    ))
                  )}
                </select>
              </div>

              {selectedPdfCenter && (
                <button
                  type="button"
                  onClick={() => void handleRegenerateDb()}
                  disabled={Boolean(extractionProgress) || centerPdfs.length === 0}
                  className="min-h-[46px] px-4 rounded-xl bg-white border border-[#003399] hover:bg-[#003399]/5 disabled:opacity-40 text-[#003399] font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-2 shrink-0"
                >
                  <Database className="w-4 h-4" />
                  <span>Rigenera e Deduplica DB</span>
                </button>
              )}
            </div>

            {selectedPdfCenter && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Upload box */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-white rounded-3xl border-2 border-dashed border-slate-300 p-6 text-center">
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      onChange={(e) => void handleSelectPdfFiles(e.target.files)}
                      className="hidden"
                    />
                    <input
                      ref={replaceInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => void handleSelectReplaceFile(e.target.files)}
                      className="hidden"
                    />
                    <div className="w-12 h-12 rounded-2xl bg-[#FFD100]/30 text-[#003399] flex items-center justify-center mx-auto mb-3">
                      <FileUp className="w-6 h-6" />
                    </div>
                    <h3 className="text-base font-extrabold text-[#0A1628]">
                      Carica Libretti Gita in Cloud
                    </h3>
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                      I PDF vengono analizzati e salvati nel cloud: gli operatori sincronizzeranno solo gli indirizzi indicizzati e i metadati. Controllo duplicati automatico.
                    </p>
                    <button
                      type="button"
                      disabled={Boolean(extractionProgress)}
                      onClick={() => pdfInputRef.current?.click()}
                      className="mt-4 w-full min-h-[48px] px-4 rounded-xl bg-[#003399] hover:bg-[#002677] disabled:opacity-50 text-white font-bold text-sm inline-flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Carica uno o più PDF</span>
                    </button>

                    {aiOcrAvailable && (
                      <label className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-left cursor-pointer">
                        <span className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-[#003399]" />
                          Usa OCR AI su scansioni complesse
                        </span>
                        <input
                          type="checkbox"
                          checked={preferAiOcr}
                          onChange={(e) => setPreferAiOcr(e.target.checked)}
                          className="w-5 h-5 accent-[#003399] rounded"
                        />
                      </label>
                    )}
                  </div>

                  {extractionProgress && (
                    <div className="bg-white rounded-2xl border border-[#003399]/25 p-4 shadow-xs">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="inline-flex items-center gap-2 text-xs font-bold text-[#003399] truncate">
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          <span className="truncate">{extractionProgress.fileName}</span>
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-700 tabular-nums shrink-0">
                          {extractionProgress.totalPages > 0
                            ? `${extractionProgress.currentPage}/${extractionProgress.totalPages}`
                            : '...'}
                        </span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#003399] transition-all duration-150"
                          style={{
                            width:
                              extractionProgress.totalPages > 0
                                ? `${Math.min(
                                    100,
                                    Math.round(
                                      (extractionProgress.currentPage /
                                        extractionProgress.totalPages) *
                                        100
                                    )
                                  )}%`
                                : '15%',
                          }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-600">{extractionProgress.message}</p>
                    </div>
                  )}
                </div>

                {/* Cloud PDF list */}
                <div className="lg:col-span-7 space-y-3">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                    Libretti Gita nel Cloud ({centerPdfs.length})
                  </h3>

                  {loadingPdfs ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                      Caricamento elenco PDF...
                    </div>
                  ) : centerPdfs.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
                      Nessun PDF presente per questo Centro.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {centerPdfs.map((pdf) => (
                        <div
                          key={pdf.id}
                          className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-12 h-12 rounded-xl bg-[#003399] text-[#FFD100] flex flex-col items-center justify-center shrink-0 font-mono font-extrabold">
                              <span className="text-[9px] uppercase text-blue-200 leading-none">
                                Zona
                              </span>
                              <span className="text-lg leading-tight">{pdf.zoneNumber}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-extrabold text-[#0A1628] truncate">
                                {pdf.fileName}
                              </p>
                              <p className="text-xs text-slate-600 tabular-nums">
                                {pdf.extractedCount.toLocaleString('it-IT')} indirizzi ·{' '}
                                {pdf.pageCount} pag. · {formatBytes(pdf.fileSize)}
                                {pdf.versionAdded ? ` · v${pdf.versionAdded}` : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={Boolean(extractionProgress)}
                              onClick={() => {
                                setReplaceTargetPdf(pdf);
                                replaceInputRef.current?.click();
                              }}
                              className="min-h-[42px] px-3 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-bold text-[#003399] inline-flex items-center gap-1.5"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Sostituisci</span>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(extractionProgress)}
                              onClick={() => void handleDeletePdf(pdf)}
                              className="min-h-[42px] min-w-[42px] rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50 text-red-600 flex items-center justify-center"
                              aria-label={`Elimina ${pdf.fileName}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ==================== 3. AMMINISTRATORI & SICUREZZA ==================== */}
        {activeTab === 'admin' && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-5">
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <UserPlus className="w-5 h-5 text-[#003399]" />
                  <h2 className="text-base font-extrabold text-[#0A1628]">
                    Abilita Nuovo Amministratore
                  </h2>
                </div>
                <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                  La registrazione pubblica è disabilitata. Inserisci l’email del collega da autorizzare: al primo accesso gli verrà chiesto automaticamente di creare la propria password.
                </p>

                <form onSubmit={handleCreateAdminUser} className="space-y-3.5">
                  <div>
                    <label
                      htmlFor="new-adm-email"
                      className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1"
                    >
                      Email Amministratore
                    </label>
                    <input
                      id="new-adm-email"
                      type="email"
                      required
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      placeholder="collega@posteitaliane.it"
                      className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full min-h-[46px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm"
                  >
                    Abilita Amministratore
                  </button>
                </form>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <KeyRound className="w-5 h-5 text-[#003399]" />
                  <h2 className="text-base font-extrabold text-[#0A1628]">
                    Cambia la tua Password
                  </h2>
                </div>
                <p className="text-xs text-slate-600 mb-4">
                  Account connesso: <strong className="text-[#0A1628]">{session.email}</strong>
                </p>

                <form onSubmit={handleChangeOwnPassword} className="space-y-3.5">
                  <div>
                    <label
                      htmlFor="own-pw-new"
                      className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1"
                    >
                      Nuova Password (min. 8 caratteri)
                    </label>
                    <input
                      id="own-pw-new"
                      type="password"
                      required
                      minLength={8}
                      value={pwChangeNew}
                      onChange={(e) => setPwChangeNew(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="own-pw-confirm"
                      className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1"
                    >
                      Conferma Nuova Password
                    </label>
                    <input
                      id="own-pw-confirm"
                      type="password"
                      required
                      minLength={8}
                      value={pwChangeConfirm}
                      onChange={(e) => setPwChangeConfirm(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pwChangeLoading}
                    className="w-full min-h-[46px] rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-sm disabled:opacity-50"
                  >
                    {pwChangeLoading ? 'Aggiornamento...' : 'Aggiorna Password'}
                  </button>
                </form>
              </div>
            </div>

            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-base font-extrabold text-[#0A1628]">
                  Amministratori Autorizzati ({adminUsers.length})
                </h2>
              </div>
              <div className="divide-y divide-slate-100">
                {adminUsers.map((user) => {
                  const isSelf = user.email.toLowerCase() === session.email.toLowerCase();
                  return (
                    <div
                      key={user.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-[#0A1628] break-all">
                            {user.email}
                          </span>
                          {isSelf && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-[#003399]">
                              Tu
                            </span>
                          )}
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                              user.active
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {user.active ? 'Attivo' : 'Disattivato'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {user.hasPassword
                            ? user.mustChangePassword
                              ? 'Cambio password al prossimo accesso'
                              : 'Password personale configurata'
                            : 'In attesa di creazione password al primo accesso'}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => void handleToggleAdminActive(user)}
                        className={`min-h-[42px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-40 ${
                          user.active
                            ? 'border border-red-200 text-red-700 hover:bg-red-50'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                      >
                        {user.active ? (
                          <>
                            <UserX className="w-4 h-4" />
                            <span>Disattiva</span>
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-4 h-4" />
                            <span>Attiva</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ==================== 4. BACKUP ==================== */}
        {activeTab === 'backup' && (
          <section className="space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-5">
                <label
                  htmlFor="backup-center-select"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Centro per Backup o Esportazione JSON
                </label>
                <select
                  id="backup-center-select"
                  value={backupCenterId}
                  onChange={(e) => setBackupCenterId(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm font-bold bg-white"
                >
                  {cloudCenters.length === 0 ? (
                    <option value="">Nessun Centro attivo</option>
                  ) : (
                    cloudCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (v{c.version})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="lg:col-span-7 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={!backupCenterId}
                  onClick={() => void handleCreateManualBackup()}
                  className="min-h-[46px] px-4 rounded-xl bg-[#003399] hover:bg-[#002677] disabled:opacity-40 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2"
                >
                  <HardDrive className="w-4 h-4" />
                  <span>Crea Backup Manuale</span>
                </button>
                <button
                  type="button"
                  disabled={!backupCenterId}
                  onClick={() => void handleExportCenterJson(backupCenterId)}
                  className="min-h-[46px] px-4 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] disabled:opacity-40 text-[#002677] text-xs sm:text-sm font-extrabold inline-flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Esporta JSON Centro</span>
                </button>

                <input
                  ref={restoreJsonInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => void handleImportJsonFile(e.target.files)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => restoreJsonInputRef.current?.click()}
                  className="min-h-[46px] px-4 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-bold inline-flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  <span>Importa / Ripristina JSON</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-base font-extrabold text-[#0A1628]">
                  Snapshot Automatici e Manuali ({backups.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Viene creato un backup automatico prima di ogni eliminazione Centro, eliminazione PDF o sostituzione PDF.
                </p>
              </div>
              {backups.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  Nessuno snapshot registrato.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {backups.map((b) => {
                    const dt = formatDateTimeParts(b.createdAt);
                    return (
                      <div
                        key={b.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-extrabold text-[#003399]">
                              {b.centerName}
                            </span>
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              v{b.centerVersion}
                            </span>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-50 text-[#003399] uppercase">
                              {b.reason}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 tabular-nums">
                            {dt.date} {dt.time} · {b.pdfCount} PDF ·{' '}
                            {b.addressCount.toLocaleString('it-IT')} indirizzi · da {b.createdBy}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleRestoreSnapshot(b.id)}
                          className="min-h-[42px] px-4 rounded-xl border border-[#003399] text-[#003399] hover:bg-[#003399] hover:text-white text-xs font-extrabold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Ripristina</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ==================== 5. LOG ATTIVITÀ ==================== */}
        {activeTab === 'log' && (
          <section className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-7">
                <input
                  type="search"
                  value={logFilterText}
                  onChange={(e) => setLogFilterText(e.target.value)}
                  placeholder="Filtra per utente, Centro o descrizione operazione..."
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
              <div className="sm:col-span-5">
                <select
                  aria-label="Filtra per tipo azione"
                  value={logActionFilter}
                  onChange={(e) => setLogActionFilter(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="ALL">Tutte le attività ({logs.length})</option>
                  {Object.entries(ACTION_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {filteredLogs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  Nessuna attività registrata con i filtri correnti.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[11px]">
                      <tr>
                        <th className="py-3 px-4 font-extrabold">Data e Ora</th>
                        <th className="py-3 px-4 font-extrabold">Utente</th>
                        <th className="py-3 px-4 font-extrabold">Azione</th>
                        <th className="py-3 px-4 font-extrabold">Centro / Dettagli</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredLogs.slice(0, 200).map((entry) => {
                        const dt = formatDateTimeParts(entry.createdAt);
                        return (
                          <tr key={entry.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 whitespace-nowrap font-mono text-xs text-slate-600 tabular-nums">
                              {dt.date} <span className="font-bold">{dt.time}</span>
                            </td>
                            <td className="py-3 px-4 font-semibold text-[#0A1628]">
                              {entry.actorEmail}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className="px-2.5 py-1 rounded-lg bg-[#003399]/10 text-[#003399] font-bold text-xs">
                                {ACTION_LABELS[entry.action] || entry.action}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              {entry.centerName && (
                                <span className="font-extrabold text-[#003399] mr-1.5">
                                  [{entry.centerName}]
                                </span>
                              )}
                              <span>{entry.details}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ==================== 6. DIAGNOSTICA ==================== */}
        {activeTab === 'diagnostica' && (
          <section className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-extrabold text-[#0A1628]">
                Diagnostica Sistema e Versionamento
              </h2>
              <button
                type="button"
                onClick={() => void loadDiagnostics()}
                className="min-h-[42px] px-4 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Aggiorna</span>
              </button>
            </div>

            {diagnostics && (
              <>
                {diagnostics.authDiagnostics && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="text-sm font-extrabold text-[#003399] flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span>Diagnostica Autenticazione Admin</span>
                      </h3>
                      <span className="text-xs font-semibold text-slate-600">
                        {diagnostics.authDiagnostics.email}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                      {[
                        { label: 'Utente Auth', ok: diagnostics.authDiagnostics.authUserExists },
                        { label: 'Email confermata', ok: diagnostics.authDiagnostics.emailConfirmed },
                        { label: 'Sessione valida', ok: diagnostics.authDiagnostics.validSession },
                        { label: 'Profilo Admin', ok: diagnostics.authDiagnostics.adminProfileExists },
                        { label: 'Ruolo Admin', ok: diagnostics.authDiagnostics.hasAdminRole },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between text-xs ${
                            item.ok
                              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
                              : 'bg-red-50 border-red-200 text-red-800'
                          }`}
                        >
                          <span className="font-bold">{item.label}:</span>
                          <span className="inline-flex items-center gap-1 font-extrabold">
                            {item.ok ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" /> SI
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3.5 h-3.5" /> NO
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4">
                    <p className="text-xs font-bold uppercase text-slate-500">Connessione</p>
                    <p className="mt-2 text-lg font-extrabold flex items-center gap-2">
                      {isOnline ? (
                        <span className="text-emerald-700 inline-flex items-center gap-1.5">
                          <Wifi className="w-5 h-5" /> Online
                        </span>
                      ) : (
                        <span className="text-amber-700 inline-flex items-center gap-1.5">
                          <WifiOff className="w-5 h-5" /> Offline
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Modalità: {diagnostics.backendMode === 'supabase' ? 'Supabase' : 'Cloud Server'}
                    </p>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 tabular-nums">
                    <p className="text-xs font-bold uppercase text-slate-500">
                      Centri & PDF Cloud
                    </p>
                    <p className="mt-2 text-lg font-extrabold text-[#003399]">
                      {diagnostics.cloudCentersCount} Centri · {diagnostics.cloudPdfsCount} PDF
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {diagnostics.cloudAddressesCount.toLocaleString('it-IT')} indirizzi totali
                    </p>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 tabular-nums">
                    <p className="text-xs font-bold uppercase text-slate-500">
                      Archiviazione & Quota
                    </p>
                    <p className="mt-2 text-lg font-extrabold text-[#0A1628]">
                      PDF Cloud: {formatBytes(diagnostics.cloudTotalStorageBytes)}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      Locale: {formatBytes(diagnostics.browserStorageUsageBytes)} /{' '}
                      {formatBytes(diagnostics.browserStorageQuotaBytes)}
                    </p>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 tabular-nums">
                    <p className="text-xs font-bold uppercase text-slate-500">
                      Ultima Sincronizzazione
                    </p>
                    <p className="mt-2 text-sm font-extrabold text-[#0A1628]">
                      {diagnostics.lastGlobalSyncAt
                        ? `${formatDateTimeParts(diagnostics.lastGlobalSyncAt).date} ${
                            formatDateTimeParts(diagnostics.lastGlobalSyncAt).time
                          }`
                        : 'Mai sincronizzato'}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      Su dispositivo: {diagnostics.localCentersCount} Centri ·{' '}
                      {diagnostics.localAddressesCount.toLocaleString('it-IT')} indirizzi
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="text-sm font-extrabold text-[#0A1628]">
                      Confronto Versione Database Locale vs Cloud
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[11px]">
                        <tr>
                          <th className="py-3 px-4 font-extrabold">Centro di Recapito</th>
                          <th className="py-3 px-4 font-extrabold">Versione Locale</th>
                          <th className="py-3 px-4 font-extrabold">Versione Cloud</th>
                          <th className="py-3 px-4 font-extrabold">Stato Allineamento</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {diagnostics.centerVersions.map((row) => {
                          const aligned = row.localVersion === row.cloudVersion;
                          return (
                            <tr key={row.centerId}>
                              <td className="py-3 px-4 font-bold text-[#003399]">{row.name}</td>
                              <td className="py-3 px-4 font-mono">
                                {row.localVersion !== null ? `v${row.localVersion}` : 'Non scaricato'}
                              </td>
                              <td className="py-3 px-4 font-mono font-bold">v{row.cloudVersion}</td>
                              <td className="py-3 px-4">
                                {row.localVersion === null ? (
                                  <span className="text-xs font-bold text-slate-500">
                                    Solo su cloud
                                  </span>
                                ) : aligned ? (
                                  <span className="text-xs font-bold text-emerald-700">
                                    Allineato
                                  </span>
                                ) : (
                                  <span className="text-xs font-bold text-amber-700">
                                    Aggiornamento disponibile
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {/* Modal Creazione/Modifica Centro */}
      {showCenterModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs overflow-y-auto flex items-start justify-center p-4 pb-dialog-safe"
          onClick={() => setShowCenterModal(false)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl my-auto max-h-[max(260px,calc(100dvh-272px))] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-extrabold text-[#003399]">
                {editingCenter ? 'Modifica Centro di Recapito' : 'Nuovo Centro di Recapito'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCenterModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCenter} className="space-y-4">
              <div>
                <label
                  htmlFor="admin-center-name"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Nome del Centro *
                </label>
                <input
                  id="admin-center-name"
                  type="text"
                  required
                  autoFocus
                  value={centerNameInput}
                  onChange={(e) => setCenterNameInput(e.target.value)}
                  placeholder="es. Lodi, Codogno, Cremona..."
                  className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-center-notes"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Note / Frazionario
                </label>
                <textarea
                  id="admin-center-notes"
                  rows={3}
                  value={centerNotesInput}
                  onChange={(e) => setCenterNotesInput(e.target.value)}
                  placeholder="es. CPD Frazionario 38687..."
                  className="w-full p-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="submit"
                  className="w-full min-h-[48px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm"
                >
                  Salva Centro
                </button>
                <button
                  type="button"
                  onClick={() => setShowCenterModal(false)}
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 font-bold text-sm text-slate-700 hover:bg-slate-50"
                >
                  Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Conferma Eliminazione Centro */}
      {confirmDeleteCenter && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs overflow-y-auto flex items-start justify-center p-4 pb-dialog-safe">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 my-auto max-h-[max(260px,calc(100dvh-272px))] overflow-y-auto">
            <div className="flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-extrabold">Elimina Centro di Recapito</h3>
            </div>
            <p className="text-sm text-slate-700">
              Stai per eliminare <strong>{confirmDeleteCenter.name}</strong> dal server centrale. Verrà creato automaticamente uno snapshot nella sezione Backup prima della rimozione.
            </p>
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => void handleConfirmDeleteCenter()}
                className="w-full min-h-[46px] rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm"
              >
                Elimina Definitivamente
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteCenter(null)}
                className="w-full min-h-[46px] rounded-xl border border-slate-300 font-bold text-sm text-slate-700 hover:bg-slate-50"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Controllo Duplicati PDF */}
      {duplicatePrompt && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs overflow-y-auto flex items-start justify-center p-4 pb-dialog-safe">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-auto max-h-[max(260px,calc(100dvh-272px))] overflow-y-auto">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-[#0A1628]">
                  PDF Potenzialmente Duplicato
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Il file <strong>{duplicatePrompt.fileName}</strong> (Zona{' '}
                  {duplicatePrompt.pdfRecord.zoneNumber}) corrisponde già al libretto{' '}
                  <strong>{duplicatePrompt.duplicatePdf.fileName}</strong> ({duplicatePrompt.reason}).
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-1">
              <p>
                <strong>Sostituisci</strong>: crea un backup automatico del vecchio libretto, aggiorna i dati evitando qualsiasi duplicazione di indirizzi.
              </p>
              <p>
                <strong>Mantieni entrambe le versioni</strong>: salva il PDF come nuova versione evitando comunque righe duplicate nell’archivio.
              </p>
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => duplicatePrompt.resolver('replace')}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-xs sm:text-sm"
              >
                Sostituisci
              </button>
              <button
                type="button"
                onClick={() => duplicatePrompt.resolver('keep_both')}
                className="w-full min-h-[46px] px-4 rounded-xl bg-white border border-[#003399] text-[#003399] font-extrabold text-xs sm:text-sm hover:bg-blue-50"
              >
                Mantieni entrambe le versioni
              </button>
              <button
                type="button"
                onClick={() => duplicatePrompt.resolver('cancel')}
                className="w-full min-h-[46px] px-4 rounded-xl border border-slate-300 font-bold text-xs sm:text-sm text-slate-700 hover:bg-slate-50"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
