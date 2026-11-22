import { KeyRound, Lock, Mail, ShieldCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  changeAdminPasswordApi,
  checkAdminEmail,
  loginAdminApi,
  requestPasswordRecoveryApi,
  setupFirstAdminPasswordApi,
} from '../services/cloudApi';
import type { AdminSession } from '../types/sorting';

interface AdminAuthModalProps {
  onClose: () => void;
  onAuthenticated: (session: AdminSession) => void;
}

type AuthStep =
  | 'email_password'
  | 'setup_first_password'
  | 'force_change_password'
  | 'forgot_password';

export function AdminAuthModal({ onClose, onAuthenticated }: AdminAuthModalProps) {
  const [step, setStep] = useState<AuthStep>('email_password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingSession, setPendingSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleCheckAndLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    setLoading(true);
    try {
      const status = await checkAdminEmail(trimmedEmail);
      if (!status.exists || !status.active) {
        setError('Account amministratore non autorizzato o disattivato.');
        return;
      }

      if (status.needsInitialPasswordSetup) {
        setStep('setup_first_password');
        setInfoMessage(
          'Primo accesso rilevato: crea la password amministratore (minimo 8 caratteri).'
        );
        return;
      }

      if (!password) {
        setError('Inserisci la password amministratore.');
        return;
      }

      const session = await loginAdminApi(trimmedEmail, password);
      if (session.mustChangePassword) {
        setPendingSession(session);
        setStep('force_change_password');
        setInfoMessage('Cambio password obbligatorio al primo accesso.');
      } else {
        onAuthenticated(session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accesso non riuscito.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupFirstPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
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
      const session = await setupFirstAdminPasswordApi(email.trim(), newPassword);
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile impostare la password.');
    } finally {
      setLoading(false);
    }
  };

  const handleForceChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!pendingSession) return;
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
      await changeAdminPasswordApi(pendingSession.token, newPassword);
      onAuthenticated({
        ...pendingSession,
        mustChangePassword: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cambio password non riuscito.');
    } finally {
      setLoading(false);
    }
  };

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
      setError(err instanceof Error ? err.message : 'Errore recupero password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 pb-operative sm:pb-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#003399] text-[#FFD100] flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[#003399]">
                Accesso Amministratore
              </h2>
              <p className="text-xs text-slate-500">
                Registrazione pubblica disabilitata
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Chiudi"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
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
                  placeholder="Andrea.graziano90@hotmail.it"
                  className="w-full min-h-[48px] pl-10 pr-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Password (lascia vuoto al primo accesso per crearla)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[48px] pl-10 pr-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfoMessage(null);
                  setStep('forgot_password');
                }}
                className="font-bold text-[#003399] hover:underline py-2"
              >
                Recupera password tramite email
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-[#003399] hover:bg-[#002677] text-white font-bold text-sm disabled:opacity-50"
            >
              {loading ? 'Verifica in corso...' : 'Accedi al Pannello Admin'}
            </button>
          </form>
        )}

        {(step === 'setup_first_password' || step === 'force_change_password') && (
          <form
            onSubmit={
              step === 'setup_first_password'
                ? handleSetupFirstPassword
                : handleForceChangePassword
            }
            className="space-y-4"
          >
            <div className="text-xs font-semibold text-slate-600">
              Account: <span className="font-bold text-[#0A1628]">{email}</span>
            </div>

            <div>
              <label
                htmlFor="new-admin-pw"
                className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Nuova Password (min. 8 caratteri)
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

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-[#FFD100] hover:bg-[#EBC000] text-[#002677] font-extrabold text-sm disabled:opacity-50"
            >
              {loading ? 'Salvataggio...' : 'Salva Password e Accedi'}
            </button>
          </form>
        )}

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
                placeholder="Andrea.graziano90@hotmail.it"
                className="w-full min-h-[48px] px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:border-[#003399]"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfoMessage(null);
                  setStep('email_password');
                }}
                className="flex-1 min-h-[48px] rounded-xl border border-slate-300 text-slate-700 font-bold text-sm"
              >
                Indietro
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 min-h-[48px] rounded-xl bg-[#003399] text-white font-bold text-sm disabled:opacity-50"
              >
                {loading ? 'Invio...' : 'Invia Recupero'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
