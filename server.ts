import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiOcrAvailable: Boolean(process.env.GEMINI_API_KEY),
    });
  });

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

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smistamento Semiautomatico PT server in ascolto su http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Avvio server fallito:', err);
  process.exit(1);
});
