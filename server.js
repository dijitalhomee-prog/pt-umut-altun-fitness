const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Persistent Database Directory & File Path
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Ensure Database File Exists
function initDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const defaultDbData = {
    clients: [],
    programs: {},
    trainerPin: "586158",
    lastUpdated: new Date().toISOString()
  };

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDbData, null, 2), 'utf8');
  }
}

// Read Database
function readDb() {
  try {
    initDatabase();
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading database:', err);
    return { clients: [], programs: {}, trainerPin: "586158" };
  }
}

// Write Database (Persistent Sync)
function writeDb(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing database:', err);
    return false;
  }
}

// Otomatik Paket Bitiş Kontrolü (Server Side)
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

// ==========================================================================
// REST API ENDPOINTS (PERSISTENT DATA ENGINE)
// ==========================================================================

// 1. Get All Clients
app.get('/api/clients', (req, res) => {
  const db = readDb();
  autoExpireClients(db);
  res.json({ success: true, clients: db.clients });
});

// 2. Add New Client (Trainer Action)
app.post('/api/clients', (req, res) => {
  const { name, package: pkg, stage, status, expiryDate } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'Danışan adı gereklidir.' });
  }

  const db = readDb();

  // Auto expiry date calculation if not passed
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

  const newClient = {
    id: 'client-' + Date.now(),
    name,
    package: pkg || 'Ücretsiz Deneme',
    stage: stage || '1. Hafta (Yeni Başladı)',
    expiryDate: finalExpiryDate,
    status: status || 'active',
    note: status === 'active' ? `Aktif (Son Tarih: ${finalExpiryDate})` : '🔴 Pasif / Süresi Doldu',
    createdAt: new Date().toISOString()
  };

  db.clients.unshift(newClient);
  writeDb(db);

  res.json({ success: true, client: newClient });
});

// 3. Toggle Client Active / Passive Status
app.put('/api/clients/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;

  const db = readDb();
  const client = db.clients.find(c => c.id === id);

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  client.status = status || (client.status === 'active' ? 'passive' : 'active');
  if (note) client.note = note;
  else client.note = client.status === 'active' ? 'Aktif Üyelik Devam Ediyor' : 'Paketi Bitti / Pasif';

  writeDb(db);
  res.json({ success: true, client });
});

// 4. Get Client Specific Program & Nutrition Data
app.get('/api/programs/:clientId', (req, res) => {
  const { clientId } = req.params;
  const db = readDb();
  const program = db.programs[clientId] || null;
  res.json({ success: true, clientId, program });
});

// 5. Save Client Specific Program & Nutrition Data
app.post('/api/programs/:clientId', (req, res) => {
  const { clientId } = req.params;
  const programData = req.body;

  const db = readDb();
  db.programs[clientId] = {
    ...programData,
    updatedAt: new Date().toISOString()
  };

  writeDb(db);
  res.json({ success: true, message: 'Program kalıcı olarak kaydedildi.' });
});

// 6. Trainer Auth Login (586158 PIN)
app.post('/api/auth/trainer', (req, res) => {
  const { pin } = req.body;
  const db = readDb();

  if (pin === db.trainerPin || pin === '586158') {
    res.json({ success: true, token: 'trainer-authenticated-token' });
  } else {
    res.status(401).json({ success: false, message: 'Hatalı Eğitmen Şifresi!' });
  }
});

// Fallback Route to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
initDatabase();
app.listen(PORT, () => {
  console.log(`🚀 PT Umut Altun Server running on port ${PORT}`);
});
