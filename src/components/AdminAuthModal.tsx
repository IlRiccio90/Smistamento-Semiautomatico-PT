import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import {
  changeAdminPasswordApi,
  checkAdminEmail,
  loginAdminApi,
  logoutAdminApi,
  requestPasswordRecoveryApi,
  setupFirstAdminPasswordApi,
  toFriendlyError,
  verifyAndEnsureAdminAccess,
} from '../services/cloudApi';
import type { AdminAuthDiagnostics, AdminSession } from '../types/sorting';

interface AdminAuthModalProps {
  initialMode?: 'auto' | 'force_change_password';
  activeSessionForPasswordChange?: AdminSession | null;
  onClose: () => void;
  onAuthenticated: (session: AdminSession) => void;
}

type AuthStep =
  | 'checking'
  | 'email_password'
  | 'setup_first_password'
  | 'auth_diagnostics'
  | 'force_change_password'
  | 'forgot_password';

const DEFAULT_ADMIN_EMAIL = 'andrea.graziano90@hotmail.it';

export function AdminAuthModal({
  initialMode = 'auto',
  activeSessionForPasswordChange = null,
  onClose,
  onAuthenticated,
}: AdminAuthModalProps) {
  const [step, setStep] = useState<AuthStep>(() => {
    if (initialMode === 'force_change_password') {
      return 'force_change_password';
    }
    return isSupabaseConfigured() ? 'checking' : 'email_password';
  });

  // Auth state
  const [email, setEmail] = useState(
    activeSessionForPasswordChange?.email || DEFAULT_ADMIN_EMAIL
  );
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingSession, setPendingSession] = useState<AdminSession | null>(
    activeSessionForPasswordChange
  );

  // Diagnostica post-login temporanea
  const [diagnostics, setDiagnostics] = useState<AdminAuthDiagnostics | null>(null);
  const [verifiedSession, setVerifiedSession] = useState<AdminSession | null>(null);
  const autoRedirectTimerRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    isSupabaseConfigured()
      ? null
      : 'Servizio cloud temporaneamente non disponibile. Verifica la connessione o contatta l’amministratore di sistema.'
  );
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const clearAutoRedirect = () => {
    if (autoRedirectTimerRef.current !== null) {
      window.clearTimeout(autoRedirectTimerRef.current);
      autoRedirectTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearAutoRedirect();
  }, []);

  const showDiagnosticsAndMaybeProceed = (
    diag: AdminAuthDiagnostics,
    session: AdminSession | null
  ) => {
    clearAutoRedirect();
    setDiagnostics(diag);
    setVerifiedSession(session);
    setStep('auth_diagnostics');

    if (diag.allPassed && session) {
      setInfoMessage('Tutti i controlli superati. Accesso diretto al pannello amministratore...');
      autoRedirectTimerRef.current = window.setTimeout(() => {
        onAuthenticated(session);
      }, 1100);
    } else if (diag.errorMessage) {
      setError(diag.errorMessage);
    }
  };

  const detectFirstAdminState = async () => {
    setError(null);
    setInfoMessage(null);
    setStep('checking');
    try {
      // 1. Se esiste una sessione Supabase valida, NON mostrare MAI "Crea Password"
      const currentCheck = await verifyAndEnsureAdminAccess();
      if (currentCheck.diagnostics.validSession) {
        showDiagnosticsAndMaybeProceed(currentCheck.diagnostics, currentCheck.session);
        return;
      }

      // 2. Nessuna sessione attiva: verifica se l'utente deve ancora creare la password iniziale
      const status = await checkAdminEmail(DEFAULT_ADMIN_EMAIL);
      if (status.exists && status.active && status.needsInitialPasswordSetup) {
        setEmail(DEFAULT_ADMIN_EMAIL);
        setStep('setup_first_password');
        setInfoMessage(
          `Primo accesso per ${DEFAULT_ADMIN_EMAIL}: crea la tua password amministratore (minimo 8 caratteri).`
        );
      } else {
        setStep('email_password');
      }
    } catch (err) {
      setStep('email_password');
      setError(toFriendlyError(err, 'Impossibile verificare lo stato del servizio cloud.').message);
    }
  };

  useEffect(() => {
    if (step === 'checking') {
      void detectFirstAdminState();
    }
  }, []);

  // ---- STEP: LOGIN AMMINISTRATORE ----
  const handleCheckAndLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;
    if (!password) {
      setError('Inserisci la password amministratore.');
      return;
    }

    setLoading(true);
    try {
      const result = await loginAdminApi(trimmedEmail, password);
      showDiagnosticsAndMaybeProceed(result.diagnostics, result.session);
    } catch (err) {
      setError(toFriendlyError(err, 'Accesso non riuscito.').message);
    } finally {
      setLoading(false);
    }
  };

  // ---- STEP: CREA PASSWORD (SOLO QUANDO UTENTE NON ESISTE O NON HA CREDENZIALI) ----
  const handleSetupFirstPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (newPassword.length < 8) {
      setError('La password deve contenere almeno 8 caratteri.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Le due password non coincidono.');
      return;
    }

    setLoading(true);
    try {
      const result = await setupFirstAdminPasswordApi(email.trim(), newPassword);
      if (result.emailConfirmationPending || !result.session) {
        setPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setStep('email_password');
        setInfoMessage(
          result.message ||
            'Password creata! Controlla la tua casella email per confermare l’account e poi effettua il login.'
        );
        return;
      }
      if (result.diagnostics) {
        showDiagnosticsAndMaybeProceed(result.diagnostics, result.session);
      } else {
        onAuthenticated(result.session);
      }
    } catch (err) {
      const friendly = toFriendlyError(err, 'Impossibile impostare la password.');
      if (
        friendly.message.includes('già registrato') ||
        friendly.message.includes('possiede già una password')
      ) {
        setStep('email_password');
        setInfoMessage('Questo account possiede già una password. Effettua il login.');
      } else {
        setError(friendly.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // ---- STEP: CAMBIO PASSWORD DA RECUPERO EMAIL ----
  const handleForceChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('La nuova password deve contenere almeno 8 caratteri.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Le due password non coincidono.');
      return;
    }

    setLoading(true);
    try {
      await changeAdminPasswordApi(pendingSession?.token || '', newPassword);
      const verified = await verifyAndEnsureAdminAccess();
      showDiagnosticsAndMaybeProceed(verified.diagnostics, verified.session);
    } catch (err) {
      setError(toFriendlyError(err, 'Cambio password non riuscito.').message);
    } finally {
      setLoading(false);
    }
  };

  // ---- STEP: RECUPERO PASSWORD ----
  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    if (!email.trim()) {
      setError('Inserisci l’email amministratore.');
      return;
    }
    setLoading(true);
    try {
      const res = await requestPasswordRecoveryApi(email.trim());
      setInfoMessage(res.message);
    } catch (err) {
      setError(toFriendlyError(err, 'Errore invio recupero password.').message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryDiagnostics = async () => {
    setError(null);
    setInfoMessage(null);
    setLoading(true);
    try {
      const verified = await verifyAndEnsureAdminAccess();
      showDiagnosticsAndMaybeProceed(verified.diagnostics, verified.session);
    } catch (err) {
      setError(toFriendlyError(err, 'Verifica diagnostica non riuscita.').message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOutFromDiagnostics = async () => {
    clearAutoRedirect();
    await logoutAdminApi('');
    setDiagnostics(null);
    setVerifiedSession(null);
    setPassword('');
    setError(null);
    setInfoMessage(null);
    setStep('email_password');
  };

  const titleText =
    step === 'setup_first_password'
      ? 'Crea Password'
      : step === 'auth_diagnostics'
        ? 'Diagnostica Accesso Admin'
        : step === 'force_change_password'
          ? 'Imposta Nuova Password'
          : step === 'forgot_password'
            ? 'Recupero Password'
            : 'Accesso Amministratore';

  const subtitleText =
    step === 'auth_diagnostics'
      ? 'Verifica stato Auth, sessione e profilo'
      : 'Registrazione pubblica disabilitata';

  const diagnosticRows = diagnostics
    ? [
        { label: 'Utente Auth', ok: diagnostics.authUserExists },
        { label: 'Email confermata', ok: diagnostics.emailConfirmed },
        { label: 'Sessione valida', ok: diagnostics.validSession },
        { label: 'Profilo Admin', ok: diagnostics.adminProfileExists },
        { label: 'Ruolo Admin', ok: diagnostics.hasAdminRole },
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto flex items-start justify-center p-4 pb-dialog-safe"
      onClick={() => {
        clearAutoRedirect();
        onClose();
      }}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl my-auto max-h-[max(260px,calc(100dvh-272px))] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#003399] text-[#FFD100] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#003399]">{titleText}</h2>
              <p className="text-xs text-slate-500">{subtitleText}</p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Chiudi"
            onClick={() => {
              clearAutoRedirect();
              onClose();
            }}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {infoMessage && (
          <div className="mb-4 rounded-xl bg-blue-50 border border-blue-200 px-3.5 py-2.5 text-xs font-semibold text-[#003399]">
            {infoMessage}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700"
          >
            {error}
          </div>
        )}

        {/* CHECKING INITIAL STATE */}
        {step === 'checking' && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-[#003399]" />
            <p className="text-xs font-bold text-slate-600">
              Verifica sessione e profilo amministratore...
            </p>
          </div>
        )}

        {/* LOGIN AMMINISTRATORE */}
        {step === 'email_password' && (
          <form onSubmit={handleCheckAndLogin} className="space-y-4">
            <div>
              <label
                htmlFor="admin-email"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Email Amministratore
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={DEFAULT_ADMIN_EMAIL}
                  className="w-full min-h-[48px] pl-10 pr-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[48px] pl-10 pr-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
            </div>

            <div className="flex items-center justify-start text-xs">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfoMessage(null);
                  setStep('forgot_password');
                }}
                className="font-bold text-[#003399] hover:underline py-1.5"
              >
                Password dimenticata?
              </button>
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="submit"
                disabled={loading || !isSupabaseConfigured()}
                className="w-full min-h-[48px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm disabled:opacity-50"
              >
                {loading ? 'Accesso e verifica...' : 'Accedi al Pannello Admin'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[48px] rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
              >
                Annulla
              </button>
            </div>
          </form>
        )}

        {/* DIAGNOSTICA TEMPORANEA POST-LOGIN / SESSIONE */}
        {step === 'auth_diagnostics' && diagnostics && (
          <div className="space-y-4">
            {diagnostics.email && (
              <p className="text-xs font-semibold text-slate-600">
                Account: <strong className="text-[#0A1628]">{diagnostics.email}</strong>
              </p>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 divide-y divide-slate-200">
              {diagnosticRows.map((row) => (
                <div
                  key={row.label}
                  className="px-4 py-3 flex items-center justify-between text-xs sm:text-sm"
                >
                  <span className="font-bold text-slate-700">{row.label}:</span>
                  {row.ok ? (
                    <span className="inline-flex items-center gap-1.5 font-extrabold text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" />
                      SI
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-extrabold text-red-700">
                      <XCircle className="w-4 h-4" />
                      NO
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              {diagnostics.allPassed && verifiedSession ? (
                <button
                  type="button"
                  onClick={() => {
                    clearAutoRedirect();
                    onAuthenticated(verifiedSession);
                  }}
                  className="w-full min-h-[48px] rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-sm"
                >
                  Apri Pannello Amministratore
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleRetryDiagnostics()}
                    className="w-full min-h-[48px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm disabled:opacity-50"
                  >
                    {loading ? 'Verifica in corso...' : 'Riprova Verifica'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOutFromDiagnostics()}
                    className="w-full min-h-[48px] rounded-xl border border-red-200 text-red-700 font-bold text-sm hover:bg-red-50 inline-flex items-center justify-center gap-1.5"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Disconnetti Sessione</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  clearAutoRedirect();
                  onClose();
                }}
                className="w-full min-h-[48px] rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
              >
                Annulla
              </button>
            </div>
          </div>
        )}

        {/* CREA PASSWORD / IMPOSTA NUOVA PASSWORD */}
        {(step === 'setup_first_password' || step === 'force_change_password') && (
          <form
            onSubmit={
              step === 'setup_first_password'
                ? handleSetupFirstPassword
                : handleForceChangePassword
            }
            className="space-y-4"
          >
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-600">
              <span className="truncate">
                Account: <span className="font-bold text-[#0A1628]">{email}</span>
              </span>
              {step === 'setup_first_password' && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfoMessage(null);
                    setStep('email_password');
                  }}
                  className="text-[#003399] font-bold hover:underline shrink-0"
                >
                  Accedi con password
                </button>
              )}
            </div>

            <div>
              <label
                htmlFor="new-admin-pw"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                {step === 'setup_first_password'
                  ? 'Crea Password (min. 8 caratteri)'
                  : 'Nuova Password (min. 8 caratteri)'}
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="new-admin-pw"
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full min-h-[48px] pl-10 pr-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-admin-pw"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Conferma Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="confirm-admin-pw"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full min-h-[48px] pl-10 pr-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[48px] rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-sm disabled:opacity-50"
              >
                {loading
                  ? 'Salvataggio...'
                  : step === 'setup_first_password'
                    ? 'Crea Password e Accedi'
                    : 'Salva Nuova Password'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[48px] rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
              >
                Annulla
              </button>
            </div>
          </form>
        )}

        {/* RECUPERO PASSWORD */}
        {step === 'forgot_password' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label
                htmlFor="reset-email"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Email Amministratore
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={DEFAULT_ADMIN_EMAIL}
                className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
              />
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="submit"
                disabled={loading || !isSupabaseConfigured()}
                className="w-full min-h-[48px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm disabled:opacity-50"
              >
                {loading ? 'Invio...' : 'Invia Email di Recupero'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfoMessage(null);
                  setStep('email_password');
                }}
                className="w-full min-h-[48px] rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50"
              >
                Indietro
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
