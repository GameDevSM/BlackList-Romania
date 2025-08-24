import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { customAlphabet } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
let PUBLIC_MODE = (process.env.PUBLIC_MODE || 'true').toLowerCase() === 'true';
const MIN_PUBLIC_SIGNUPS = Number(process.env.MIN_PUBLIC_SIGNUPS || 15);

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/** In-memory DB */
const db = {
  pilots: [],
  adminTokens: new Set(),
  accessCodes: new Set()
};

const requireAdmin = (req, res, next) => {
  const t = req.headers['x-admin-token'];
  if (!t || !db.adminTokens.has(String(t))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

/** Serve frontend */
app.use(express.static(path.join(__dirname, 'public')));

/** Config */
app.get('/api/config', (req, res) => {
  const total = db.pilots.length;
  const effectivePublic = total < MIN_PUBLIC_SIGNUPS ? true : PUBLIC_MODE;
  res.json({ publicMode: effectivePublic, totalPilots: total, minPublicSignups: MIN_PUBLIC_SIGNUPS });
});

/** Inscriere pilot */
app.post('/api/register', (req, res) => {
  const { nickname, car, photoUrl } = req.body || {};
  if (!nickname || !car) return res.status(400).json({ error: 'nickname și car sunt obligatorii' });
  const id = nanoid();
  db.pilots.push({ id, nickname: String(nickname).trim(), car: String(car).trim(), photoUrl: photoUrl || '', status: 'pending', rank: null, accessCodes: [] });
  res.json({ ok: true, id });
});

/** Listă */
app.get('/api/list', (req, res) => {
  const total = db.pilots.length;
  const effectivePublic = total < MIN_PUBLIC_SIGNUPS ? true : PUBLIC_MODE;
  if (!effectivePublic) {
    const code = String(req.headers['x-access-code'] || '');
    if (!code || !db.accessCodes.has(code)) return res.status(403).json({ error: 'Acces restricționat. Introdu un cod valid.' });
  }
  const approved = db.pilots.filter(p => p.status === 'approved');
  const ranked = approved
    .sort((a,b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
    .map((p, idx) => ({ id: p.id, rank: p.rank ?? (idx + 1), nickname: p.nickname, car: p.car, photoUrl: p.photoUrl }));
  res.json({ pilots: ranked });
});

/** Cod acces */
app.post('/api/access/request', (req, res) => {
  const { nickname } = req.body || {};
  if (!nickname) return res.status(400).json({ error: 'nickname necesar' });
  const pilot = db.pilots.find(p => p.nickname.toLowerCase() === String(nickname).toLowerCase() && p.status === 'approved');
  if (!pilot) return res.status(404).json({ error: 'Pilotul nu este aprobat sau nu există' });
  const code = nanoid();
  pilot.accessCodes.push(code);
  db.accessCodes.add(code);
  res.json({ ok: true, accessCode: code });
});

/** Admin login */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Parolă greșită' });
  const token = nanoid();
  db.adminTokens.add(token);
  res.json({ ok: true, token });
});

/** Admin routes */
app.get('/api/admin/applicants', requireAdmin, (req, res) => {
  const pending = db.pilots.filter(p => p.status === 'pending');
  res.json({ applicants: pending });
});

app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { id, approve } = req.body || {};
  const p = db.pilots.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Pilot inexistent' });
  if (approve) {
    p.status = 'approved';
    const currentApproved = db.pilots.filter(x => x.status === 'approved' && x.rank !== null);
    const maxRank = currentApproved.length ? Math.max(...currentApproved.map(x => x.rank)) : 0;
    p.rank = maxRank + 1;
  } else {
    db.pilots = db.pilots.filter(x => x.id !== id);
  }
  res.json({ ok: true });
});

app.post('/api/admin/reorder', requireAdmin, (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || !orderedIds.length) return res.status(400).json({ error: 'orderedIds invalid' });
  let rank = 1;
  for (const id of orderedIds) {
    const p = db.pilots.find(x => x.id === id && x.status === 'approved');
    if (p) p.rank = rank++;
  }
  res.json({ ok: true });
});

app.post('/api/admin/toggle-privacy', requireAdmin, (req, res) => {
  const total = db.pilots.length;
  if (total < MIN_PUBLIC_SIGNUPS) {
    PUBLIC_MODE = true;
    return res.json({ ok: true, publicMode: true, note: 'Sub prag – modul public forțat' });
  }
  PUBLIC_MODE = !PUBLIC_MODE;
  res.json({ ok: true, publicMode: PUBLIC_MODE });
});

/** Serve frontend for any route */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`BlackList RO server online pe port :${PORT}`));
