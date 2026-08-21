const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const TRAINER_PIN = process.env.TRAINER_PIN || '586158';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Zero-Cache Aggressive Anti-Caching Middleware
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Persistent Database Directory & File Path (Railway Persistent Volume Support)
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const BACKUP_DIR = path.join(DB_DIR, 'backups');

// Startup Warning Log for Persistent Volume
if (!process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.warn('\x1b[31m%s\x1b[0m', '⚠️ WARNING: RAILWAY_VOLUME_MOUNT_PATH is not set. Database persistence will NOT be maintained across container restarts! Please attach a Railway Volume at /data.');
}

// --------------------------------------------------------------------------
// HELPER: Phone Normalization (Exact Last 10 Digits)
// --------------------------------------------------------------------------
function normalizePhone(phone) {
  if (!phone) return '';
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length < 10) return '';
  return clean.slice(-10);
}

// Ensure Database File Exists
function initDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const defaultDbData = {
    clients: [],
    deletedPhones: [],
    programs: {},
    sessions: [],
    trainerPin: TRAINER_PIN,
    lastUpdated: new Date().toISOString()
  };

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDbData, null, 2), 'utf8');
  }
}

// --------------------------------------------------------------------------
// HELPER: Daily Automatic Backup Engine (Keep last 7 days)
// --------------------------------------------------------------------------
function performDailyBackup(data) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const backupFile = path.join(BACKUP_DIR, `db-${todayStr}.json`);

    if (!fs.existsSync(backupFile)) {
      fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), 'utf8');
    }

    // Prune backups older than 7 days
    const files = fs.readdirSync(BACKUP_DIR);
    const backupFiles = files.filter(f => f.startsWith('db-') && f.endsWith('.json')).sort();
    if (backupFiles.length > 7) {
      const toDelete = backupFiles.slice(0, backupFiles.length - 7);
      toDelete.forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) {}
      });
    }
  } catch (err) {
    console.error('Backup error:', err);
  }
}

// --------------------------------------------------------------------------
// HELPER: Startup Deduplication & Cleanup Migration
// --------------------------------------------------------------------------
function deduplicateClients(dbData) {
  if (!Array.isArray(dbData.clients) || dbData.clients.length <= 1) return false;

  let modified = false;
  const mergedMap = new Map();

  dbData.clients.forEach(client => {
    const norm = normalizePhone(client.phone);
    const key = norm || client.id;

    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...client });
    } else {
      // Merge duplicate into existing record
      modified = true;
      const existing = mergedMap.get(key);
      mergedMap.set(key, {
        ...existing,
        ...client,
        password: (client.password && String(client.password).trim()) ? client.password : existing.password,
        formPhotos: [...(client.formPhotos || []), ...(existing.formPhotos || [])],
        photos: [...(client.photos || []), ...(existing.photos || [])],
        calendarNotes: { ...(existing.calendarNotes || {}), ...(client.calendarNotes || {}) }
      });
    }
  });

  if (modified) {
    dbData.clients = Array.from(mergedMap.values());
  }
  return modified;
}

// Read Database
function readDb() {
  try {
    initDatabase();
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const dbData = JSON.parse(raw);

    if (!Array.isArray(dbData.clients)) dbData.clients = [];
    if (!Array.isArray(dbData.deletedPhones)) dbData.deletedPhones = [];
    if (!Array.isArray(dbData.sessions)) dbData.sessions = [];
    if (!dbData.programs) dbData.programs = {};

    // Deduplicate duplicate client records if any exist
    const deduped = deduplicateClients(dbData);

    // Clean deletedPhones: Remove active client phones from blocklist
    if (dbData.deletedPhones.length > 0 && dbData.clients.length > 0) {
      const activePhones = dbData.clients.map(c => normalizePhone(c.phone)).filter(Boolean);
      const activeIds = dbData.clients.map(c => c.id).filter(Boolean);

      const initialLen = dbData.deletedPhones.length;
      dbData.deletedPhones = dbData.deletedPhones.filter(dp => {
        const normDp = normalizePhone(dp) || dp;
        return !activePhones.includes(normDp) && !activeIds.includes(dp);
      });

      if (dbData.deletedPhones.length < initialLen || deduped) {
        writeDb(dbData);
      }
    } else if (deduped) {
      writeDb(dbData);
    }

    return dbData;
  } catch (err) {
    console.error('Error reading database:', err);
    return { clients: [], deletedPhones: [], programs: {}, sessions: [], trainerPin: TRAINER_PIN };
  }
}

// Atomic Write Database (writes to db.json.tmp first then renames)
function writeDb(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);

    performDailyBackup(data);
    return true;
  } catch (err) {
    console.error('Error writing database atomically:', err);
    return false;
  }
}

// Server Side Auto Expiration
function autoExpireClients(db) {
  const todayStr = new Date().toISOString().split('T')[0];
  let updated = false;

  db.clients.forEach(client => {
    if (client.expiryDate && client.expiryDate < todayStr && client.status === 'active') {
      client.status = 'passive';
      client.note = '🔴 Otomatik Pasife Alındı (Süresi Doldu)';
      updated = true;
    }
  });

  if (updated) {
    writeDb(db);
  }
}

// Sanitize Client Object (Strips password for non-trainer responses)
function sanitizeClient(client, includePassword = false) {
  if (!client) return null;
  const copy = { ...client };
  if (!includePassword) {
    delete copy.password;
  }
  return copy;
}

// --------------------------------------------------------------------------
// AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// --------------------------------------------------------------------------
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const customHeader = req.headers['x-session-token'];
  const cookieHeader = req.headers.cookie;

  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (customHeader) {
    token = String(customHeader).trim();
  } else if (cookieHeader) {
    const match = cookieHeader.match(/session_token=([^;]+)/);
    if (match) token = match[1].trim();
  }

  if (!token) {
    req.session = null;
    req.isTrainer = false;
    req.client = null;
    return next();
  }

  const db = readDb();
  const session = db.sessions.find(s => s.token === token && new Date(s.expiresAt) > new Date());

  if (!session) {
    req.session = null;
    req.isTrainer = false;
    req.client = null;
    return next();
  }

  req.session = session;
  req.isTrainer = Boolean(session.isTrainer);

  if (session.clientId) {
    req.client = db.clients.find(c => c.id === session.clientId || normalizePhone(c.phone) === session.phone);
  } else {
    req.client = null;
  }

  next();
}

app.use(authMiddleware);

function requireTrainer(req, res, next) {
  if (!req.isTrainer) {
    return res.status(401).json({ success: false, message: '🔒 Yetkisiz Erişim: Bu işlem yalnızca eğitmen oturumu ile gerçekleştirilebilir.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ success: false, message: '🔒 Oturum Geçersiz: Lütfen sisteme tekrar giriş yapınız.' });
  }
  next();
}

// ==========================================================================
// REST API ENDPOINTS
// ==========================================================================

// Diagnostik Health Check Endpoint
app.get('/api/health', (req, res) => {
  const db = readDb();
  res.json({
    success: true,
    persistentVolume: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH),
    dbFile: DB_FILE,
    clientCount: db.clients.length,
    lastUpdated: db.lastUpdated || new Date().toISOString()
  });
});

// Trainer Authentication Login (PIN Verification on Server Side)
app.post('/api/auth/trainer', (req, res) => {
  const { pin } = req.body;
  if (!pin || String(pin).trim() !== TRAINER_PIN) {
    return res.status(401).json({ success: false, message: '⚠️ Hatalı Eğitmen Şifresi! Lütfen tekrar deneyiniz.' });
  }

  const db = readDb();
  const token = 'trainer-' + crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    isTrainer: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };

  db.sessions.unshift(session);
  writeDb(db);

  res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
  res.json({ success: true, token, isTrainer: true });
});

// Client Authentication & Verify-Auth Endpoint
app.post('/api/clients/verify-auth', (req, res) => {
  const { phone, password } = req.body;
  const clean10 = normalizePhone(phone);

  if (!clean10) {
    return res.status(404).json({
      success: false,
      notFound: true,
      deleted: false,
      message: 'Bu telefon numarasına ait üyelik bulunamadı. Lütfen eğitmeniniz ile iletişime geçiniz.'
    });
  }

  const db = readDb();

  // Check Blacklist
  const isBlacklisted = db.deletedPhones.some(dp => {
    const normDp = normalizePhone(dp) || dp;
    return normDp === clean10;
  });

  if (isBlacklisted) {
    return res.status(403).json({
      success: false,
      notFound: false,
      deleted: true,
      message: '🚫 Hesabınızın erişimi kapatılmıştır. Eğitmeniniz Umut Altun ile iletişime geçiniz.'
    });
  }

  const client = db.clients.find(c => normalizePhone(c.phone) === clean10 || c.id === phone);

  if (!client) {
    return res.status(404).json({
      success: false,
      notFound: true,
      deleted: false,
      message: 'Bu telefon numarasına ait üyelik bulunamadı. Lütfen eğitmeniniz ile iletişime geçiniz.'
    });
  }

  // Password Empty Check
  const storedPassword = String(client.password || '').trim();
  const givenPassword = String(password || '').trim();

  if (!storedPassword) {
    return res.status(400).json({
      success: false,
      notFound: false,
      deleted: false,
      message: 'Hesabınız için henüz şifre tanımlanmamıştır. Lütfen eğitmeninizden şifre talep ediniz.'
    });
  }

  if (givenPassword !== storedPassword) {
    return res.status(401).json({
      success: false,
      notFound: false,
      deleted: false,
      message: 'Şifreniz hatalıdır. Lütfen kontrol edip tekrar deneyiniz.'
    });
  }

  // Create Session Token
  const token = 'client-' + crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    clientId: client.id,
    phone: clean10,
    isTrainer: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };

  db.sessions.unshift(session);
  writeDb(db);

  res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
  res.json({
    success: true,
    token,
    client: sanitizeClient(client, false)
  });
});

// GET /api/me — Returns ONLY current logged-in client's data (Isolated)
app.get('/api/me', requireAuth, (req, res) => {
  if (req.isTrainer) {
    return res.json({ success: true, isTrainer: true, message: 'Eğitmen Oturumu Aktif' });
  }

  if (!req.client) {
    return res.status(404).json({ success: false, message: 'Danışan kaydı bulunamadı.' });
  }

  const db = readDb();
  const freshClient = db.clients.find(c => c.id === req.client.id);

  if (!freshClient) {
    return res.status(404).json({ success: false, message: 'Danışan kaydı bulunamadı.' });
  }

  res.json({
    success: true,
    client: sanitizeClient(freshClient, false)
  });
});

// PUT /api/me/profile — Update ONLY current logged-in client's body metrics & profile
app.put('/api/me/profile', requireAuth, (req, res) => {
  if (req.isTrainer || !req.client) {
    return res.status(403).json({ success: false, message: 'Bu işlem yalnızca danışan oturumu ile yapılabilir.' });
  }

  const { height, startWeight, currentWeight, targetWeight } = req.body;
  const db = readDb();
  const client = db.clients.find(c => c.id === req.client.id);

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  if (height) client.height = height;
  if (startWeight) client.startWeight = startWeight;
  if (currentWeight) client.currentWeight = currentWeight;
  if (targetWeight) client.targetWeight = targetWeight;

  writeDb(db);
  res.json({ success: true, client: sanitizeClient(client, false) });
});

// POST /api/me/photos — Upload form photo for ONLY current logged-in client
app.post('/api/me/photos', requireAuth, (req, res) => {
  if (req.isTrainer || !req.client) {
    return res.status(403).json({ success: false, message: 'Bu işlem yalnızca danışan oturumu ile yapılabilir.' });
  }

  const photoObj = req.body.photoGroup || req.body;
  const db = readDb();
  const client = db.clients.find(c => c.id === req.client.id);

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  if (!client.formPhotos) client.formPhotos = [];
  if (!client.photos) client.photos = [];

  client.formPhotos.unshift(photoObj);
  client.photos.unshift(photoObj);

  writeDb(db);
  res.json({ success: true, photos: client.formPhotos });
});

// POST /api/me/dismiss-notification — Dismiss client-bound new program notification
app.post('/api/me/dismiss-notification', requireAuth, (req, res) => {
  if (!req.client) {
    return res.status(400).json({ success: false, message: 'Geçersiz oturum.' });
  }

  const db = readDb();
  const client = db.clients.find(c => c.id === req.client.id);
  if (client) {
    client.hasNewProgramNotification = false;
    writeDb(db);
  }
  res.json({ success: true });
});

// POST /api/auth/logout — Logout and invalidate session token
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const db = readDb();
  db.sessions = db.sessions.filter(s => s.token !== req.session.token);
  writeDb(db);
  res.setHeader('Set-Cookie', 'session_token=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true, message: 'Oturum başarıyla kapatıldı.' });
});

// GET /api/clients — PROTECTED (TRAINER ONLY)
app.get('/api/clients', requireTrainer, (req, res) => {
  const db = readDb();
  autoExpireClients(db);
  res.json({ success: true, clients: db.clients });
});

// POST /api/clients — Add or Update (UPSERT) Client (TRAINER ONLY)
app.post('/api/clients', requireTrainer, (req, res) => {
  const { id, name, phone, password, package: pkg, stage, status, expiryDate } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Danışan adı zorunludur.' });
  }

  const clean10 = normalizePhone(phone);
  if (!clean10) {
    return res.status(400).json({ success: false, message: 'Geçerli bir 10 haneli telefon numarası girilmesi zorunludur.' });
  }

  const db = readDb();

  // Expiry Date Auto-Calculation
  let finalExpiryDate = expiryDate;
  if (!finalExpiryDate) {
    let daysToAdd = 90;
    if (pkg && pkg.includes('6 Aylık')) daysToAdd = 180;
    if (pkg && pkg.includes('12 Aylık')) daysToAdd = 365;
    if (pkg && (pkg.includes('Deneme') || pkg.includes('PT'))) daysToAdd = 30;

    const expObj = new Date();
    expObj.setDate(expObj.getDate() + daysToAdd);
    finalExpiryDate = expObj.toISOString().split('T')[0];
  }

  const generatedPassword = (password && String(password).trim()) ? String(password).trim() : Math.floor(100000 + Math.random() * 900000).toString();

  // Unblock phone from blocklist
  if (db.deletedPhones) {
    db.deletedPhones = db.deletedPhones.filter(dp => (normalizePhone(dp) || dp) !== clean10 && dp !== id);
  }

  // UPSERT LOGIC: Search for existing record by normalized phone or id
  const existingIdx = db.clients.findIndex(c => (id && c.id === id) || normalizePhone(c.phone) === clean10);

  if (existingIdx >= 0) {
    // Update existing client in-place
    const existing = db.clients[existingIdx];
    db.clients[existingIdx] = {
      ...existing,
      name: name.trim(),
      phone: clean10,
      password: generatedPassword,
      package: pkg || existing.package || 'Ücretsiz Deneme',
      stage: stage || existing.stage || '1. Hafta (Aktif Üye)',
      expiryDate: finalExpiryDate,
      status: status || existing.status || 'active',
      note: (status || existing.status) === 'active' ? `Aktif (Son Tarih: ${finalExpiryDate})` : '🔴 Pasif / Süresi Doldu'
    };
    writeDb(db);
    return res.json({ success: true, updated: true, client: db.clients[existingIdx] });
  }

  // Create new client record
  const newClient = {
    id: 'client-' + Date.now(),
    name: name.trim(),
    phone: clean10,
    password: generatedPassword,
    package: pkg || 'Ücretsiz Deneme',
    stage: stage || '1. Hafta (Yeni Başladı)',
    expiryDate: finalExpiryDate,
    status: status || 'active',
    note: (status || 'active') === 'active' ? `Aktif (Son Tarih: ${finalExpiryDate})` : '🔴 Pasif / Süresi Doldu',
    createdAt: new Date().toISOString()
  };

  db.clients.unshift(newClient);
  writeDb(db);

  res.json({ success: true, created: true, client: newClient });
});

// POST /api/clients/sync — Bulk Sync (UPSERT) Clients (TRAINER ONLY)
app.post('/api/clients/sync', requireTrainer, (req, res) => {
  const { clients: incoming } = req.body;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ success: false, message: 'Danışan dizisi geçersiz.' });
  }

  const db = readDb();
  if (!db.deletedPhones) db.deletedPhones = [];

  incoming.forEach(inc => {
    if (!inc || (!inc.id && !inc.phone)) return;
    const clean10 = normalizePhone(inc.phone);

    // Unblock if active
    if (clean10) {
      db.deletedPhones = db.deletedPhones.filter(dp => (normalizePhone(dp) || dp) !== clean10 && dp !== inc.id);
    }

    const idx = db.clients.findIndex(c => (inc.id && c.id === inc.id) || (clean10 && normalizePhone(c.phone) === clean10));

    if (idx >= 0) {
      db.clients[idx] = { ...db.clients[idx], ...inc, phone: clean10 || db.clients[idx].phone };
    } else if (inc.name && clean10) {
      db.clients.unshift({ ...inc, phone: clean10 });
    }
  });

  writeDb(db);
  res.json({ success: true, clients: db.clients });
});

// PUT /api/clients/:id/password — Update Client Password Across ALL Duplicate Phone Records (TRAINER ONLY)
app.put('/api/clients/:id/password', requireTrainer, (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  const db = readDb();
  const targetClient = db.clients.find(c => c.id === id || normalizePhone(c.phone) === normalizePhone(id));

  if (!targetClient) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  const newPass = (password && String(password).trim()) ? String(password).trim() : Math.floor(100000 + Math.random() * 900000).toString();
  const targetNorm = normalizePhone(targetClient.phone);

  // Update password for all matching records
  db.clients.forEach(c => {
    if (c.id === targetClient.id || (targetNorm && normalizePhone(c.phone) === targetNorm)) {
      c.password = newPass;
    }
  });

  writeDb(db);
  res.json({ success: true, password: newPass });
});

// PUT /api/clients/:id/status — Toggle Client Status (TRAINER ONLY)
app.put('/api/clients/:id/status', requireTrainer, (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;

  const db = readDb();
  const client = db.clients.find(c => c.id === id || normalizePhone(c.phone) === normalizePhone(id));

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  client.status = status || (client.status === 'active' ? 'passive' : 'active');
  if (note) client.note = note;
  else client.note = client.status === 'active' ? 'Aktif Üyelik Devam Ediyor' : 'Paketi Bitti / Pasif';

  writeDb(db);
  res.json({ success: true, client });
});

// PUT /api/clients/:id/profile — Update Client Body Metrics & Program Data (TRAINER ONLY)
app.put('/api/clients/:id/profile', requireTrainer, (req, res) => {
  const { id } = req.params;
  const { height, startWeight, currentWeight, targetWeight, coachNote, hasAssignedProgram, programMatrix, startDate, nutrition, supplements, measurements, photos, dayList, calendarNotes } = req.body;

  const db = readDb();
  const client = db.clients.find(c => c.id === id || normalizePhone(c.phone) === normalizePhone(id));

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  if (height) client.height = height;
  if (startWeight) client.startWeight = startWeight;
  if (currentWeight) client.currentWeight = currentWeight;
  if (targetWeight) client.targetWeight = targetWeight;
  if (coachNote) client.coachNote = coachNote;
  if (hasAssignedProgram !== undefined) {
    client.hasAssignedProgram = hasAssignedProgram;
    if (hasAssignedProgram) {
      client.hasNewProgramNotification = true;
    }
  }
  if (programMatrix) client.programMatrix = programMatrix;
  if (startDate) client.startDate = startDate;
  if (nutrition) client.nutrition = nutrition;
  if (supplements) client.supplements = supplements;
  if (measurements) client.measurements = measurements;
  if (photos) client.photos = photos;
  if (dayList) client.dayList = dayList;
  if (calendarNotes) client.calendarNotes = calendarNotes;

  writeDb(db);
  res.json({ success: true, client });
});

// DELETE /api/clients/:id — Delete Client & Add Exact Normalized Phone to Blocklist (TRAINER ONLY)
app.delete('/api/clients/:id', requireTrainer, (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (!db.deletedPhones) db.deletedPhones = [];

  const normTarget = normalizePhone(id);
  const targetClient = db.clients.find(c => c.id === id || (normTarget && normalizePhone(c.phone) === normTarget));

  if (targetClient) {
    const clean10 = normalizePhone(targetClient.phone);
    if (clean10 && !db.deletedPhones.includes(clean10)) {
      db.deletedPhones.push(clean10);
    }
    if (targetClient.id && !db.deletedPhones.includes(targetClient.id)) {
      db.deletedPhones.push(targetClient.id);
    }

    db.clients = db.clients.filter(c => c.id !== targetClient.id && normalizePhone(c.phone) !== clean10);
    if (db.programs && db.programs[targetClient.id]) delete db.programs[targetClient.id];
    if (db.programs && clean10 && db.programs[clean10]) delete db.programs[clean10];

    writeDb(db);
    return res.json({ success: true, message: 'Danışan hesabı kalıcı olarak silindi ve erişimi engellendi.', deletedPhone: clean10 });
  }

  res.status(404).json({ success: false, message: 'Silinecek danışan bulunamadı.' });
});

// POST /api/admin/purge-all-clients — Reset All Clients (TRAINER ONLY)
app.post('/api/admin/purge-all-clients', requireTrainer, (req, res) => {
  const db = {
    clients: [],
    deletedPhones: [],
    programs: {},
    sessions: [],
    trainerPin: TRAINER_PIN,
    lastUpdated: new Date().toISOString()
  };

  writeDb(db);
  res.json({
    success: true,
    message: '✨ TÜM ESKİ DANIŞAN KAYITLARI KALICI OLARAK SİLİNDİ: Veritabanı %100 sıfırlandı.'
  });
});

// Static Files Middleware (Served AFTER REST API endpoints)
app.use(express.static(__dirname, {
  etag: false,
  lastModified: false
}));

// Fallback Route for SPA with API Protection
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'İstenen API rotası bulunamadı.' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
initDatabase();
app.listen(PORT, () => {
  console.log(`🚀 PT Umut Altun Server running on port ${PORT}`);
});
