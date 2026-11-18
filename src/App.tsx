import { useCallback, useEffect, useState } from 'react';
import { CenterDetailScreen } from './components/CenterDetailScreen';
import { HomeScreen } from './components/HomeScreen';
import { OperationalModeScreen } from './components/OperationalModeScreen';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import {
  createCenter,
  deleteCenter,
  deletePdfAndAddresses,
  listCenters,
  listPdfsByCenter,
  loadCenterAddresses,
  savePdfAndAddresses,
} from './db/indexedDb';
import { extractPdfToCenterRecords } from './engine/pdfExtractor';
import { invalidateCenterIndex } from './engine/searchEngine';
import { usePWAInstall } from './hooks/usePWAInstall';
import type {
  AddressRecord,
  DeliveryCenter,
  ExtractionProgress,
  PdfDocumentRecord,
} from './types/sorting';

type ActiveView = 'home' | 'center' | 'operational';

const BUNDLED_SAMPLE_PDFS = [
  { url: '/assets/aistudio/Zona_1_4560a8da.pdf', fileName: 'Zona 1.pdf' },
  { url: '/assets/aistudio/Zona_2_8ab9d1f2.pdf', fileName: 'Zona 2.pdf' },
];

export default function App() {
  const pwa = usePWAInstall();

  const [view, setView] = useState<ActiveView>('home');
  const [centers, setCenters] = useState<DeliveryCenter[]>([]);
  const [loadingCenters, setLoadingCenters] = useState(true);
  const [selectedCenterId, setSelectedCenterId] = useState<string | null>(null);
  const [centerPdfs, setCenterPdfs] = useState<PdfDocumentRecord[]>([]);
  const [centerAddresses, setCenterAddresses] = useState<AddressRecord[]>([]);
  const [uploadProgress, setUploadProgress] = useState<ExtractionProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [aiOcrAvailable, setAiOcrAvailable] = useState(false);

  const selectedCenter = centers.find((c) => c.id === selectedCenterId) ?? null;

  const refreshCenters = useCallback(async () => {
    const list = await listCenters();
    setCenters(list);
    return list;
  }, []);

  const loadCenterData = useCallback(async (centerId: string) => {
    const [pdfs, addresses] = await Promise.all([
      listPdfsByCenter(centerId),
      loadCenterAddresses(centerId),
    ]);
    setCenterPdfs(pdfs);
    setCenterAddresses(addresses);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshCenters();
      } finally {
        setLoadingCenters(false);
      }
    })();

    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.aiOcrAvailable) setAiOcrAvailable(true);
      })
      .catch(() => {
        // Modalità offline o assenza backend AI
      });
  }, [refreshCenters]);

  const handleSelectCenter = useCallback(
    async (centerId: string, targetView: ActiveView = 'center') => {
      setSelectedCenterId(centerId);
      setUploadError(null);
      await loadCenterData(centerId);
      setView(targetView);
    },
    [loadCenterData]
  );

  const handleCreateCenter = useCallback(
    async (name: string, notes: string) => {
      const created = await createCenter(name, notes);
      await refreshCenters();
      await handleSelectCenter(created.id, 'center');
    },
    [handleSelectCenter, refreshCenters]
  );

  const handleDeleteCenter = useCallback(
    async (centerId: string) => {
      invalidateCenterIndex(centerId);
      await deleteCenter(centerId);
      if (selectedCenterId === centerId) {
        setSelectedCenterId(null);
        setCenterPdfs([]);
        setCenterAddresses([]);
        setView('home');
      }
      await refreshCenters();
    },
    [refreshCenters, selectedCenterId]
  );

  const processBuffersIntoCenter = useCallback(
    async (
      centerId: string,
      items: Array<{ fileName: string; buffer: ArrayBuffer }>,
      preferAiOcr = false
    ) => {
      setUploadError(null);
      try {
        for (const item of items) {
          const { pdfRecord, addresses } = await extractPdfToCenterRecords({
            centerId,
            fileName: item.fileName,
            buffer: item.buffer,
            preferAiOcr,
            onProgress: (prog) => setUploadProgress(prog),
          });

          if (addresses.length === 0) {
            throw new Error(
              `Nessun indirizzo estratto da "${item.fileName}". Verifica che il PDF contenga l'itinerario di gita o un elenco indirizzi leggibile.`
            );
          }

          setUploadProgress({
            fileName: item.fileName,
            stage: 'saving',
            currentPage: pdfRecord.pageCount,
            totalPages: pdfRecord.pageCount,
            extractedSoFar: addresses.length,
            message: `Salvataggio locale di ${addresses.length.toLocaleString('it-IT')} indirizzi...`,
          });

          await savePdfAndAddresses(pdfRecord, item.buffer, addresses);
          invalidateCenterIndex(centerId);
        }

        await Promise.all([refreshCenters(), loadCenterData(centerId)]);
      } catch (err) {
        setUploadError(
          err instanceof Error
            ? err.message
            : 'Errore imprevisto durante la lettura o indicizzazione del PDF.'
        );
      } finally {
        setUploadProgress(null);
      }
    },
    [loadCenterData, refreshCenters]
  );

  const handleUploadPdfs = useCallback(
    async (files: File[], preferAiOcr: boolean) => {
      if (!selectedCenterId) return;
      const items: Array<{ fileName: string; buffer: ArrayBuffer }> = [];
      for (const file of files) {
        items.push({
          fileName: file.name,
          buffer: await file.arrayBuffer(),
        });
      }
      await processBuffersIntoCenter(selectedCenterId, items, preferAiOcr);
    },
    [processBuffersIntoCenter, selectedCenterId]
  );

  const handleDeletePdf = useCallback(
    async (pdfId: string) => {
      if (!selectedCenterId) return;
      invalidateCenterIndex(selectedCenterId);
      await deletePdfAndAddresses(selectedCenterId, pdfId);
      await Promise.all([refreshCenters(), loadCenterData(selectedCenterId)]);
    },
    [loadCenterData, refreshCenters, selectedCenterId]
  );

  const importBundledSamples = useCallback(
    async (targetCenterId?: string) => {
      setUploadError(null);
      let cid = targetCenterId;
      if (!cid) {
        const created = await createCenter(
          'Sant’Angelo Lodigiano CD',
          'Frazionario 38687 · Libretti Gita Zona 1 e Zona 2'
        );
        cid = created.id;
        await refreshCenters();
      }

      setSelectedCenterId(cid);

      const loadedBuffers: Array<{ fileName: string; buffer: ArrayBuffer }> = [];
      try {
        for (const sample of BUNDLED_SAMPLE_PDFS) {
          setUploadProgress({
            fileName: sample.fileName,
            stage: 'reading',
            currentPage: 0,
            totalPages: 0,
            extractedSoFar: 0,
            message: `Caricamento ${sample.fileName}...`,
          });
          const resp = await fetch(sample.url);
          if (!resp.ok) {
            throw new Error(`Impossibile leggere ${sample.fileName}`);
          }
          loadedBuffers.push({
            fileName: sample.fileName,
            buffer: await resp.arrayBuffer(),
          });
        }
        await processBuffersIntoCenter(cid, loadedBuffers, false);
        setView('center');
      } catch (err) {
        setUploadProgress(null);
        setUploadError(
          err instanceof Error
            ? err.message
            : 'Impossibile importare i libretti reali.'
        );
      }
    },
    [processBuffersIntoCenter, refreshCenters]
  );

  return (
    <div className="min-h-screen bg-[#F5F7FB] text-[#0A1628]">
      {view !== 'operational' && (
        <PWAInstallBanner
          canInstallNative={pwa.canInstallNative}
          isInstalled={pwa.isInstalled}
          isIOS={pwa.isIOS}
          isOnline={pwa.isOnline}
          updateAvailable={pwa.updateAvailable}
          onInstall={pwa.promptInstall}
          onApplyUpdate={pwa.applyUpdate}
        />
      )}

      {view === 'home' && (
        <HomeScreen
          centers={centers}
          loading={loadingCenters}
          sampleProgress={uploadProgress}
          onSelectCenter={(cid) => void handleSelectCenter(cid, 'center')}
          onStartVoiceCenter={(cid) => void handleSelectCenter(cid, 'operational')}
          onCreateCenter={handleCreateCenter}
          onDeleteCenter={handleDeleteCenter}
          onImportSampleCenter={() => importBundledSamples()}
        />
      )}

      {view === 'center' && selectedCenter && (
        <CenterDetailScreen
          center={selectedCenter}
          pdfs={centerPdfs}
          addresses={centerAddresses}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          aiOcrAvailable={aiOcrAvailable}
          onBack={() => {
            setUploadError(null);
            setView('home');
          }}
          onStartOperational={() => setView('operational')}
          onUploadPdfs={handleUploadPdfs}
          onDeletePdf={handleDeletePdf}
          onImportBundledSamplesIntoCenter={() => importBundledSamples(selectedCenter.id)}
        />
      )}

      {view === 'operational' && selectedCenter && (
        <OperationalModeScreen
          center={selectedCenter}
          addresses={centerAddresses}
          onBack={() => setView('center')}
        />
      )}
    </div>
  );
}
