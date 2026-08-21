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
const UPLOADS_DIR = path.join(DB_DIR, 'uploads');
const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');

// Static Serving for Uploaded Photos (Served directly from Persistent Volume)
app.use('/uploads', express.static(UPLOADS_DIR));

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

// HELPER: Turkey Timezone Date String (Europe/Istanbul YYYY-MM-DD)
function getTurkeyDateStr(dateObj = new Date()) {
  return new Date(dateObj).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
}

// HELPER: Package Duration Days Mapping (Fixes 30-day PT package bug)
function getPackageDurationDays(pkgName) {
  if (!pkgName) return 90;
  if (pkgName.includes('12 Aylık')) return 365;
  if (pkgName.includes('6 Aylık')) return 180;
  if (pkgName.includes('3 Aylık')) return 90;
  if (pkgName.includes('Birebir PT')) return 365; // 20 derslik PT paketi 365 gün geçerli!
  if (pkgName.includes('Hibrit Koçluk')) return 90;
  return 90;
}

// Ensure Database File & Directories Exist
function initDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  }

  const defaultDbData = {
    clients: [],
    deletedPhones: [],
    programs: {},
    sessions: [],
    exercises: SEED_EXERCISES,
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

const SEED_EXERCISES = [
  // Göğüs
  { id: "ex-bench-press", name: "Bench Press", nameTr: "Bench Press", muscleGroup: "gogus", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "10-12 Tekrar", rest: "90 sn" } },
  { id: "ex-incline-bench-press", name: "Incline Bench Press", nameTr: "Eğik Bench Press", muscleGroup: "gogus", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "10-12 Tekrar", rest: "90 sn" } },
  { id: "ex-decline-bench-press", name: "Decline Bench Press", nameTr: "Alçalan Bench Press", muscleGroup: "gogus", equipment: "barbell", type: "compound", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-dumbbell-press", name: "Dumbbell Press", nameTr: "Dambıl Press", muscleGroup: "gogus", equipment: "dumbbell", type: "compound", defaults: { sets: "4 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-incline-dumbbell-press", name: "Incline Dumbbell Press", nameTr: "Eğik Dambıl Press", muscleGroup: "gogus", equipment: "dumbbell", type: "compound", defaults: { sets: "4 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-dumbbell-fly", name: "Dumbbell Fly", nameTr: "Dambıl Fly", muscleGroup: "gogus", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-cable-crossover", name: "Cable Crossover", nameTr: "Kablo Crossover", muscleGroup: "gogus", equipment: "kablo", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "60 sn" } },
  { id: "ex-pec-deck", name: "Pec Deck Fly", nameTr: "Peck Deck", muscleGroup: "gogus", equipment: "makine", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-push-up", name: "Push Up", nameTr: "Şınav", muscleGroup: "gogus", equipment: "vucut-agirligi", type: "compound", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-dips", name: "Chest Dips", nameTr: "Paralel Bar Dips", muscleGroup: "gogus", equipment: "vucut-agirligi", type: "compound", defaults: { sets: "3 Set", reps: "10 Tekrar", rest: "60 sn" } },

  // Sırt
  { id: "ex-deadlift", name: "Deadlift", nameTr: "Ölü Kaldırış", muscleGroup: "sirt", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "8 Tekrar", rest: "120 sn" } },
  { id: "ex-pull-up", name: "Pull Up", nameTr: "Barfiks", muscleGroup: "sirt", equipment: "vucut-agirligi", type: "compound", defaults: { sets: "4 Set", reps: "8-10 Tekrar", rest: "90 sn" } },
  { id: "ex-chin-up", name: "Chin Up", nameTr: "Ters Tutuş Barfiks", muscleGroup: "sirt", equipment: "vucut-agirligi", type: "compound", defaults: { sets: "3 Set", reps: "10 Tekrar", rest: "60 sn" } },
  { id: "ex-lat-pulldown", name: "Lat Pulldown", nameTr: "Lat Çekiş", muscleGroup: "sirt", equipment: "kablo", type: "compound", defaults: { sets: "4 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-seated-cable-row", name: "Seated Cable Row", nameTr: "Oturarak Kablo Çekiş", muscleGroup: "sirt", equipment: "kablo", type: "compound", defaults: { sets: "4 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-barbell-row", name: "Barbell Row", nameTr: "Barbell Kürek", muscleGroup: "sirt", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "10 Tekrar", rest: "90 sn" } },
  { id: "ex-dumbbell-row", name: "Single Arm Dumbbell Row", nameTr: "Tek Kol Dambıl Kürek", muscleGroup: "sirt", equipment: "dumbbell", type: "compound", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-tbar-row", name: "T-Bar Row", nameTr: "T-Bar Kürek", muscleGroup: "sirt", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "10 Tekrar", rest: "90 sn" } },
  { id: "ex-face-pull", name: "Face Pull", nameTr: "Face Pull", muscleGroup: "sirt", equipment: "kablo", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-hyperextension", name: "Hyperextension", nameTr: "Bel Ekstansiyonu", muscleGroup: "sirt", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "45 sn" } },

  // Bacak
  { id: "ex-squat", name: "Barbell Squat", nameTr: "Squat Çömelme", muscleGroup: "bacak", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "10 Tekrar", rest: "90 sn" } },
  { id: "ex-front-squat", name: "Front Squat", nameTr: "Ön Squat", muscleGroup: "bacak", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "8 Tekrar", rest: "90 sn" } },
  { id: "ex-leg-press", name: "Leg Press", nameTr: "Bacak Presi", muscleGroup: "bacak", equipment: "makine", type: "compound", defaults: { sets: "4 Set", reps: "12 Tekrar", rest: "90 sn" } },
  { id: "ex-hack-squat", name: "Hack Squat", nameTr: "Hack Squat", muscleGroup: "bacak", equipment: "makine", type: "compound", defaults: { sets: "4 Set", reps: "10 Tekrar", rest: "90 sn" } },
  { id: "ex-lunge", name: "Dumbbell Lunge", nameTr: "Lunge Hamle", muscleGroup: "bacak", equipment: "dumbbell", type: "compound", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-bulgarian-split-squat", name: "Bulgarian Split Squat", nameTr: "Bulgar Squat", muscleGroup: "bacak", equipment: "dumbbell", type: "compound", defaults: { sets: "3 Set", reps: "10 Tekrar", rest: "60 sn" } },
  { id: "ex-leg-extension", name: "Leg Extension", nameTr: "Bacak Ekstansiyonu", muscleGroup: "bacak", equipment: "makine", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "60 sn" } },
  { id: "ex-leg-curl", name: "Leg Curl", nameTr: "Bacak Curl", muscleGroup: "bacak", equipment: "makine", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-romanian-deadlift", name: "Romanian Deadlift", nameTr: "Romen Ölü Kaldırış", muscleGroup: "bacak", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "10 Tekrar", rest: "90 sn" } },
  { id: "ex-hip-thrust", name: "Barbell Hip Thrust", nameTr: "Kalça İtiş", muscleGroup: "bacak", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "12 Tekrar", rest: "90 sn" } },
  { id: "ex-glute-bridge", name: "Glute Bridge", nameTr: "Köprü", muscleGroup: "bacak", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-calf-raise", name: "Standing Calf Raise", nameTr: "Baldır Kaldırma", muscleGroup: "bacak", equipment: "makine", type: "isolation", defaults: { sets: "4 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-sumo-deadlift", name: "Sumo Deadlift", nameTr: "Sumo Ölü Kaldırış", muscleGroup: "bacak", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "8 Tekrar", rest: "120 sn" } },

  // Omuz
  { id: "ex-overhead-press", name: "Barbell Shoulder Press", nameTr: "Omuz Press", muscleGroup: "omuz", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "10 Tekrar", rest: "90 sn" } },
  { id: "ex-db-shoulder-press", name: "Dumbbell Shoulder Press", nameTr: "Dambıl Omuz Press", muscleGroup: "omuz", equipment: "dumbbell", type: "compound", defaults: { sets: "4 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-arnold-press", name: "Arnold Press", nameTr: "Arnold Press", muscleGroup: "omuz", equipment: "dumbbell", type: "compound", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-lateral-raise", name: "Dumbbell Lateral Raise", nameTr: "Yan Kaldırış", muscleGroup: "omuz", equipment: "dumbbell", type: "isolation", defaults: { sets: "4 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-front-raise", name: "Dumbbell Front Raise", nameTr: "Ön Kaldırış", muscleGroup: "omuz", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "45 sn" } },
  { id: "ex-rear-delt-fly", name: "Rear Delt Fly", nameTr: "Arka Omuz Fly", muscleGroup: "omuz", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-upright-row", name: "Upright Row", nameTr: "Dik Kürek", muscleGroup: "omuz", equipment: "barbell", type: "compound", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-shrug", name: "Barbell Shrug", nameTr: "Trapez Silkme", muscleGroup: "omuz", equipment: "barbell", type: "isolation", defaults: { sets: "4 Set", reps: "15 Tekrar", rest: "45 sn" } },

  // Kol
  { id: "ex-barbell-curl", name: "Barbell Curl", nameTr: "Barbell Curl", muscleGroup: "kol", equipment: "barbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-dumbbell-curl", name: "Dumbbell Curl", nameTr: "Dambıl Curl", muscleGroup: "kol", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-hammer-curl", name: "Hammer Curl", nameTr: "Çekiç Curl", muscleGroup: "kol", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-preacher-curl", name: "Preacher Curl", nameTr: "Preacher Curl", muscleGroup: "kol", equipment: "barbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-concentration-curl", name: "Concentration Curl", nameTr: "Konsantrasyon Curl", muscleGroup: "kol", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "45 sn" } },
  { id: "ex-triceps-pushdown", name: "Triceps Pushdown", nameTr: "Triceps İtiş", muscleGroup: "kol", equipment: "kablo", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-overhead-triceps-ext", name: "Overhead Triceps Extension", nameTr: "Baş Üstü Triceps", muscleGroup: "kol", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-skull-crusher", name: "Skull Crusher", nameTr: "Skull Crusher", muscleGroup: "kol", equipment: "barbell", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-close-grip-bench-press", name: "Close Grip Bench Press", nameTr: "Dar Tutuş Bench Press", muscleGroup: "kol", equipment: "barbell", type: "compound", defaults: { sets: "3 Set", reps: "10 Tekrar", rest: "60 sn" } },
  { id: "ex-wrist-curl", name: "Wrist Curl", nameTr: "Bilek Curl", muscleGroup: "kol", equipment: "barbell", type: "isolation", defaults: { sets: "3 Set", reps: "20 Tekrar", rest: "45 sn" } },

  // Karın / Core
  { id: "ex-plank", name: "Plank Hold", nameTr: "Plank Duruşu", muscleGroup: "karin", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "45 sn", rest: "45 sn" } },
  { id: "ex-side-plank", name: "Side Plank", nameTr: "Yan Plank", muscleGroup: "karin", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "30 sn", rest: "45 sn" } },
  { id: "ex-crunch", name: "Abdominal Crunch", nameTr: "Mekik", muscleGroup: "karin", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "20 Tekrar", rest: "45 sn" } },
  { id: "ex-bicycle-crunch", name: "Bicycle Crunch", nameTr: "Bisiklet Mekik", muscleGroup: "karin", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "20 Tekrar", rest: "45 sn" } },
  { id: "ex-leg-raise", name: "Lying Leg Raise", nameTr: "Bacak Kaldırma", muscleGroup: "karin", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "45 sn" } },
  { id: "ex-hanging-leg-raise", name: "Hanging Leg Raise", nameTr: "Asılı Bacak Kaldırma", muscleGroup: "karin", equipment: "vucut-agirligi", type: "isolation", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "45 sn" } },
  { id: "ex-russian-twist", name: "Russian Twist", nameTr: "Rus Twist", muscleGroup: "karin", equipment: "dumbbell", type: "isolation", defaults: { sets: "3 Set", reps: "20 Tekrar", rest: "45 sn" } },
  { id: "ex-mountain-climber", name: "Mountain Climber", nameTr: "Dağcı", muscleGroup: "karin", equipment: "vucut-agirligi", type: "cardio", defaults: { sets: "3 Set", reps: "30 sn", rest: "45 sn" } },
  { id: "ex-ab-wheel", name: "Ab Wheel Rollout", nameTr: "Karın Tekerleği", muscleGroup: "karin", equipment: "vucut-agirligi", type: "compound", defaults: { sets: "3 Set", reps: "10 Tekrar", rest: "60 sn" } },

  // Kardiyo
  { id: "ex-treadmill", name: "Treadmill Running", nameTr: "Koşu Bandı", muscleGroup: "kardiyo", equipment: "makine", type: "cardio", defaults: { sets: "1 Set", reps: "20 dk", rest: "—" } },
  { id: "ex-incline-walk", name: "Incline Treadmill Walk", nameTr: "Eğimli Yürüyüş", muscleGroup: "kardiyo", equipment: "makine", type: "cardio", defaults: { sets: "1 Set", reps: "30 dk", rest: "—" } },
  { id: "ex-bike", name: "Stationary Bike", nameTr: "Kondisyon Bisikleti", muscleGroup: "kardiyo", equipment: "makine", type: "cardio", defaults: { sets: "1 Set", reps: "25 dk", rest: "—" } },
  { id: "ex-rowing-machine", name: "Rowing Machine", nameTr: "Kürek Makinesi", muscleGroup: "kardiyo", equipment: "makine", type: "cardio", defaults: { sets: "1 Set", reps: "15 dk", rest: "—" } },
  { id: "ex-elliptical", name: "Elliptical Trainer", nameTr: "Eliptik", muscleGroup: "kardiyo", equipment: "makine", type: "cardio", defaults: { sets: "1 Set", reps: "20 dk", rest: "—" } },
  { id: "ex-stair-master", name: "Stair Master", nameTr: "Merdiven", muscleGroup: "kardiyo", equipment: "makine", type: "cardio", defaults: { sets: "1 Set", reps: "15 dk", rest: "—" } },
  { id: "ex-jump-rope", name: "Jump Rope", nameTr: "İp Atlama", muscleGroup: "kardiyo", equipment: "vucut-agirligi", type: "cardio", defaults: { sets: "3 Set", reps: "2 dk", rest: "60 sn" } },
  { id: "ex-hiit", name: "HIIT Intervals", nameTr: "HIIT İnterval", muscleGroup: "kardiyo", equipment: "vucut-agirligi", type: "cardio", defaults: { sets: "1 Set", reps: "20 dk", rest: "—" } },

  // Tam Vücut / Fonksiyonel
  { id: "ex-burpee", name: "Burpee", nameTr: "Burpee", muscleGroup: "tam-vucut", equipment: "vucut-agirligi", type: "compound", defaults: { sets: "3 Set", reps: "12 Tekrar", rest: "60 sn" } },
  { id: "ex-kettlebell-swing", name: "Kettlebell Swing", nameTr: "Kettlebell Swing", muscleGroup: "tam-vucut", equipment: "kettlebell", type: "compound", defaults: { sets: "3 Set", reps: "15 Tekrar", rest: "60 sn" } },
  { id: "ex-clean-and-press", name: "Clean and Press", nameTr: "Clean & Press", muscleGroup: "tam-vucut", equipment: "barbell", type: "compound", defaults: { sets: "4 Set", reps: "8 Tekrar", rest: "90 sn" } },
  { id: "ex-thruster", name: "Barbell Thruster", nameTr: "Thruster", muscleGroup: "tam-vucut", equipment: "barbell", type: "compound", defaults: { sets: "3 Set", reps: "10 Tekrar", rest: "90 sn" } },
  { id: "ex-farmers-walk", name: "Farmer's Walk", nameTr: "Çiftçi Yürüyüşü", muscleGroup: "tam-vucut", equipment: "dumbbell", type: "compound", defaults: { sets: "3 Set", reps: "40 metre", rest: "60 sn" } },
  { id: "ex-battle-rope", name: "Battle Rope Waves", nameTr: "Halat", muscleGroup: "tam-vucut", equipment: "vucut-agirligi", type: "cardio", defaults: { sets: "3 Set", reps: "30 sn", rest: "45 sn" } },
  { id: "ex-box-jump", name: "Plyometric Box Jump", nameTr: "Kutu Sıçrama", muscleGroup: "tam-vucut", equipment: "vucut-agirligi", type: "compound", defaults: { sets: "3 Set", reps: "10 Tekrar", rest: "60 sn" } },
  { id: "ex-sled-push", name: "Sled Push", nameTr: "Kızak İtme", muscleGroup: "tam-vucut", equipment: "makine", type: "compound", defaults: { sets: "3 Set", reps: "20 metre", rest: "60 sn" } }
];

// In-Memory Database Cache & Timestamp Tracking
let cachedDbData = null;
let lastDbMtime = 0;

// Read Database (with In-Memory Caching, Session Pruning & Base64 Photo Migration)
function readDb(forceDiskRead = false) {
  try {
    initDatabase();
    const stat = fs.statSync(DB_FILE);

    if (!forceDiskRead && cachedDbData && stat.mtimeMs === lastDbMtime) {
      return cachedDbData;
    }

    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const dbData = JSON.parse(raw);

    if (!Array.isArray(dbData.clients)) dbData.clients = [];
    if (!Array.isArray(dbData.deletedPhones)) dbData.deletedPhones = [];
    if (!Array.isArray(dbData.sessions)) dbData.sessions = [];
    if (!Array.isArray(dbData.exercises) || dbData.exercises.length === 0) {
      dbData.exercises = SEED_EXERCISES;
    }
    if (!dbData.programs) dbData.programs = {};

    let needDiskSave = false;

    // 1. Auto-prune expired sessions (MADDE 3)
    const nowIso = new Date().toISOString();
    const prevSessionCount = dbData.sessions.length;
    dbData.sessions = dbData.sessions.filter(s => s.expiresAt && s.expiresAt > nowIso);
    if (dbData.sessions.length < prevSessionCount) {
      needDiskSave = true;
    }

    // 2. Base64 Photo Migration to Filesystem (MADDE 2 - Photo File System Storage)
    dbData.clients.forEach(c => {
      ['photos', 'formPhotos'].forEach(key => {
        if (Array.isArray(c[key])) {
          c[key].forEach(p => {
            if (p && typeof p === 'object') {
              const photoData = p.url || p.data || '';
              if (photoData && photoData.startsWith('data:image/')) {
                try {
                  const matches = photoData.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
                  if (matches) {
                    const ext = matches[1] === 'png' ? 'png' : 'jpg';
                    const base64Str = matches[2];
                    const fileName = `photo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
                    const filePath = path.join(PHOTOS_DIR, fileName);
                    fs.writeFileSync(filePath, Buffer.from(base64Str, 'base64'));
                    p.url = `/uploads/photos/${fileName}`;
                    delete p.data;
                    needDiskSave = true;
                  }
                } catch (e) {
                  console.warn('Photo base64 migration error:', e);
                }
              }
            }
          });
        }
      });
    });

    // 3. Deduplicate client records
    const deduped = deduplicateClients(dbData);
    if (deduped) needDiskSave = true;

    // 4. Clean deletedPhones
    if (dbData.deletedPhones.length > 0 && dbData.clients.length > 0) {
      const activePhones = dbData.clients.map(c => normalizePhone(c.phone)).filter(Boolean);
      const activeIds = dbData.clients.map(c => c.id).filter(Boolean);
      const initialLen = dbData.deletedPhones.length;

      dbData.deletedPhones = dbData.deletedPhones.filter(dp => {
        const normDp = normalizePhone(dp) || dp;
        return !activePhones.includes(normDp) && !activeIds.includes(dp);
      });

      if (dbData.deletedPhones.length < initialLen) needDiskSave = true;
    }

    if (needDiskSave) {
      fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf8');
      lastDbMtime = fs.statSync(DB_FILE).mtimeMs;
    } else {
      lastDbMtime = stat.mtimeMs;
    }

    cachedDbData = dbData;
    return dbData;
  } catch (err) {
    console.error('Error reading database:', err);
    return cachedDbData || { clients: [], deletedPhones: [], programs: {}, sessions: [], trainerPin: TRAINER_PIN };
  }
}

// Atomic Write Database (writes to db.json.tmp first then renames, updates cache)
function writeDb(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);

    lastDbMtime = fs.statSync(DB_FILE).mtimeMs;
    cachedDbData = data;

    performDailyBackup(data);
    return true;
  } catch (err) {
    console.error('Error writing database atomically:', err);
    return false;
  }
}

function autoExpireClients(db) {
  const todayStr = getTurkeyDateStr();
  let updated = false;

  db.clients.forEach(client => {
    if (client.expiryDate && client.expiryDate < todayStr && client.status === 'active') {
      // Check if client has a PT package with remaining PT sessions
      const entitlements = client.entitlements || getPackageEntitlements(client.package);
      const ptTotal = entitlements ? (entitlements.ptSessionsTotal || 0) : 0;
      const ptUsed = entitlements ? (entitlements.ptSessionsUsed || 0) : 0;

      if (ptTotal > 0 && ptUsed < ptTotal) {
        // Client still has remaining PT lessons! Do NOT auto-expire!
        return;
      }

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
    if (match) token = match[1];
  }

  if (!token) {
    req.session = null;
    req.isTrainer = false;
    req.client = null;
    return next();
  }

  const db = readDb();
  const session = db.sessions.find(s => s.token === token);
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

app.use('/api', authMiddleware);

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

  // PASSIVE or ARCHIVED ACCOUNT CHECK FOR CLIENTS (MADDE 6)
  if (!req.isTrainer && req.client) {
    if (req.client.status === 'passive' || req.client.status === 'archived') {
      return res.status(403).json({
        success: false,
        passive: req.client.status === 'passive',
        archived: req.client.status === 'archived',
        message: '🔒 Üyeliğiniz aktif değildir. Lütfen eğitmeniniz Umut Altun ile iletişime geçiniz.'
      });
    }
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

  // Passivated Account Check
  if (client.status === 'passive') {
    return res.status(403).json({
      success: false,
      notFound: false,
      deleted: false,
      passive: true,
      message: 'Üyeliğiniz sona ermiştir. Lütfen eğitmeniniz Umut Altun ile iletişime geçiniz.'
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

// POST /api/auth/logout — Log Out Session (requireAuth)
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const db = readDb();
  const token = req.token || (req.session && req.session.token);
  if (token) {
    db.sessions = db.sessions.filter(s => s.token !== token);
    writeDb(db);
  }
  res.setHeader('Set-Cookie', 'session_token=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true, message: 'Oturum başarıyla kapatıldı.' });
});

// POST /api/me/dismiss-notification — Dismiss New Program Assigned Notification (requireAuth)
app.post('/api/me/dismiss-notification', requireAuth, (req, res) => {
  if (req.isTrainer || !req.client) {
    return res.json({ success: true });
  }

  const db = readDb();
  const freshClient = db.clients.find(c => c.id === req.client.id);
  if (freshClient) {
    freshClient.hasNewProgramNotification = false;
    writeDb(db);
  }
  res.json({ success: true, message: 'Bildirim okundu işaretlendi.' });
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

  if (height !== undefined) client.height = height;
  if (startWeight !== undefined) client.startWeight = startWeight;
  if (targetWeight !== undefined) client.targetWeight = targetWeight;
  if (currentWeight !== undefined) {
    client.currentWeight = currentWeight;
    if (!Array.isArray(client.weightHistory)) client.weightHistory = [];
    const todayStr = getTurkeyDateStr();
    const existingToday = client.weightHistory.find(w => w.date === todayStr);
    if (existingToday) {
      existingToday.weight = parseFloat(currentWeight);
    } else if (currentWeight) {
      client.weightHistory.push({ date: todayStr, weight: parseFloat(currentWeight) });
    }
  }

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

  // Auto Mark Form Check as Done! (MADDE 2 - Closes earliest pending check)
  const todayStr = getTurkeyDateStr();
  if (!client.formChecks) client.formChecks = [];
  let matchingCheck = client.formChecks.find(f => f.status === 'pending' || f.dueDate === todayStr);
  if (!matchingCheck) {
    matchingCheck = { dueDate: todayStr, status: 'done', completedAt: new Date().toISOString() };
    client.formChecks.push(matchingCheck);
  } else {
    matchingCheck.status = 'done';
    matchingCheck.completedAt = new Date().toISOString();
  }

  writeDb(db);
  res.json({ success: true, photos: client.formPhotos });
});

// Helper for Package Entitlements
function getPackageEntitlements(pkgName) {
  const p = (pkgName || '').toLowerCase();
  if (p.includes('birebir pt') || p.includes('20 ders')) {
    return { ptSessionsTotal: 20, ptSessionsUsed: 0, monthlyStudioSessions: 0 };
  }
  if (p.includes('vip') || p.includes('şampiyon')) {
    return { ptSessionsTotal: 0, ptSessionsUsed: 0, monthlyStudioSessions: 1, monthlyVideoReview: 1 };
  }
  if (p.includes('hibrit') || p.includes('macfit')) {
    return { ptSessionsTotal: 0, ptSessionsUsed: 0, monthlyStudioSessions: 1 };
  }
  return { ptSessionsTotal: 0, ptSessionsUsed: 0, monthlyStudioSessions: 0 };
}

// --------------------------------------------------------------------------
// EĞİTMEN AJANDA & TAKVİM REST API ENDPOINTS
// --------------------------------------------------------------------------

// GET /api/agenda — Eğitmen Günlük / Haftalık Yapılacaklar Listesi (TRAINER ONLY)
app.get('/api/agenda', requireTrainer, (req, res) => {
  const db = readDb();
  autoExpireClients(db);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayDate = new Date(todayStr);

  const overdue = [];
  const today = [];
  const week = [];

  db.clients.forEach(c => {
    if (!c.status) c.status = 'active';
    const clientPhone10 = normalizePhone(c.phone) || '';

    // 1. Üyelik Bitiş Tarihi Kontrolü
    if (c.expiryDate) {
      const expDate = new Date(c.expiryDate);
      const diffDays = Math.ceil((expDate - todayDate) / (1000 * 60 * 60 * 24));

      if (diffDays < 0 && c.status !== 'passive') {
        overdue.push({
          id: `exp-${c.id}`,
          clientId: c.id,
          clientName: c.name,
          clientPhone: clientPhone10,
          type: 'membership_expired',
          title: 'Üyelik Süresi Doldu',
          subtitle: `${Math.abs(diffDays)} gün gecikti (Bitiş: ${c.expiryDate})`,
          dueDate: c.expiryDate,
          urgency: 'overdue',
          actions: ['extend', 'passivate', 'whatsapp']
        });
      } else if (diffDays === 0 && c.status === 'active') {
        today.push({
          id: `exp-${c.id}`,
          clientId: c.id,
          clientName: c.name,
          clientPhone: clientPhone10,
          type: 'membership_expiring',
          title: 'Üyelik Bugüne Bitiyor',
          subtitle: `Bugün son gün! (${c.expiryDate})`,
          dueDate: c.expiryDate,
          urgency: 'today',
          actions: ['extend', 'passivate', 'whatsapp']
        });
      } else if (diffDays > 0 && diffDays <= 7 && c.status === 'active') {
        week.push({
          id: `exp-${c.id}`,
          clientId: c.id,
          clientName: c.name,
          clientPhone: clientPhone10,
          type: 'membership_expiring',
          title: 'Üyelik Bitiyor',
          subtitle: `${diffDays} gün kaldı (Bitiş: ${c.expiryDate})`,
          dueDate: c.expiryDate,
          urgency: 'week',
          actions: ['extend', 'passivate', 'whatsapp']
        });
      }
    }

    // 2. 4 Haftalık Antrenman Programı Bitiş Tarihi (startDate + 28 gün)
    const startDateStr = c.startDate || (c.createdAt ? c.createdAt.split('T')[0] : null);
    if (startDateStr && c.hasAssignedProgram && c.status === 'active') {
      const startD = new Date(startDateStr);
      const progExpD = new Date(startD);
      progExpD.setDate(progExpD.getDate() + 28);
      const progExpStr = progExpD.toISOString().split('T')[0];
      const progDiff = Math.ceil((progExpD - todayDate) / (1000 * 60 * 60 * 24));

      if (progDiff < 0) {
        overdue.push({
          id: `prog-${c.id}`,
          clientId: c.id,
          clientName: c.name,
          clientPhone: clientPhone10,
          type: 'program_expired',
          title: '4 Haftalık Program Bitti',
          subtitle: `${Math.abs(progDiff)} gün gecikti (Yenilenmeli)`,
          dueDate: progExpStr,
          urgency: 'overdue',
          actions: ['open_wizard', 'whatsapp']
        });
      } else if (progDiff === 0) {
        today.push({
          id: `prog-${c.id}`,
          clientId: c.id,
          clientName: c.name,
          clientPhone: clientPhone10,
          type: 'program_expired',
          title: 'Program Bugün Bitiyor',
          subtitle: `Bugün 4. hafta son günü!`,
          dueDate: progExpStr,
          urgency: 'today',
          actions: ['open_wizard', 'whatsapp']
        });
      } else if (progDiff > 0 && progDiff <= 7) {
        week.push({
          id: `prog-${c.id}`,
          clientId: c.id,
          clientName: c.name,
          clientPhone: clientPhone10,
          type: 'program_expired',
          title: 'Program Bitiyor',
          subtitle: `${progDiff} gün kaldı (4. Hafta Sonu)`,
          dueDate: progExpStr,
          urgency: 'week',
          actions: ['open_wizard', 'whatsapp']
        });
      }
    }

    // 3. Form Görseli Kontrol Günleri (7, 14, 21, 28. Günler)
    if (startDateStr && c.status === 'active') {
      const startD = new Date(startDateStr);
      const checkDays = [7, 14, 21, 28];
      if (!c.formChecks) c.formChecks = [];

      checkDays.forEach(dayOffset => {
        const fcD = new Date(startD);
        fcD.setDate(fcD.getDate() + dayOffset);
        const fcStr = fcD.toISOString().split('T')[0];
        const fcDiff = Math.ceil((fcD - todayDate) / (1000 * 60 * 60 * 24));

        const existingFC = c.formChecks.find(f => f.dueDate === fcStr);
        const isDone = existingFC && existingFC.status === 'done';

        if (!isDone) {
          if (fcDiff < 0) {
            overdue.push({
              id: `fc-${c.id}-${fcStr}`,
              clientId: c.id,
              clientName: c.name,
              clientPhone: clientPhone10,
              type: 'form_check_due',
              title: 'Form Fotoğrafı Gecikti',
              subtitle: `${Math.abs(fcDiff)} gün gecikti (${dayOffset}. gün kontrolü)`,
              dueDate: fcStr,
              urgency: 'overdue',
              actions: ['whatsapp_form', 'mark_fc_done']
            });
          } else if (fcDiff === 0) {
            today.push({
              id: `fc-${c.id}-${fcStr}`,
              clientId: c.id,
              clientName: c.name,
              clientPhone: clientPhone10,
              type: 'form_check_due',
              title: 'Form Fotoğrafı Günü',
              subtitle: `Bugün ${dayOffset}. gün kontrol tarihi!`,
              dueDate: fcStr,
              urgency: 'today',
              actions: ['whatsapp_form', 'mark_fc_done']
            });
          } else if (fcDiff > 0 && fcDiff <= 7) {
            week.push({
              id: `fc-${c.id}-${fcStr}`,
              clientId: c.id,
              clientName: c.name,
              clientPhone: clientPhone10,
              type: 'form_check_due',
              title: 'Form Fotoğrafı Yaklaşıyor',
              subtitle: `${fcDiff} gün kaldı (${dayOffset}. gün kontrolü)`,
              dueDate: fcStr,
              urgency: 'week',
              actions: ['whatsapp_form', 'mark_fc_done']
            });
          }
        }
      });
    }

    // 4. Birebir PT & Stüdyo Seansları (c.sessions[])
    if (Array.isArray(c.sessions)) {
      c.sessions.forEach(sess => {
        if (!sess.date || sess.status === 'done' || sess.status === 'missed') return;
        const sessD = new Date(sess.date);
        const sessDiff = Math.ceil((sessD - todayDate) / (1000 * 60 * 60 * 24));

        const sessTypeTitle = sess.type === 'pt' ? 'Birebir PT Dersi' : 'Hibrit Stüdyo Seansı';

        if (sessDiff < 0 && sess.status === 'planned') {
          overdue.push({
            id: `sess-${sess.id}`,
            clientId: c.id,
            clientName: c.name,
            clientPhone: clientPhone10,
            sessionId: sess.id,
            type: 'pt_session',
            title: `${sessTypeTitle} (Gecikmiş)`,
            subtitle: `${Math.abs(sessDiff)} gün gecikti (${sess.time} @ ${sess.location || 'MACFit'})`,
            dueDate: sess.date,
            urgency: 'overdue',
            actions: ['session_done', 'session_postpone']
          });
        } else if (sessDiff === 0 && sess.status === 'planned') {
          today.push({
            id: `sess-${sess.id}`,
            clientId: c.id,
            clientName: c.name,
            clientPhone: clientPhone10,
            sessionId: sess.id,
            type: 'pt_session',
            title: `${sessTypeTitle} (Bugün)`,
            subtitle: `Saat ${sess.time} @ ${sess.location || 'MACFit'}`,
            dueDate: sess.date,
            urgency: 'today',
            actions: ['session_done', 'session_postpone']
          });
        } else if (sessDiff > 0 && sessDiff <= 7 && sess.status === 'planned') {
          week.push({
            id: `sess-${sess.id}`,
            clientId: c.id,
            clientName: c.name,
            clientPhone: clientPhone10,
            sessionId: sess.id,
            type: 'pt_session',
            title: `${sessTypeTitle}`,
            subtitle: `${sess.date} Saat ${sess.time} @ ${sess.location || 'MACFit'}`,
            dueDate: sess.date,
            urgency: 'week',
            actions: ['session_done', 'session_postpone']
          });
        }
      });
    }
  });

  const totalCount = overdue.length + today.length + week.length;
  res.json({ success: true, agenda: { overdue, today, week }, totalCount });
});

// GET /api/calendar — Aylık Olay Takvimi (TRAINER ONLY)
app.get('/api/calendar', requireTrainer, (req, res) => {
  const { month, clientId } = req.query; // YYYY-MM
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  const db = readDb();
  autoExpireClients(db);

  const events = [];

  db.clients.forEach(c => {
    if (clientId && c.id !== clientId && normalizePhone(c.phone) !== normalizePhone(clientId)) return;

    // 1. Üyelik Bitiş Olayı (Kırmızı)
    if (c.expiryDate && c.expiryDate.startsWith(targetMonth)) {
      events.push({
        id: `cal-exp-${c.id}`,
        clientId: c.id,
        clientName: c.name,
        date: c.expiryDate,
        type: 'expiry',
        color: '#EF4444',
        title: `🔴 ${c.name} — Üyelik Bitiş`,
        subtitle: `Paket: ${c.package}`
      });
    }

    // 2. Program Bitiş Olayı (Turuncu)
    const startDateStr = c.startDate || (c.createdAt ? c.createdAt.split('T')[0] : null);
    if (startDateStr && c.hasAssignedProgram) {
      const startD = new Date(startDateStr);
      const progExpD = new Date(startD);
      progExpD.setDate(progExpD.getDate() + 28);
      const progExpStr = progExpD.toISOString().split('T')[0];

      if (progExpStr.startsWith(targetMonth)) {
        events.push({
          id: `cal-prog-${c.id}`,
          clientId: c.id,
          clientName: c.name,
          date: progExpStr,
          type: 'program',
          color: '#F59E0B',
          title: `🟠 ${c.name} — Program Bitiş (4. Hafta)`,
          subtitle: `Yeniden program yazılmalı`
        });
      }

      // 3. Form Görseli Günleri (Mavi)
      [7, 14, 21, 28].forEach(dayOffset => {
        const fcD = new Date(startD);
        fcD.setDate(fcD.getDate() + dayOffset);
        const fcStr = fcD.toISOString().split('T')[0];

        if (fcStr.startsWith(targetMonth)) {
          const isDone = Array.isArray(c.formChecks) && c.formChecks.some(f => f.dueDate === fcStr && f.status === 'done');
          events.push({
            id: `cal-fc-${c.id}-${fcStr}`,
            clientId: c.id,
            clientName: c.name,
            date: fcStr,
            type: 'form',
            color: '#3B82F6',
            title: `${isDone ? '✅' : '🔵'} ${c.name} — Form Kontrol (${dayOffset}. Gün)`,
            subtitle: isDone ? 'Form yüklemesi yapıldı' : 'Görsel yüklemesi bekleniyor'
          });
        }
      });
    }

    // 4. Birebir Seanslar (Yeşil)
    if (Array.isArray(c.sessions)) {
      c.sessions.forEach(sess => {
        if (sess.date && sess.date.startsWith(targetMonth)) {
          events.push({
            id: `cal-sess-${sess.id}`,
            clientId: c.id,
            clientName: c.name,
            date: sess.date,
            time: sess.time,
            type: 'pt',
            color: '#10B981',
            title: `🟢 ${c.name} — ${sess.type === 'pt' ? 'PT Dersi' : 'Stüdyo Seansı'} (${sess.time})`,
            subtitle: `@ ${sess.location || 'MACFit'} [${sess.status}]`
          });
        }
      });
    }
  });

  res.json({ success: true, month: targetMonth, events });
});

// POST /api/clients/:id/sessions — Yeni Birebir Ders / Seans Planla (TRAINER ONLY)
app.post('/api/clients/:id/sessions', requireTrainer, (req, res) => {
  const { id } = req.params;
  const { date, time, type, location, note } = req.body;
  const db = readDb();
  const client = db.clients.find(c => c.id === id || normalizePhone(c.phone) === normalizePhone(id));
  if (!client) return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });

  if (!client.sessions) client.sessions = [];
  const newSession = {
    id: 'sess-' + Date.now(),
    date: date || new Date().toISOString().split('T')[0],
    time: time || '14:00',
    type: type || 'pt',
    location: location || 'Cevahir AVM MACFit',
    note: note || '',
    status: 'planned',
    createdAt: new Date().toISOString()
  };
  client.sessions.push(newSession);

  if (!client.entitlements) {
    client.entitlements = getPackageEntitlements(client.package);
  }

  writeDb(db);
  res.json({ success: true, session: newSession, client });
});

// PUT /api/clients/:id/sessions/:sessionId — Seans Durumu Güncelle (TRAINER ONLY)
app.put('/api/clients/:id/sessions/:sessionId', requireTrainer, (req, res) => {
  const { id, sessionId } = req.params;
  const { status, date, time, note } = req.body;
  const db = readDb();
  const client = db.clients.find(c => c.id === id || normalizePhone(c.phone) === normalizePhone(id));
  if (!client) return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });

  if (!client.sessions) client.sessions = [];
  const sess = client.sessions.find(s => s.id === sessionId);
  if (!sess) return res.status(404).json({ success: false, message: 'Seans bulunamadı.' });

  const prevStatus = sess.status;
  if (status) sess.status = status;
  if (date) sess.date = date;
  if (time) sess.time = time;
  if (note) sess.note = note;

  if (!client.entitlements) {
    client.entitlements = getPackageEntitlements(client.package);
  }

  if (sess.type === 'pt' && prevStatus !== 'done' && status === 'done') {
    client.entitlements.ptSessionsUsed = (client.entitlements.ptSessionsUsed || 0) + 1;
  }

  writeDb(db);
  res.json({ success: true, session: sess, entitlements: client.entitlements });
});

// PUT /api/clients/:id/form-checks/:dueDate — Form Kontrolü Durumu Güncelle (TRAINER ONLY)
app.put('/api/clients/:id/form-checks/:dueDate', requireTrainer, (req, res) => {
  const { id, dueDate } = req.params;
  const { status } = req.body;
  const db = readDb();
  const client = db.clients.find(c => c.id === id || normalizePhone(c.phone) === normalizePhone(id));
  if (!client) return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });

  if (!client.formChecks) client.formChecks = [];
  let check = client.formChecks.find(f => f.dueDate === dueDate);
  if (!check) {
    check = { dueDate, status: status || 'done' };
    client.formChecks.push(check);
  } else {
    check.status = status;
  }
  if (status === 'done') {
    check.completedAt = new Date().toISOString();
  }

  writeDb(db);
  res.json({ success: true, formChecks: client.formChecks });
});

// PUT /api/clients/:id/extend — Üyelik Süresi Uzat / Durum Güncelle (TRAINER ONLY)
app.put('/api/clients/:id/extend', requireTrainer, (req, res) => {
  const { id } = req.params;
  const { months, newExpiryDate, status } = req.body;
  const db = readDb();
  const client = db.clients.find(c => c.id === id || normalizePhone(c.phone) === normalizePhone(id));
  if (!client) return res.status(404).json({ success: false, message: 'Danışan bulunamadı.' });

  if (newExpiryDate) {
    client.expiryDate = newExpiryDate;
  } else if (months) {
    const curExp = client.expiryDate ? new Date(client.expiryDate) : new Date();
    curExp.setMonth(curExp.getMonth() + parseInt(months));
    client.expiryDate = curExp.toISOString().split('T')[0];
  }

  if (status) {
    client.status = status;
  } else {
    client.status = 'active';
  }

  client.note = `Aktif Üyelik (Son Tarih: ${client.expiryDate})`;
  writeDb(db);
  res.json({ success: true, client });
});

// --------------------------------------------------------------------------
// EGZERSİZ KÜTÜPHANESİ REST API ENDPOINTS
// --------------------------------------------------------------------------

// GET /api/exercises — Egzersiz Kütüphanesi (TRAINER ONLY)
app.get('/api/exercises', requireTrainer, (req, res) => {
  const db = readDb();
  res.json({ success: true, exercises: db.exercises || SEED_EXERCISES });
});

// POST /api/exercises — Yeni Egzersiz Ekle (TRAINER ONLY)
app.post('/api/exercises', requireTrainer, (req, res) => {
  const { name, nameTr, muscleGroup, equipment, type, defaults } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Egzersiz adı zorunludur.' });
  }

  const db = readDb();
  if (!Array.isArray(db.exercises)) db.exercises = SEED_EXERCISES;

  const existing = db.exercises.find(e => e.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) {
    return res.json({ success: true, exercise: existing, isExisting: true });
  }

  const newEx = {
    id: `ex-custom-${Date.now()}`,
    name: name.trim(),
    nameTr: nameTr || name.trim(),
    muscleGroup: muscleGroup || 'gogus',
    equipment: equipment || 'makine',
    type: type || 'compound',
    defaults: defaults || { sets: '3 Set', reps: '12 Tekrar', rest: '60 sn' },
    custom: true,
    createdAt: new Date().toISOString()
  };

  db.exercises.push(newEx);
  writeDb(db);
  res.json({ success: true, exercise: newEx });
});

// PUT /api/exercises/:id — Egzersiz Düzenle (TRAINER ONLY)
app.put('/api/exercises/:id', requireTrainer, (req, res) => {
  const { id } = req.params;
  const { name, nameTr, muscleGroup, equipment, type, defaults } = req.body;
  const db = readDb();
  if (!Array.isArray(db.exercises)) db.exercises = SEED_EXERCISES;

  const ex = db.exercises.find(e => e.id === id);
  if (!ex) return res.status(404).json({ success: false, message: 'Egzersiz bulunamadı.' });

  if (name) ex.name = name;
  if (nameTr) ex.nameTr = nameTr;
  if (muscleGroup) ex.muscleGroup = muscleGroup;
  if (equipment) ex.equipment = equipment;
  if (type) ex.type = type;
  if (defaults) ex.defaults = defaults;

  writeDb(db);
  res.json({ success: true, exercise: ex });
});

// DELETE /api/exercises/:id — Egzersiz Sil (Yalnızca custom olanlar)
app.delete('/api/exercises/:id', requireTrainer, (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (!Array.isArray(db.exercises)) db.exercises = SEED_EXERCISES;

  const exIndex = db.exercises.findIndex(e => e.id === id);
  if (exIndex === -1) return res.status(404).json({ success: false, message: 'Egzersiz bulunamadı.' });

  if (!db.exercises[exIndex].custom) {
    return res.status(400).json({ success: false, message: 'Varsayılan kütüphane egzersizleri silinemez.' });
  }

  db.exercises.splice(exIndex, 1);
  writeDb(db);
  res.json({ success: true, message: 'Egzersiz başarıyla silindi.' });
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

  // Expiry Date Auto-Calculation (Fixes 30-day PT package bug)
  let finalExpiryDate = expiryDate;
  if (!finalExpiryDate) {
    const daysToAdd = getPackageDurationDays(pkg);
    const expObj = new Date();
    expObj.setDate(expObj.getDate() + daysToAdd);
    finalExpiryDate = getTurkeyDateStr(expObj);
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

  // Revoke active sessions for this client so old tokens are immediately invalidated (MADDE 10)
  if (db.sessions) {
    db.sessions = db.sessions.filter(s => s.clientId !== targetClient.id && s.phone !== targetNorm);
  }

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

  // Revoke active sessions when passivated or archived (MADDE 6)
  if (client.status === 'passive' || client.status === 'archived') {
    const targetNorm = normalizePhone(client.phone);
    if (db.sessions) {
      db.sessions = db.sessions.filter(s => s.clientId !== client.id && s.phone !== targetNorm);
    }
  }

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

  if (height !== undefined) client.height = height;
  if (startWeight !== undefined) client.startWeight = startWeight;
  if (currentWeight !== undefined) client.currentWeight = currentWeight;
  if (targetWeight !== undefined) client.targetWeight = targetWeight;
  if (coachNote !== undefined) client.coachNote = coachNote;
  if (hasAssignedProgram !== undefined) {
    client.hasAssignedProgram = hasAssignedProgram;
    if (hasAssignedProgram) {
      client.hasNewProgramNotification = true;
      client.programUpdatedAt = new Date().toISOString();
    }
  }
  if (programMatrix !== undefined) client.programMatrix = programMatrix;
  if (startDate !== undefined) client.startDate = startDate;
  if (nutrition !== undefined) client.nutrition = nutrition;
  if (supplements !== undefined) client.supplements = supplements;
  if (measurements !== undefined) client.measurements = measurements;
  if (photos !== undefined) client.photos = photos;
  if (dayList !== undefined) client.dayList = dayList;
  if (calendarNotes !== undefined) client.calendarNotes = calendarNotes;
  if (req.body.package !== undefined) client.package = req.body.package;
  if (req.body.stage !== undefined) client.stage = req.body.stage;

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

// POST /api/admin/passivate-all-clients — Passivate All Active Memberships (TRAINER ONLY)
app.post('/api/admin/passivate-all-clients', requireTrainer, (req, res) => {
  const db = readDb();
  let count = 0;
  db.clients.forEach(c => {
    c.status = 'passive';
    c.note = '🔴 Eğitmen Tarafından Toplu Pasife Alındı';
    count++;
  });

  // Revoke all client active session tokens
  db.sessions = db.sessions.filter(s => s.isTrainer);
  writeDb(db);

  res.json({
    success: true,
    count,
    message: `✨ Toplam ${count} danışan üyelik durumu pasife alındı ve oturumları kapatıldı.`
  });
});

// POST /api/admin/revoke-all-sessions — Revoke All Client Sessions (TRAINER ONLY)
app.post('/api/admin/revoke-all-sessions', requireTrainer, (req, res) => {
  const db = readDb();
  const initialSessions = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.isTrainer);
  writeDb(db);

  res.json({
    success: true,
    revokedCount: initialSessions - db.sessions.length,
    message: '✨ Tüm aktif danışan oturumları başarıyla sonlandırıldı.'
  });
});

// POST /api/admin/import-clients — One-time Bulk Import Clients (TRAINER ONLY)
app.post('/api/admin/import-clients', requireTrainer, (req, res) => {
  const { clients: incoming } = req.body;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ success: false, message: 'İçe aktarılacak danışan dizisi boş veya geçersiz.' });
  }

  const db = readDb();
  let addedCount = 0;
  let updatedCount = 0;

  incoming.forEach(inc => {
    if (!inc || (!inc.name && !inc.phone)) return;
    const clean10 = normalizePhone(inc.phone);
    if (!clean10) return;

    if (db.deletedPhones) {
      db.deletedPhones = db.deletedPhones.filter(dp => (normalizePhone(dp) || dp) !== clean10 && dp !== inc.id);
    }

    const idx = db.clients.findIndex(c => (inc.id && c.id === inc.id) || normalizePhone(c.phone) === clean10);

    if (idx >= 0) {
      db.clients[idx] = {
        ...db.clients[idx],
        ...inc,
        phone: clean10,
        password: (inc.password && String(inc.password).trim()) ? String(inc.password).trim() : db.clients[idx].password
      };
      updatedCount++;
    } else {
      const newClient = {
        id: inc.id || ('client-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
        name: String(inc.name).trim(),
        phone: clean10,
        password: (inc.password && String(inc.password).trim()) ? String(inc.password).trim() : Math.floor(100000 + Math.random() * 900000).toString(),
        package: inc.package || 'Özel Koçluk Paketi',
        stage: inc.stage || '1. Hafta (Yeni Başladı)',
        expiryDate: inc.expiryDate || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: inc.status || 'active',
        note: inc.note || 'Aktif Üyelik',
        createdAt: inc.createdAt || new Date().toISOString()
      };
      db.clients.unshift(newClient);
      addedCount++;
    }
  });

  writeDb(db);
  res.json({
    success: true,
    addedCount,
    updatedCount,
    totalCount: db.clients.length,
    message: `✨ Danışanlar başarıyla içe aktarıldı: ${addedCount} yeni eklendi, ${updatedCount} güncellendi.`
  });
});

// POST /api/admin/purge-all-clients — Reset All Clients with Timestamped Backup (TRAINER ONLY)
app.post('/api/admin/purge-all-clients', requireTrainer, (req, res) => {
  const db = readDb();

  // Create timestamped backup snapshot BEFORE purge
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `db-backup-BEFORE-PURGE-${timestampStr}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(db, null, 2), 'utf8');
  } catch (backupErr) {
    console.error('Purge backup error:', backupErr);
  }

  const cleanDb = {
    clients: [],
    deletedPhones: [],
    programs: {},
    sessions: db.sessions.filter(s => s.isTrainer),
    trainerPin: TRAINER_PIN,
    lastUpdated: new Date().toISOString()
  };

  writeDb(cleanDb);
  res.json({
    success: true,
    message: '✨ TÜM DANIŞAN KAYITLARI KALICI OLARAK SİLİNDİ: Otomatik yedek alındı ve tüm oturumlar kapatıldı.'
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
