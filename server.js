const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Zero-Cache Aggressive Anti-Caching Middleware (Her İstekte %100 Canlı Dosya Garantisi)
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.use(express.static(__dirname, {
  etag: false,
  lastModified: false
}));

// Persistent Database Directory & File Path (Railway Persistent Volume Support)
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Ensure Database File Exists
function initDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const defaultDbData = {
    clients: [
      {
        id: "client-egemen",
        name: "Furkan Egemen Güneş",
        phone: "05386376258",
        password: "123456",
        package: "👑 12 Aylık VIP Şampiyon Dönüşüm",
        stage: "1. Hafta (Aktif Üye)",
        expiryDate: "2027-12-31",
        status: "active",
        note: "Aktif VIP Üyelik Devam Ediyor",
        createdAt: "2026-08-20T12:00:00.000Z"
      }
    ],
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
    const dbData = JSON.parse(raw);

    // Ensure default master client exists if clients array is empty
    if (!Array.isArray(dbData.clients) || dbData.clients.length === 0) {
      dbData.clients = [
        {
          id: "client-egemen",
          name: "Furkan Egemen Güneş",
          phone: "05386376258",
          password: "123456",
          package: "👑 12 Aylık VIP Şampiyon Dönüşüm",
          stage: "1. Hafta (Aktif Üye)",
          expiryDate: "2027-12-31",
          status: "active",
          note: "Aktif VIP Üyelik Devam Ediyor",
          createdAt: "2026-08-20T12:00:00.000Z"
        }
      ];
      writeDb(dbData);
    }

    return dbData;
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
  const { name, phone, password, package: pkg, stage, status, expiryDate } = req.body;
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

  // Auto-generate 6-digit password if not provided
  const generatedPassword = password || Math.floor(100000 + Math.random() * 900000).toString();
  const clientPhone = phone ? phone.replace(/\D/g, '') : '';

  const newClient = {
    id: 'client-' + Date.now(),
    name,
    phone: clientPhone,
    password: generatedPassword,
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

// Bulk Sync Clients Endpoint (Ensures Clients Are Never Lost)
app.post('/api/clients/sync', (req, res) => {
  const { clients: incoming } = req.body;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ success: false, message: 'Danışan dizisi geçersiz.' });
  }

  const db = readDb();
  incoming.forEach(inc => {
    if (!inc || (!inc.id && !inc.phone)) return;
    const cleanPhone = (inc.phone || '').replace(/\D/g, '');
    const idx = db.clients.findIndex(c => c.id === inc.id || (cleanPhone && c.phone && c.phone.replace(/\D/g, '') === cleanPhone));

    if (idx >= 0) {
      db.clients[idx] = { ...db.clients[idx], ...inc };
    } else {
      db.clients.unshift(inc);
    }
  });

  writeDb(db);
  res.json({ success: true, clients: db.clients });
});

// Delete Client Endpoint (Trainer Action Only)
app.delete('/api/clients/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const cleanId = id.replace(/\D/g, '');

  const initialCount = db.clients.length;
  db.clients = db.clients.filter(c => c.id !== id && (cleanId ? c.phone.replace(/\D/g, '') !== cleanId : true));

  if (db.clients.length < initialCount) {
    writeDb(db);
    res.json({ success: true, message: 'Danışan başarıyla silindi.' });
  } else {
    res.status(404).json({ success: false, message: 'Silinecek danışan bulunamadı.' });
  }
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

// Update Client Password (Trainer Action)
app.put('/api/clients/:id/password', (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  const db = readDb();
  const client = db.clients.find(c => c.id === id);

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  client.password = password || Math.floor(100000 + Math.random() * 900000).toString();
  writeDb(db);
  res.json({ success: true, password: client.password, client });
});

// Update Client Body Metrics Profile & Assigned Program Data Endpoint
app.put('/api/clients/:id/profile', (req, res) => {
  const { id } = req.params;
  const { height, startWeight, currentWeight, targetWeight, coachNote, hasAssignedProgram, programMatrix, startDate, nutrition, supplements, measurements, photos, dayList } = req.body;

  const db = readDb();
  const client = db.clients.find(c => c.id === id || (c.phone && c.phone.replace(/\D/g, '') === id.replace(/\D/g, '')));

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  if (height) client.height = height;
  if (startWeight) client.startWeight = startWeight;
  if (currentWeight) client.currentWeight = currentWeight;
  if (targetWeight) client.targetWeight = targetWeight;
  if (coachNote) client.coachNote = coachNote;
  if (hasAssignedProgram !== undefined) client.hasAssignedProgram = hasAssignedProgram;
  if (programMatrix) client.programMatrix = programMatrix;
  if (startDate) client.startDate = startDate;
  if (nutrition) client.nutrition = nutrition;
  if (supplements) client.supplements = supplements;
  if (measurements) client.measurements = measurements;
  if (photos) client.photos = photos;
  if (dayList) client.dayList = dayList;
  if (req.body.calendarNotes) client.calendarNotes = req.body.calendarNotes;

  writeDb(db);
  res.json({ success: true, client });
});

// Upload Client Form Photo Endpoint
app.post('/api/clients/:id/photos', (req, res) => {
  const { id } = req.params;
  const photoObj = req.body.photoGroup || req.body;

  const cleanId = id.replace(/\D/g, '');
  const client = db.clients.find(c => 
    c.id === id || 
    (c.phone && c.phone.replace(/\D/g, '') === cleanId) ||
    (cleanId && cleanId.length >= 10 && c.phone && c.phone.replace(/\D/g, '').endsWith(cleanId.slice(-10)))
  );

  if (!client) {
    return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }

  if (!client.formPhotos) {
    client.formPhotos = [];
  }
  if (!client.photos) {
    client.photos = [];
  }
  client.formPhotos.unshift(photoObj);
  client.photos.unshift(photoObj);

  writeDb(db);
  res.json({ success: true, photos: client.formPhotos });
});

// Delete Client Endpoint (Trainer Action)
app.delete('/api/clients/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();

  const initialLength = db.clients.length;
  db.clients = db.clients.filter(c => c.id !== id);

  if (db.programs && db.programs[id]) {
    delete db.programs[id];
  }

  if (db.clients.length < initialLength) {
    writeDb(db);
    res.json({ success: true, message: 'Danışan kalıcı olarak silindi.' });
  } else {
    res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });
  }
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
