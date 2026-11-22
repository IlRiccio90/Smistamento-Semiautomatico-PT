import type {
  ActivityLogEntry,
  AddressRecord,
  AdminSession,
  AdminUserRecord,
  CenterBackupRecord,
  CloudSyncDeltaResponse,
  DeliveryCenter,
  PdfDocumentRecord,
} from '../types/sorting';

async function apiFetch<T>(
  url: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  const reqHeaders = new Headers(headers);
  if (!reqHeaders.has('Content-Type') && rest.body) {
    reqHeaders.set('Content-Type', 'application/json');
  }
  if (token) {
    reqHeaders.set('Authorization', `Bearer ${token}`);
  }

  const resp = await fetch(url, { ...rest, headers: reqHeaders });
  const text = await resp.text();
  const json = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new Error(json?.error || `Errore server (${resp.status})`);
  }
  return json as T;
}

export async function fetchCloudCenters(): Promise<DeliveryCenter[]> {
  const res = await apiFetch<{ centers: DeliveryCenter[] }>('/api/cloud/centers');
  return res.centers;
}

export async function fetchCenterSyncDelta(
  centerId: string,
  sinceVersion = 0
): Promise<CloudSyncDeltaResponse> {
  return apiFetch<CloudSyncDeltaResponse>(
    `/api/cloud/centers/${encodeURIComponent(centerId)}/sync?sinceVersion=${sinceVersion}`
  );
}

export async function sendSyncAck(
  centerId: string,
  action: 'sincronizzazione' | 'aggiornamento_incrementale',
  version: number
): Promise<void> {
  await apiFetch('/api/cloud/centers/' + encodeURIComponent(centerId) + '/sync-ack', {
    method: 'POST',
    body: JSON.stringify({ action, version }),
  });
}

// ---- AUTH ----

export async function checkAdminEmail(email: string): Promise<{
  exists: boolean;
  active: boolean;
  needsInitialPasswordSetup: boolean;
  mustChangePassword: boolean;
  backendMode: 'supabase' | 'local-cloud';
}> {
  return apiFetch('/api/auth/check-email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function setupFirstAdminPasswordApi(
  email: string,
  password: string
): Promise<AdminSession> {
  const res = await apiFetch<{
    token: string;
    email: string;
    mustChangePassword: boolean;
    backendMode: 'supabase' | 'local-cloud';
  }>('/api/auth/setup-first-password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return {
    token: res.token,
    email: res.email,
    role: 'admin',
    mustChangePassword: res.mustChangePassword,
    backendMode: res.backendMode,
  };
}

export async function loginAdminApi(
  email: string,
  password: string
): Promise<AdminSession> {
  const res = await apiFetch<{
    token: string;
    email: string;
    mustChangePassword: boolean;
    backendMode: 'supabase' | 'local-cloud';
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return {
    token: res.token,
    email: res.email,
    role: 'admin',
    mustChangePassword: res.mustChangePassword,
    backendMode: res.backendMode,
  };
}

export async function changeAdminPasswordApi(
  token: string,
  newPassword: string
): Promise<void> {
  await apiFetch('/api/auth/change-password', {
    method: 'POST',
    token,
    body: JSON.stringify({ newPassword }),
  });
}

export async function requestPasswordRecoveryApi(
  email: string
): Promise<{ sent: boolean; message: string }> {
  return apiFetch('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      email,
      redirectTo: window.location.origin,
    }),
  });
}

export async function logoutAdminApi(token: string): Promise<void> {
  await apiFetch('/api/auth/logout', {
    method: 'POST',
    token,
  }).catch(() => {});
}

// ---- ADMIN CENTERS & PDFS ----

export async function adminCreateCenterApi(
  token: string,
  name: string,
  notes: string
): Promise<DeliveryCenter> {
  const res = await apiFetch<{ center: DeliveryCenter }>('/api/admin/centers', {
    method: 'POST',
    token,
    body: JSON.stringify({ name, notes }),
  });
  return res.center;
}

export async function adminUpdateCenterApi(
  token: string,
  centerId: string,
  name: string,
  notes: string
): Promise<DeliveryCenter> {
  const res = await apiFetch<{ center: DeliveryCenter }>(
    `/api/admin/centers/${encodeURIComponent(centerId)}`,
    {
      method: 'PATCH',
      token,
      body: JSON.stringify({ name, notes }),
    }
  );
  return res.center;
}

export async function adminDeleteCenterApi(token: string, centerId: string): Promise<void> {
  await apiFetch(`/api/admin/centers/${encodeURIComponent(centerId)}`, {
    method: 'DELETE',
    token,
  });
}

export async function adminListCenterPdfsApi(
  token: string,
  centerId: string
): Promise<PdfDocumentRecord[]> {
  const res = await apiFetch<{ pdfs: PdfDocumentRecord[] }>(
    `/api/admin/centers/${encodeURIComponent(centerId)}/pdfs`,
    { token }
  );
  return res.pdfs;
}

export async function adminCheckDuplicatePdfApi(
  token: string,
  centerId: string,
  fileName: string,
  fileHash: string,
  zoneNumber: string
): Promise<{ duplicatePdf: PdfDocumentRecord | null; reason: string }> {
  return apiFetch(`/api/admin/centers/${encodeURIComponent(centerId)}/pdfs/check-duplicate`, {
    method: 'POST',
    token,
    body: JSON.stringify({ fileName, fileHash, zoneNumber }),
  });
}

export async function adminUploadPdfApi(
  token: string,
  centerId: string,
  payload: {
    pdfRecord: PdfDocumentRecord;
    pdfBase64?: string;
    addresses: AddressRecord[];
    duplicateResolution?: 'replace' | 'keep_both' | 'new';
    replacePdfId?: string;
  }
): Promise<{ center: DeliveryCenter; pdf: PdfDocumentRecord }> {
  return apiFetch(`/api/admin/centers/${encodeURIComponent(centerId)}/pdfs`, {
    method: 'POST',
    token,
    body: JSON.stringify(payload),
  });
}

export async function adminDeletePdfApi(
  token: string,
  centerId: string,
  pdfId: string
): Promise<DeliveryCenter> {
  const res = await apiFetch<{ center: DeliveryCenter }>(
    `/api/admin/centers/${encodeURIComponent(centerId)}/pdfs/${encodeURIComponent(pdfId)}`,
    {
      method: 'DELETE',
      token,
    }
  );
  return res.center;
}

export async function adminRegenerateCenterDbApi(
  token: string,
  centerId: string
): Promise<DeliveryCenter> {
  const res = await apiFetch<{ center: DeliveryCenter }>(
    `/api/admin/centers/${encodeURIComponent(centerId)}/regenerate`,
    {
      method: 'POST',
      token,
    }
  );
  return res.center;
}

// ---- ADMIN USERS, BACKUPS, LOGS, DIAGNOSTICS ----

export async function adminListUsersApi(token: string): Promise<AdminUserRecord[]> {
  const res = await apiFetch<{ users: AdminUserRecord[] }>('/api/admin/users', { token });
  return res.users;
}

export async function adminCreateUserApi(
  token: string,
  email: string,
  initialPassword?: string
): Promise<AdminUserRecord> {
  const res = await apiFetch<{ user: AdminUserRecord }>('/api/admin/users', {
    method: 'POST',
    token,
    body: JSON.stringify({ email, initialPassword }),
  });
  return res.user;
}

export async function adminToggleUserActiveApi(
  token: string,
  userId: string,
  active: boolean
): Promise<AdminUserRecord> {
  const res = await apiFetch<{ user: AdminUserRecord }>(
    `/api/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      token,
      body: JSON.stringify({ active }),
    }
  );
  return res.user;
}

export async function adminListLogsApi(token: string): Promise<ActivityLogEntry[]> {
  const res = await apiFetch<{ logs: ActivityLogEntry[] }>('/api/admin/logs', { token });
  return res.logs;
}

export async function adminListBackupsApi(token: string): Promise<CenterBackupRecord[]> {
  const res = await apiFetch<{ backups: CenterBackupRecord[] }>('/api/admin/backups', { token });
  return res.backups;
}

export async function adminCreateBackupApi(
  token: string,
  centerId: string
): Promise<CenterBackupRecord[]> {
  const res = await apiFetch<{ backups: CenterBackupRecord[] }>('/api/admin/backups', {
    method: 'POST',
    token,
    body: JSON.stringify({ centerId }),
  });
  return res.backups;
}

export async function adminExportCenterApi(
  token: string,
  centerId: string
): Promise<unknown> {
  return apiFetch(`/api/admin/centers/${encodeURIComponent(centerId)}/export`, { token });
}

export async function adminRestoreBackupApi(
  token: string,
  options: { backupId?: string; importedPayload?: unknown }
): Promise<DeliveryCenter> {
  const res = await apiFetch<{ center: DeliveryCenter }>('/api/admin/backups/restore', {
    method: 'POST',
    token,
    body: JSON.stringify(options),
  });
  return res.center;
}

export async function adminGetDiagnosticsApi(token: string): Promise<{
  backendMode: 'supabase' | 'local-cloud';
  cloudCentersCount: number;
  cloudPdfsCount: number;
  cloudAddressesCount: number;
  cloudTotalStorageBytes: number;
}> {
  return apiFetch('/api/admin/diagnostics', { token });
}
