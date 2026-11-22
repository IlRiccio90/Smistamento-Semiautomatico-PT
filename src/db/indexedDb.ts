import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AddressRecord,
  CloudSyncDeltaResponse,
  DeliveryCenter,
  PdfDocumentRecord,
} from '../types/sorting';

export interface SyncQueueItem {
  id: string;
  centerId: string;
  centerName: string;
  action: 'sincronizzazione' | 'aggiornamento_incrementale';
  version: number;
  createdAt: number;
}

interface SmistamentoDBSchema extends DBSchema {
  centers: {
    key: string;
    value: DeliveryCenter;
    indexes: { 'by-updated': number };
  };
  pdfs: {
    key: string;
    value: PdfDocumentRecord;
    indexes: { 'by-center': string };
  };
  pdfBlobs: {
    key: string;
    value: {
      id: string;
      centerId: string;
      buffer: ArrayBuffer;
    };
    indexes: { 'by-center': string };
  };
  addresses: {
    key: string;
    value: AddressRecord;
    indexes: {
      'by-center': string;
      'by-pdf': string;
      'by-center-comune': [string, string];
    };
  };
  syncMeta: {
    key: string;
    value: {
      key: string;
      value: string | number;
    };
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
  };
}

const DB_NAME = 'smistamento-pt-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<SmistamentoDBSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<SmistamentoDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<SmistamentoDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('centers')) {
          const centersStore = db.createObjectStore('centers', { keyPath: 'id' });
          centersStore.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('pdfs')) {
          const pdfsStore = db.createObjectStore('pdfs', { keyPath: 'id' });
          pdfsStore.createIndex('by-center', 'centerId');
        }
        if (!db.objectStoreNames.contains('pdfBlobs')) {
          const blobsStore = db.createObjectStore('pdfBlobs', { keyPath: 'id' });
          blobsStore.createIndex('by-center', 'centerId');
        }
        if (!db.objectStoreNames.contains('addresses')) {
          const addrStore = db.createObjectStore('addresses', { keyPath: 'id' });
          addrStore.createIndex('by-center', 'centerId');
          addrStore.createIndex('by-pdf', 'pdfId');
          addrStore.createIndex('by-center-comune', ['centerId', 'comuneNorm']);
        }
        if (!db.objectStoreNames.contains('syncMeta')) {
          db.createObjectStore('syncMeta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

export async function listCenters(): Promise<DeliveryCenter[]> {
  const db = await getDb();
  const all = await db.getAll('centers');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCenter(centerId: string): Promise<DeliveryCenter | undefined> {
  const db = await getDb();
  return db.get('centers', centerId);
}

export async function createCenter(name: string, notes: string): Promise<DeliveryCenter> {
  const db = await getDb();
  const now = Date.now();
  const center: DeliveryCenter = {
    id: crypto.randomUUID(),
    name: name.trim(),
    notes: notes.trim(),
    createdAt: now,
    updatedAt: now,
    version: 1,
    localVersion: 1,
    syncedAt: now,
    pdfCount: 0,
    addressCount: 0,
    zones: [],
    comuni: [],
  };
  await db.put('centers', center);
  return center;
}

export async function recomputeCenterStats(centerId: string): Promise<DeliveryCenter | null> {
  const db = await getDb();
  const center = await db.get('centers', centerId);
  if (!center) return null;

  const pdfs = await db.getAllFromIndex('pdfs', 'by-center', centerId);
  const addresses = await db.getAllFromIndex('addresses', 'by-center', centerId);

  const zonesSet = new Set<string>();
  const comuniSet = new Set<string>();

  for (const pdf of pdfs) {
    if (pdf.zoneNumber) zonesSet.add(pdf.zoneNumber);
  }
  for (const addr of addresses) {
    if (addr.zona) zonesSet.add(addr.zona);
    if (addr.comune) comuniSet.add(addr.comune);
  }

  const updated: DeliveryCenter = {
    ...center,
    pdfCount: pdfs.length,
    addressCount: addresses.length,
    zones: Array.from(zonesSet).sort((a, b) => a.localeCompare(b, 'it', { numeric: true })),
    comuni: Array.from(comuniSet).sort((a, b) => a.localeCompare(b, 'it')),
    updatedAt: Date.now(),
  };

  await db.put('centers', updated);
  return updated;
}

/**
 * Rimuove solo dal dispositivo locale (IndexedDB) un Centro sincronizzato.
 * Non modifica mai il database centrale cloud.
 */
export async function removeCenterFromDevice(centerId: string): Promise<void> {
  const db = await getDb();
  const pdfs = await db.getAllFromIndex('pdfs', 'by-center', centerId);
  const addrKeys = await db.getAllKeysFromIndex('addresses', 'by-center', centerId);

  const tx = db.transaction(['centers', 'pdfs', 'pdfBlobs', 'addresses'], 'readwrite');
  await tx.objectStore('centers').delete(centerId);
  for (const pdf of pdfs) {
    await tx.objectStore('pdfs').delete(pdf.id);
    await tx.objectStore('pdfBlobs').delete(pdf.id);
  }
  const addrStore = tx.objectStore('addresses');
  for (const key of addrKeys) {
    await addrStore.delete(key);
  }
  await tx.done;
}

export const deleteCenter = removeCenterFromDevice;

export async function listPdfsByCenter(centerId: string): Promise<PdfDocumentRecord[]> {
  const db = await getDb();
  const list = await db.getAllFromIndex('pdfs', 'by-center', centerId);
  return list.sort(
    (a, b) =>
      a.zoneNumber.localeCompare(b.zoneNumber, 'it', { numeric: true }) ||
      b.importedAt - a.importedAt
  );
}

export async function getPdfBlob(pdfId: string): Promise<ArrayBuffer | null> {
  const db = await getDb();
  const rec = await db.get('pdfBlobs', pdfId);
  return rec?.buffer ?? null;
}

export async function savePdfAndAddresses(
  pdfRecord: PdfDocumentRecord,
  pdfBuffer: ArrayBuffer,
  addresses: AddressRecord[]
): Promise<DeliveryCenter | null> {
  const db = await getDb();

  {
    const tx = db.transaction(['pdfs', 'pdfBlobs'], 'readwrite');
    await tx.objectStore('pdfs').put(pdfRecord);
    await tx.objectStore('pdfBlobs').put({
      id: pdfRecord.id,
      centerId: pdfRecord.centerId,
      buffer: pdfBuffer,
    });
    await tx.done;
  }

  const CHUNK_SIZE = 1000;
  for (let i = 0; i < addresses.length; i += CHUNK_SIZE) {
    const chunk = addresses.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction('addresses', 'readwrite');
    const store = tx.objectStore('addresses');
    for (const addr of chunk) {
      store.put(addr);
    }
    await tx.done;
  }

  return recomputeCenterStats(pdfRecord.centerId);
}

export async function deletePdfAndAddresses(
  centerId: string,
  pdfId: string
): Promise<DeliveryCenter | null> {
  const db = await getDb();
  const addrKeys = await db.getAllKeysFromIndex('addresses', 'by-pdf', pdfId);
  const tx = db.transaction(['pdfs', 'pdfBlobs', 'addresses'], 'readwrite');
  await tx.objectStore('pdfs').delete(pdfId);
  await tx.objectStore('pdfBlobs').delete(pdfId);
  const addrStore = tx.objectStore('addresses');
  for (const key of addrKeys) {
    await addrStore.delete(key);
  }
  await tx.done;

  return recomputeCenterStats(centerId);
}

export async function loadCenterAddresses(centerId: string): Promise<AddressRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex('addresses', 'by-center', centerId);
}

/**
 * Applica in locale (IndexedDB) la sincronizzazione completa o solo le differenze incrementali
 * scaricate dal cloud per uno specifico Centro di Recapito.
 */
export async function applyCenterSyncDelta(
  delta: CloudSyncDeltaResponse
): Promise<DeliveryCenter> {
  const db = await getDb();
  const centerId = delta.center.id;
  const now = Date.now();

  if (delta.mode === 'full') {
    const oldPdfs = await db.getAllKeysFromIndex('pdfs', 'by-center', centerId);
    const oldAddrs = await db.getAllKeysFromIndex('addresses', 'by-center', centerId);
    const tx = db.transaction(['pdfs', 'addresses'], 'readwrite');
    for (const k of oldPdfs) tx.objectStore('pdfs').delete(k);
    for (const k of oldAddrs) tx.objectStore('addresses').delete(k);
    await tx.done;
  } else {
    // Applica eliminazioni incrementali
    if (delta.deletedPdfIds.length > 0 || delta.deletedAddressIds.length > 0) {
      const tx = db.transaction(['pdfs', 'addresses'], 'readwrite');
      const pdfStore = tx.objectStore('pdfs');
      for (const pdfId of delta.deletedPdfIds) {
        pdfStore.delete(pdfId);
      }
      const addrStore = tx.objectStore('addresses');
      for (const addrId of delta.deletedAddressIds) {
        addrStore.delete(addrId);
      }
      await tx.done;
    }
  }

  // Upsert PDF metadata (senza scaricare i PDF binari sui dispositivi operatori!)
  if (delta.upsertedPdfs.length > 0) {
    const tx = db.transaction('pdfs', 'readwrite');
    const store = tx.objectStore('pdfs');
    for (const p of delta.upsertedPdfs) {
      store.put(p);
    }
    await tx.done;
  }

  // Upsert indirizzi in batch
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < delta.upsertedAddresses.length; i += CHUNK_SIZE) {
    const chunk = delta.upsertedAddresses.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction('addresses', 'readwrite');
    const store = tx.objectStore('addresses');
    for (const addr of chunk) {
      store.put(addr);
    }
    await tx.done;
  }

  const localCenter: DeliveryCenter = {
    ...delta.center,
    localVersion: delta.toVersion,
    syncedAt: now,
  };

  {
    const tx = db.transaction(['centers', 'syncMeta'], 'readwrite');
    await tx.objectStore('centers').put(localCenter);
    await tx.objectStore('syncMeta').put({ key: 'lastGlobalSyncAt', value: now });
    await tx.done;
  }

  return localCenter;
}

export async function getLastGlobalSyncAt(): Promise<number | null> {
  const db = await getDb();
  const row = await db.get('syncMeta', 'lastGlobalSyncAt');
  return typeof row?.value === 'number' ? row.value : null;
}

export async function getLocalStatsSummary(): Promise<{
  centersCount: number;
  pdfsCount: number;
  addressesCount: number;
  lastGlobalSyncAt: number | null;
}> {
  const db = await getDb();
  const [centersCount, pdfsCount, addressesCount, lastGlobalSyncAt] = await Promise.all([
    db.count('centers'),
    db.count('pdfs'),
    db.count('addresses'),
    getLastGlobalSyncAt(),
  ]);
  return { centersCount, pdfsCount, addressesCount, lastGlobalSyncAt };
}

export async function enqueueSyncAck(item: Omit<SyncQueueItem, 'id' | 'createdAt'>): Promise<void> {
  const db = await getDb();
  await db.put('syncQueue', {
    ...item,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  });
}

export async function drainSyncQueue(): Promise<SyncQueueItem[]> {
  const db = await getDb();
  const items = await db.getAll('syncQueue');
  if (items.length > 0) {
    const tx = db.transaction('syncQueue', 'readwrite');
    await tx.objectStore('syncQueue').clear();
    await tx.done;
  }
  return items;
}
