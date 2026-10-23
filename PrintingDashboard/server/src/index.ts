/* ===========================================================================
   PrintTrack local backend — runs on the shop PC.
   Bridges the browser dashboard to the HP DesignJet T210 (which the browser
   can't reach directly) and to the artwork files in Drive.
   =========================================================================== */
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { imageSize } from 'image-size';
import PDFDocument from 'pdfkit';
import { getInk, getStatus, hasPrinter, submitJob } from './printer';
import { getArtwork, getThumbnail, hasSheet, peekFile } from './sheet';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasPrinter, hasSheet });
});

app.get('/api/printer/status', async (_req, res) => {
  try {
    res.json(await getStatus());
  } catch (err) {
    res.status(502).json({ error: String((err as Error).message) });
  }
});

app.get('/api/printer/ink', async (_req, res) => {
  try {
    res.json(await getInk());
  } catch (err) {
    res.status(502).json({ error: String((err as Error).message) });
  }
});

/** Submit a job to the printer. Body: { rowId }. Pulls the artwork from
 *  Drive (via Apps Script) then sends it over IPP. */
app.post('/api/print', async (req, res) => {
  const rowId = String(req.body?.rowId ?? '');
  if (!rowId) return res.status(400).json({ error: 'rowId required' });

  try {
    const art = await getArtwork(rowId);
    if (!art) {
      // No file available (or no sheet configured) — simulate so the flow works.
      const result = await submitJob(Buffer.alloc(0), `job-${rowId}`, 'application/octet-stream');
      return res.json({ ...result, simulated: true, note: 'No artwork file found; simulated submit.' });
    }
    const result = await submitJob(art.buffer, art.filename, art.mime);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ submitted: false, error: String((err as Error).message) });
  }
});

/** Stream the raw artwork file so the dashboard can preview it inline
 *  (image in an <img>, PDF in an <iframe>). */
app.get('/api/artwork/:rowId/file', async (req, res) => {
  const rowId = String(req.params.rowId);
  try {
    const art = await getArtwork(rowId);
    if (!art) return res.status(404).json({ error: 'no artwork file' });
    res.setHeader('Content-Type', art.mime);
    res.setHeader('Content-Disposition', `inline; filename="${art.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(art.buffer);
  } catch (err) {
    return res.status(502).json({ error: String((err as Error).message) });
  }
});

/** Serve the Drive thumbnail as an image (browser loads it like a normal img src). */
app.get('/api/artwork/:rowId/thumbnail', async (req, res) => {
  const rowId = String(req.params.rowId);
  try {
    const b64 = await getThumbnail(rowId);
    if (!b64) return res.status(404).end();
    const buf = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.send(buf);
  } catch {
    return res.status(502).end();
  }
});

/** Generate a print-ready monthly PDF report from analytics data sent by the
 *  frontend (which owns the localStorage event log). */
app.post('/api/reports/monthly', (req, res) => {
  const { month, analytics: a, reorder } = req.body ?? {};
  if (!month || !a) return res.status(400).json({ error: 'month and analytics required' });

  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="printtrack-report-${month}.pdf"`);
  doc.pipe(res);

  // ---- Header ----
  doc.fontSize(22).fillColor('#c2483d').text('PrintTrack', { continued: true });
  doc.fontSize(22).fillColor('#333').text(' Monthly Report');
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor('#666').text(`BAPS Shri Swaminarayan Mandir · New Castle, DE`);
  doc.fontSize(12).fillColor('#666').text(`Report period: ${month}`);
  doc.moveDown(1);

  // ---- Summary stats ----
  doc.fontSize(14).fillColor('#333').text('Summary', { underline: true });
  doc.moveDown(0.4);
  const stats = [
    ['Paper used', `${a.totalPaperUsedFt ?? 0} ft`],
    ['Jobs printed', String(a.jobsPrinted ?? 0)],
    ['Paper wasted', `${a.wastedFt ?? 0} ft`],
    ['Reprints', String(a.reprints ?? 0)],
    ['Ink replacements', String(a.inkReplacements ?? 0)],
    ['Waste rate', a.totalPaperUsedFt > 0 ? `${Math.round((a.wastedFt / a.totalPaperUsedFt) * 100)}%` : '0%'],
  ];
  stats.forEach(([label, value]) => {
    doc.fontSize(11).fillColor('#444').text(`${label}:`, { continued: true, width: 180 });
    doc.fontSize(11).fillColor('#111').text(`  ${value}`);
  });
  doc.moveDown(1);

  // ---- Paper by material ----
  if (Array.isArray(a.paperUsedByMaterial) && a.paperUsedByMaterial.length > 0) {
    doc.fontSize(14).fillColor('#333').text('Paper used by material', { underline: true });
    doc.moveDown(0.4);
    a.paperUsedByMaterial.forEach((m: any) => {
      doc.fontSize(11).fillColor('#444').text(`${m.material}:`, { continued: true, width: 180 });
      doc.fontSize(11).fillColor('#111').text(`  ${m.ft} ft`);
    });
    doc.moveDown(1);
  }

  // ---- Reorder list ----
  if (Array.isArray(reorder) && reorder.length > 0) {
    doc.fontSize(14).fillColor('#333').text('Reorder needed', { underline: true });
    doc.moveDown(0.4);
    reorder.forEach((item: any) => {
      const left = item.sparesInStock === 0 ? 'OUT OF STOCK' : `${item.sparesInStock} left`;
      doc.fontSize(11).fillColor('#444').text(`${item.name}:`, { continued: true, width: 180 });
      doc.fontSize(11).fillColor(item.sparesInStock === 0 ? '#c2483d' : '#555').text(`  ${left}`);
    });
    doc.moveDown(1);
  }

  // ---- Footer ----
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#aaa').text(`Generated by PrintTrack · ${new Date().toLocaleString()}`);

  doc.end();
  return;
});

app.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log(`PrintTrack backend on http://localhost:${PORT}`);
  console.log(`  printer: ${hasPrinter ? process.env.PRINTER_IP : 'SIMULATED (no PRINTER_IP)'}`);
  console.log(`  sheet:   ${hasSheet ? 'configured' : 'not configured'}`);
});
