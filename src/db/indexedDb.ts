import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AddressRecord, DeliveryCenter, PdfDocumentRecord } from '../types/sorting';

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
}

const DB_NAME = 'smistamento-pt-db';
const DB_VERSION = 1;

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
      },
    });
  }
  return dbPromise;
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
    pdfCount: 0,
    addressCount: 0,
    zones: [],
    comuni: [],
  };
  await db.put('centers', center);
  return center;
}

export async function updateCenterMetadata(
  centerId: string,
  updates: Partial<Pick<DeliveryCenter, 'name' | 'notes'>>
): Promise<DeliveryCenter | null> {
  const db = await getDb();
  const existing = await db.get('centers', centerId);
  if (!existing) return null;
  const updated: DeliveryCenter = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };
  await db.put('centers', updated);
  return updated;
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

export async function deleteCenter(centerId: string): Promise<void> {
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

export async function listPdfsByCenter(centerId: string): Promise<PdfDocumentRecord[]> {
  const db = await getDb();
  const list = await db.getAllFromIndex('pdfs', 'by-center', centerId);
  return list.sort((a, b) =>
    a.zoneNumber.localeCompare(b.zoneNumber, 'it', { numeric: true }) || b.importedAt - a.importedAt
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

  // Save PDF metadata + blob first
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

  // Batch save addresses in chunks of 1000 inside transactions for maximum speed on mobile
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

export async function deletePdfAndAddresses(centerId: string, pdfId: string): Promise<DeliveryCenter | null> {
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
