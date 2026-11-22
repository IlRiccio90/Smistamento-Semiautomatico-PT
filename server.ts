import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  adminCheckDuplicatePdf,
  adminCreateAndListBackups,
  adminCreateCenter,
  adminCreateUser,
  adminDeleteCenter,
  adminDeletePdf,
  adminExportCenterPayload,
  adminGetCloudDiagnostics,
  adminListCenterPdfs,
  adminListLogs,
  adminListUsers,
  adminRegenerateCenterDb,
  adminRestoreBackupOrImport,
  adminToggleUserActive,
  adminUpdateCenter,
  adminUploadPdfAndAddresses,
  changeAdminPassword,
  checkAdminEmailStatus,
  getCloudSyncDelta,
  isSupabaseBackendActive,
  listCloudCenters,
  loginAdmin,
  recordAdminLogout,
  recordSyncAck,
  requestPasswordRecovery,
  setupFirstAdminPassword,
  verifyAdminBearerToken,
} from './src/server/cloudStore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

interface AdminRequest extends Request {
  admin?: {
    email: string;
    mustChangePassword: boolean;
    backendMode: 'supabase' | 'local-cloud';
  };
}

async function requireAdminAuth(req: AdminRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Accesso amministratore richiesto.' });
  }
  const token = auth.slice('Bearer '.length).trim();
  const verified = await verifyAdminBearerToken(token);
  if (!verified) {
    return res.status(401).json({ error: 'Sessione amministratore scaduta o non valida.' });
  }
  req.admin = verified;
  next();
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiOcrAvailable: Boolean(process.env.GEMINI_API_KEY),
      backendMode: isSupabaseBackendActive ? 'supabase' : 'local-cloud',
    });
  });

  // ---- OCR AI (opzionale quando online) ----
  app.post('/api/ocr/extract', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: 'Servizio di estrazione AI non configurato sul server. Verrà utilizzato l’OCR locale offline.',
        });
      }

      const { imageBase64, mimeType = 'image/png', defaultZone = '' } = req.body ?? {};
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return res.status(400).json({ error: 'Immagine mancante per estrazione OCR.' });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = [
        'Analizza questa pagina di un "Libretto di Gita" postale italiano (o elenco stradario di recapito).',
        'Estrai solo le righe appartenenti alla tabella di consegna/itinerario di gita (ignora intestazioni ripetute, appoggi, vuotatura cassette, seguimi, fallimenti).',
        defaultZone ? `La zona predefinita del documento è: ${defaultZone}.` : '',
        'Per ogni riga di indirizzo estrai:',
        '- zona (es. "1", "2", "4" se visibile o quella predefinita)',
        '- subzona (es. "A", "B", "C")',
        '- prog (numero progressivo se presente)',
        '- indirizzoCompleto (es. "VIA ALCIDE DE GASPERI 10, SANT\'ANGELO LODIGIANO" oppure "VIA ROMA 2-120 solo pari, LODI")',
        '- comune (es. "SANT\'ANGELO LODIGIANO")',
        '- note (eventuale frazione, cascina o nota)',
        '- scala (se presente)',
        'Restituisci rigorosamente JSON conforme allo schema.',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            inlineData: {
              data: imageBase64.replace(/^data:[^;]+;base64,/, ''),
              mimeType,
            },
          },
          prompt,
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedZone: { type: Type.STRING },
              sectionType: { type: Type.STRING },
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    zona: { type: Type.STRING },
                    subzona: { type: Type.STRING },
                    prog: { type: Type.STRING },
                    indirizzoCompleto: { type: Type.STRING },
                    comune: { type: Type.STRING },
                    note: { type: Type.STRING },
                    scala: { type: Type.STRING },
                  },
                  required: ['indirizzoCompleto'],
                },
              },
            },
            required: ['rows'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{"rows":[]}');
      return res.json(parsed);
    } catch (error) {
      console.error('Errore estrazione OCR Gemini:', error);
      return res.status(500).json({
        error: 'Errore durante l’analisi avanzata della pagina. Usare OCR locale.',
      });
    }
  });

  // ---- PUBLIC / OPERATOR SYNC ROUTES (SOLO LETTURA + ACK) ----
  app.get('/api/cloud/centers', async (_req, res) => {
    try {
      const centers = await listCloudCenters();
      res.json({ centers });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Errore lettura centri' });
    }
  });

  app.get('/api/cloud/centers/:centerId/sync', async (req, res) => {
    try {
      const sinceVersion = Number(req.query.sinceVersion ?? 0) || 0;
      const delta = await getCloudSyncDelta(req.params.centerId, sinceVersion);
      res.json(delta);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Errore sincronizzazione' });
    }
  });

  app.post('/api/cloud/centers/:centerId/sync-ack', async (req, res) => {
    try {
      const action =
        req.body?.action === 'aggiornamento_incrementale'
          ? 'aggiornamento_incrementale'
          : 'sincronizzazione';
      const version = Number(req.body?.version ?? 1) || 1;
      await recordSyncAck(req.params.centerId, action, version);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Errore registrazione sincronizzazione.' });
    }
  });

  // ---- ADMIN AUTHENTICATION ROUTES (NESSUNA REGISTRAZIONE PUBBLICA) ----
  app.post('/api/auth/check-email', async (req, res) => {
    try {
      const email = String(req.body?.email || '');
      const status = await checkAdminEmailStatus(email);
      res.json(status);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Verifica non riuscita' });
    }
  });

  app.post('/api/auth/setup-first-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '');
      const password = String(req.body?.password || '');
      const session = await setupFirstAdminPassword(email, password);
      res.json(session);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Attivazione fallita' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '');
      const password = String(req.body?.password || '');
      const session = await loginAdmin(email, password);
      res.json(session);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Credenziali non valide' });
    }
  });

  app.post('/api/auth/change-password', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const newPassword = String(req.body?.newPassword || '');
      await changeAdminPassword(req.admin!.email, newPassword);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Cambio password fallito' });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '');
      const redirectTo = String(req.body?.redirectTo || '');
      const result = await requestPasswordRecovery(email, redirectTo);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore recupero password' });
    }
  });

  app.post('/api/auth/logout', requireAdminAuth, async (req: AdminRequest, res) => {
    await recordAdminLogout(req.admin!.email);
    res.json({ ok: true });
  });

  // ---- PROTECTED ADMIN ROUTES ----
  app.post('/api/admin/centers', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const center = await adminCreateCenter(
        req.admin!.email,
        String(req.body?.name || ''),
        String(req.body?.notes || '')
      );
      res.json({ center });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore creazione Centro' });
    }
  });

  app.patch('/api/admin/centers/:centerId', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const center = await adminUpdateCenter(
        req.admin!.email,
        req.params.centerId,
        String(req.body?.name || ''),
        String(req.body?.notes || '')
      );
      res.json({ center });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore modifica Centro' });
    }
  });

  app.delete('/api/admin/centers/:centerId', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      await adminDeleteCenter(req.admin!.email, req.params.centerId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore eliminazione Centro' });
    }
  });

  app.get('/api/admin/centers/:centerId/pdfs', requireAdminAuth, async (req, res) => {
    try {
      const pdfs = await adminListCenterPdfs(req.params.centerId);
      res.json({ pdfs });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore elenco PDF' });
    }
  });

  app.post('/api/admin/centers/:centerId/pdfs/check-duplicate', requireAdminAuth, async (req, res) => {
    try {
      const result = await adminCheckDuplicatePdf(
        req.params.centerId,
        String(req.body?.fileName || ''),
        String(req.body?.fileHash || ''),
        String(req.body?.zoneNumber || '')
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore verifica duplicati' });
    }
  });

  app.post('/api/admin/centers/:centerId/pdfs', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const result = await adminUploadPdfAndAddresses({
        actorEmail: req.admin!.email,
        centerId: req.params.centerId,
        pdfRecord: req.body?.pdfRecord,
        pdfBase64: req.body?.pdfBase64,
        addresses: Array.isArray(req.body?.addresses) ? req.body.addresses : [],
        duplicateResolution: req.body?.duplicateResolution,
        replacePdfId: req.body?.replacePdfId,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore salvataggio PDF' });
    }
  });

  app.delete('/api/admin/centers/:centerId/pdfs/:pdfId', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const center = await adminDeletePdf(
        req.admin!.email,
        req.params.centerId,
        req.params.pdfId
      );
      res.json({ center });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore eliminazione PDF' });
    }
  });

  app.post('/api/admin/centers/:centerId/regenerate', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const center = await adminRegenerateCenterDb(req.admin!.email, req.params.centerId);
      res.json({ center });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore rigenerazione DB' });
    }
  });

  app.get('/api/admin/users', requireAdminAuth, async (_req, res) => {
    try {
      const users = await adminListUsers();
      res.json({ users });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore caricamento admin' });
    }
  });

  app.post('/api/admin/users', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const user = await adminCreateUser(
        req.admin!.email,
        String(req.body?.email || ''),
        req.body?.initialPassword ? String(req.body.initialPassword) : undefined
      );
      res.json({ user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore creazione admin' });
    }
  });

  app.patch('/api/admin/users/:userId', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const user = await adminToggleUserActive(
        req.admin!.email,
        req.params.userId,
        Boolean(req.body?.active)
      );
      res.json({ user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore aggiornamento admin' });
    }
  });

  app.get('/api/admin/logs', requireAdminAuth, async (_req, res) => {
    try {
      const logs = await adminListLogs();
      res.json({ logs });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore lettura log' });
    }
  });

  app.get('/api/admin/backups', requireAdminAuth, async (_req, res) => {
    try {
      const backups = await adminCreateAndListBackups();
      res.json({ backups });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore elenco backup' });
    }
  });

  app.post('/api/admin/backups', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const backups = await adminCreateAndListBackups(
        req.admin!.email,
        String(req.body?.centerId || '')
      );
      res.json({ backups });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore creazione backup' });
    }
  });

  app.get('/api/admin/centers/:centerId/export', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const payload = await adminExportCenterPayload(req.admin!.email, req.params.centerId);
      res.json(payload);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore esportazione Centro' });
    }
  });

  app.post('/api/admin/backups/restore', requireAdminAuth, async (req: AdminRequest, res) => {
    try {
      const center = await adminRestoreBackupOrImport(req.admin!.email, {
        backupId: req.body?.backupId ? String(req.body.backupId) : undefined,
        importedPayload: req.body?.importedPayload,
      });
      res.json({ center });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore ripristino backup' });
    }
  });

  app.get('/api/admin/diagnostics', requireAdminAuth, async (_req, res) => {
    try {
      const diagnostics = await adminGetCloudDiagnostics();
      res.json(diagnostics);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Errore diagnostica' });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Smistamento Semiautomatico PT server in ascolto su http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Avvio server fallito:', err);
  process.exit(1);
});
