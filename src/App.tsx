import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminAuthModal } from './components/AdminAuthModal';
import { AdminPanelScreen } from './components/AdminPanelScreen';
import { CenterDetailScreen } from './components/CenterDetailScreen';
import { HomeScreen, type HomeCenterItem } from './components/HomeScreen';
import { OperationalModeScreen } from './components/OperationalModeScreen';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import {
  applyCenterSyncDelta,
  drainSyncQueue,
  enqueueSyncAck,
  listCenters,
  listPdfsByCenter,
  loadCenterAddresses,
  removeCenterFromDevice,
  requestPersistentStorage,
} from './db/indexedDb';
import { invalidateCenterIndex } from './engine/searchEngine';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  getSupabaseClient,
  loadPersistentSupabaseConfig,
} from './lib/supabaseClient';
import {
  fetchCenterSyncDelta,
  fetchCloudCenters,
  restoreAdminSessionApi,
  sendSyncAck,
  toFriendlyError,
} from './services/cloudApi';
import type {
  AddressRecord,
  AdminSession,
  CenterSyncStatus,
  DeliveryCenter,
  PdfDocumentRecord,
} from './types/sorting';

type ActiveView = 'home' | 'archive' | 'operational' | 'admin';

export default function App() {
  const pwa = usePWAInstall();

  const [view, setView] = useState<ActiveView>('home');
  const [cloudCenters, setCloudCenters] = useState<DeliveryCenter[]>([]);
  const [localCenters, setLocalCenters] = useState<DeliveryCenter[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(true);
  const [syncErrorBanner, setSyncErrorBanner] = useState<string | null>(null);
  const [syncingCenterIds, setSyncingCenterIds] = useState<Set<string>>(() => new Set());

  const [selectedCenterId, setSelectedCenterId] = useState<string | null>(null);
  const [centerPdfs, setCenterPdfs] = useState<PdfDocumentRecord[]>([]);
  const [centerAddresses, setCenterAddresses] = useState<AddressRecord[]>([]);

  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [showAdminAuthModal, setShowAdminAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<
    'auto' | 'supabase_setup' | 'force_change_password'
  >('auto');
  const [supabaseRevision, setSupabaseRevision] = useState(0);
  const [aiOcrAvailable, setAiOcrAvailable] = useState(false);

  const refreshLocalCenters = useCallback(async () => {
    const list = await listCenters();
    setLocalCenters(list);
    return list;
  }, []);

  const refreshCloudCenters = useCallback(async () => {
    if (!navigator.onLine) {
      setLoadingCloud(false);
      return;
    }
    setLoadingCloud(true);
    try {
      const list = await fetchCloudCenters();
      setCloudCenters(list);
      setSyncErrorBanner(null);
    } catch {
      // In assenza di rete o backend non ancora configurato, usa comunque IndexedDB locale
    } finally {
      setLoadingCloud(false);
    }
  }, []);

  const flushBackgroundSyncQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    const queued = await drainSyncQueue();
    for (const item of queued) {
      try {
        await sendSyncAck(item.centerId, item.action, item.version);
      } catch {
        await enqueueSyncAck({
          centerId: item.centerId,
          centerName: item.centerName,
          action: item.action,
          version: item.version,
        });
      }
    }
  }, []);

  // Avvio: carica configurazione Supabase persistente (env/localStorage/IndexedDB), ripristina sessione e sincronizza
  useEffect(() => {
    void requestPersistentStorage();
    void (async () => {
      await loadPersistentSupabaseConfig();
      setSupabaseRevision((r) => r + 1);

      const restored = await restoreAdminSessionApi().catch(() => null);
      if (restored) {
        setAdminSession(restored);
      }

      await Promise.all([refreshLocalCenters(), refreshCloudCenters()]);
      await flushBackgroundSyncQueue();
    })();

    fetch('/api/health')
      .then(async (r) => {
        if (!r.ok) return null;
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.aiOcrAvailable) setAiOcrAvailable(true);
      })
      .catch(() => {});
  }, [flushBackgroundSyncQueue, refreshCloudCenters, refreshLocalCenters]);

  // Sottoscrizione ciclo di vita sessione Supabase Auth (login, logout, refresh token, password recovery)
  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) return;

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAdminSession(null);
        setView((prev) => (prev === 'admin' ? 'home' : prev));
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        void (async () => {
          const restored = await restoreAdminSessionApi().catch(() => null);
          const recoverySession: AdminSession = restored ?? {
            token: session?.access_token || '',
            email: session?.user?.email?.toLowerCase() || 'andrea.graziano90@hotmail.it',
            role: 'admin',
            mustChangePassword: true,
            backendMode: 'supabase',
          };
          setAdminSession(recoverySession);
          setAuthModalMode('force_change_password');
          setShowAdminAuthModal(true);
        })();
        return;
      }

      if (event === 'TOKEN_REFRESHED' && session?.access_token) {
        setAdminSession((prev) =>
          prev ? { ...prev, token: session.access_token } : prev
        );
      }

      if (event === 'SIGNED_IN' && session?.access_token) {
        void (async () => {
          const restored = await restoreAdminSessionApi().catch(() => null);
          if (restored) {
            setAdminSession((prev) => prev ?? restored);
          }
        })();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseRevision]);

  useEffect(() => {
    if (pwa.isOnline) {
      void refreshCloudCenters();
      void flushBackgroundSyncQueue();
    }
  }, [flushBackgroundSyncQueue, pwa.isOnline, refreshCloudCenters]);

  const homeItems = useMemo<HomeCenterItem[]>(() => {
    const localMap = new Map(localCenters.map((c) => [c.id, c]));
    const cloudMap = new Map(cloudCenters.map((c) => [c.id, c]));
    const seenIds = new Set<string>();
    const items: HomeCenterItem[] = [];

    for (const cloud of cloudCenters) {
      seenIds.add(cloud.id);
      const local = localMap.get(cloud.id);
      const localVersion = local?.localVersion ?? null;
      const hasLocalArchive = Boolean(local);
      let syncStatus: CenterSyncStatus = 'not_synced';
      if (hasLocalArchive) {
        syncStatus =
          localVersion !== null && localVersion < cloud.version
            ? 'update_available'
            : 'synced';
      }
      items.push({
        center: cloud,
        cloudVersion: cloud.version,
        localVersion,
        syncStatus,
        hasLocalArchive,
      });
    }

    for (const local of localCenters) {
      if (seenIds.has(local.id)) continue;
      const cloud = cloudMap.get(local.id);
      items.push({
        center: local,
        cloudVersion: cloud?.version ?? null,
        localVersion: local.localVersion ?? local.version,
        syncStatus: 'synced',
        hasLocalArchive: true,
      });
    }

    return items.sort((a, b) => b.center.updatedAt - a.center.updatedAt);
  }, [cloudCenters, localCenters]);

  const selectedLocalCenter =
    localCenters.find((c) => c.id === selectedCenterId) ?? null;

  const loadLocalCenterArchive = useCallback(async (centerId: string) => {
    const [pdfs, addresses] = await Promise.all([
      listPdfsByCenter(centerId),
      loadCenterAddresses(centerId),
    ]);
    setCenterPdfs(pdfs);
    setCenterAddresses(addresses);
  }, []);

  const handleOpenLocalView = useCallback(
    async (centerId: string, targetView: 'archive' | 'operational') => {
      setSelectedCenterId(centerId);
      await loadLocalCenterArchive(centerId);
      setView(targetView);
    },
    [loadLocalCenterArchive]
  );

  const runSelectiveSync = useCallback(
    async (centerId: string, isIncrementalUpdate: boolean) => {
      setSyncErrorBanner(null);
      setSyncingCenterIds((prev) => new Set(prev).add(centerId));
      try {
        const local = localCenters.find((c) => c.id === centerId);
        const sinceVersion = isIncrementalUpdate ? local?.localVersion ?? 0 : 0;
        const delta = await fetchCenterSyncDelta(centerId, sinceVersion);
        await applyCenterSyncDelta(delta);
        invalidateCenterIndex(centerId);

        const ackAction =
          delta.mode === 'delta' ? 'aggiornamento_incrementale' : 'sincronizzazione';
        try {
          await sendSyncAck(centerId, ackAction, delta.toVersion);
        } catch {
          await enqueueSyncAck({
            centerId,
            centerName: delta.center.name,
            action: ackAction,
            version: delta.toVersion,
          });
        }

        await refreshLocalCenters();
        if (selectedCenterId === centerId) {
          await loadLocalCenterArchive(centerId);
        }
      } catch (err) {
        setSyncErrorBanner(
          toFriendlyError(err, 'Sincronizzazione non riuscita. Verifica la connessione.').message
        );
      } finally {
        setSyncingCenterIds((prev) => {
          const next = new Set(prev);
          next.delete(centerId);
          return next;
        });
      }
    },
    [loadLocalCenterArchive, localCenters, refreshLocalCenters, selectedCenterId]
  );

  const handleRemoveLocalCenter = useCallback(
    async (centerId: string) => {
      invalidateCenterIndex(centerId);
      await removeCenterFromDevice(centerId);
      if (selectedCenterId === centerId) {
        setSelectedCenterId(null);
        setCenterPdfs([]);
        setCenterAddresses([]);
        if (view === 'archive' || view === 'operational') {
          setView('home');
        }
      }
      await refreshLocalCenters();
    },
    [refreshLocalCenters, selectedCenterId, view]
  );

  const handleOpenAdmin = () => {
    if (adminSession && !adminSession.mustChangePassword) {
      setView('admin');
    } else if (adminSession && adminSession.mustChangePassword) {
      setAuthModalMode('force_change_password');
      setShowAdminAuthModal(true);
    } else {
      setAuthModalMode('auto');
      setShowAdminAuthModal(true);
    }
  };

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

      {syncErrorBanner && view === 'home' && (
        <div
          role="alert"
          className="bg-red-50 border-b border-red-200 px-4 py-2.5 text-xs sm:text-sm font-semibold text-red-700 text-center"
        >
          {syncErrorBanner}
        </div>
      )}

      {view === 'home' && (
        <HomeScreen
          items={homeItems}
          loading={loadingCloud}
          isOnline={pwa.isOnline}
          adminSession={adminSession}
          syncingCenterIds={syncingCenterIds}
          onOpenAdmin={handleOpenAdmin}
          onRefreshCloud={refreshCloudCenters}
          onSyncCenter={(cid) => runSelectiveSync(cid, false)}
          onUpdateCenter={(cid) => runSelectiveSync(cid, true)}
          onRemoveLocalCenter={handleRemoveLocalCenter}
          onStartVoiceCenter={(cid) => void handleOpenLocalView(cid, 'operational')}
          onInspectLocalArchive={(cid) => void handleOpenLocalView(cid, 'archive')}
        />
      )}

      {view === 'archive' && selectedLocalCenter && (
        <CenterDetailScreen
          center={selectedLocalCenter}
          pdfs={centerPdfs}
          addresses={centerAddresses}
          onBack={() => setView('home')}
          onStartOperational={() => setView('operational')}
        />
      )}

      {view === 'operational' && selectedLocalCenter && (
        <OperationalModeScreen
          center={selectedLocalCenter}
          addresses={centerAddresses}
          onBack={() => setView('home')}
        />
      )}

      {view === 'admin' && adminSession && (
        <AdminPanelScreen
          session={adminSession}
          cloudCenters={cloudCenters}
          localCenters={localCenters}
          isOnline={pwa.isOnline}
          aiOcrAvailable={aiOcrAvailable}
          onBackHome={() => setView('home')}
          onLoggedOut={() => {
            setAdminSession(null);
            setView('home');
          }}
          onCentersChanged={refreshCloudCenters}
          onOpenSupabaseSetup={() => {
            setAuthModalMode('supabase_setup');
            setShowAdminAuthModal(true);
          }}
          onSupabaseDisconnected={() => {
            setAdminSession(null);
            setCloudCenters([]);
            setView('home');
            setSupabaseRevision((r) => r + 1);
          }}
        />
      )}

      {showAdminAuthModal && (
        <AdminAuthModal
          initialMode={authModalMode}
          activeSessionForPasswordChange={adminSession}
          onClose={() => {
            setShowAdminAuthModal(false);
            setAuthModalMode('auto');
          }}
          onSupabaseConfigured={async () => {
            setSupabaseRevision((r) => r + 1);
            await refreshCloudCenters();
          }}
          onAuthenticated={(session) => {
            setAdminSession(session);
            setShowAdminAuthModal(false);
            setAuthModalMode('auto');
            setView('admin');
            void refreshCloudCenters();
          }}
        />
      )}
    </div>
  );
}
