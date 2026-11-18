import { Download, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { useState } from 'react';

interface PWAInstallBannerProps {
  canInstallNative: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isOnline: boolean;
  updateAvailable: boolean;
  onInstall: () => Promise<boolean>;
  onApplyUpdate: () => Promise<void>;
}

export function PWAInstallBanner({
  canInstallNative,
  isInstalled,
  isIOS,
  isOnline,
  updateAvailable,
  onInstall,
  onApplyUpdate,
}: PWAInstallBannerProps) {
  const [dismissedIOS, setDismissedIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  return (
    <>
      {!isOnline && (
        <div
          role="status"
          className="bg-[#002677] text-[#FFD100] px-4 py-2 text-xs font-semibold flex items-center justify-center gap-2 border-b border-white/10"
        >
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Modalità Offline attiva · Ricerca e archivio locale operativi</span>
        </div>
      )}

      {updateAvailable && (
        <div className="bg-[#FFD100] text-[#002677] px-4 py-2 text-xs font-bold flex items-center justify-between gap-3 border-b border-[#002677]/15">
          <span>Nuova versione dell’app disponibile</span>
          <button
            type="button"
            onClick={onApplyUpdate}
            className="min-h-[36px] px-3 rounded-lg bg-[#003399] text-white text-xs font-bold inline-flex items-center gap-1.5 active:scale-[0.98]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Aggiorna
          </button>
        </div>
      )}

      {canInstallNative && (
        <div className="bg-white border-b border-slate-200 px-4 py-2.5">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#003399] truncate">
                Installa su smartphone Android
              </p>
              <p className="text-xs text-slate-600 truncate">
                Accesso rapido da schermata Home e funzionamento offline
              </p>
            </div>
            <button
              type="button"
              onClick={onInstall}
              className="min-h-[44px] px-4 rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] text-sm font-extrabold inline-flex items-center gap-2 shrink-0 transition-colors active:scale-[0.98]"
            >
              <Download className="w-4 h-4" />
              Installa App
            </button>
          </div>
        </div>
      )}

      {!canInstallNative && !isInstalled && isIOS && !dismissedIOS && (
        <div className="bg-white border-b border-slate-200 px-4 py-2">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowIOSModal(true)}
              className="min-h-[44px] text-left flex items-center gap-2 text-xs font-semibold text-[#003399]"
            >
              <Share className="w-4 h-4 shrink-0" />
              <span>Aggiungi a Home su iPhone/iPad per uso a schermo intero</span>
            </button>
            <button
              type="button"
              aria-label="Chiudi suggerimento installazione"
              onClick={() => setDismissedIOS(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showIOSModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowIOSModal(false)}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-extrabold text-[#003399]">
                Installa su iOS Safari
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-slate-700">
              <li>1. Tocca l’icona <strong>Condividi</strong> nella barra di Safari.</li>
              <li>2. Scorri e seleziona <strong>Aggiungi alla schermata Home</strong>.</li>
              <li>3. Conferma con <strong>Aggiungi</strong> per avviare l’app offline.</li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
