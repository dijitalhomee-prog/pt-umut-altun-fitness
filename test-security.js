const http = require("https");

function request(url, options = {}, bodyData = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {}
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });
    req.on("error", reject);
    if (bodyData !== null) {
      req.write(typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function runSecurityAudit() {
  const BASE = process.env.TEST_BASE_URL || "https://pt-umut-altun-fitness-production.up.railway.app";
  console.log(`🛡️ STARTING AUTOMATED SECURITY & AUTHENTICATION AUDIT AGAINST: ${BASE}`);

  const tests = [
    { name: "Tokensız GET /api/me", url: `${BASE}/api/me`, method: "GET", body: null, expected: 401 },
    { name: "Tokensız PUT /api/me/profile", url: `${BASE}/api/me/profile`, method: "PUT", body: {}, expected: 401 },
    { name: "Tokensız POST /api/me/photos (sıralı bypass testi)", url: `${BASE}/api/me/photos`, method: "POST", body: {}, expected: 401 },
    { name: "Tokensız GET /api/me (tekrar)", url: `${BASE}/api/me`, method: "GET", body: null, expected: 401 },
    { name: "Tokensız GET /api/clients", url: `${BASE}/api/clients`, method: "GET", body: null, expected: 401 },
    { name: "Tokensız PUT /api/clients/client-1787315315439/profile", url: `${BASE}/api/clients/client-1787315315439/profile`, method: "PUT", body: {}, expected: 401 },
    { name: "Tokensız DELETE /api/clients/client-1787315315439", url: `${BASE}/api/clients/client-1787315315439`, method: "DELETE", body: null, expected: 401 },
    { name: "Tokensız POST /api/admin/purge-all-clients", url: `${BASE}/api/admin/purge-all-clients`, method: "POST", body: {}, expected: 401 }
  ];

  let passedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    try {
      const res = await request(t.url, { method: t.method, headers: { "Content-Type": "application/json" } }, t.body);
      const isPassed = res.status === t.expected;
      if (isPassed) {
        passedCount++;
        console.log(`✅ [TEST ${i + 1}/${tests.length}] ${t.name}: Status ${res.status} (Beklenen: ${t.expected})`);
      } else {
        failedCount++;
        console.error(`🔴 [FAIL TEST ${i + 1}/${tests.length}] ${t.name}: Status ${res.status} (Beklenen: ${t.expected}) - Yanıt:`, res.data || res.raw);
      }
    } catch (err) {
      failedCount++;
      console.error(`🔴 [ERROR TEST ${i + 1}/${tests.length}] ${t.name}: Hata - ${err.message}`);
    }
  }

  console.log("\n==========================================");
  console.log(`GÜVENLİK AUDİT SONUCU: ${passedCount} BAŞARILI / ${failedCount} BAŞARISIZ`);
  console.log("==========================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSecurityAudit();
