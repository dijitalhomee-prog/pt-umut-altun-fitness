/**
 * PT Umut Altun — Uzaktan Fitness Koçluğu
 * Modüler Veri Dosyası (Paketler, SSS, Danışan Dönüşümleri)
 * Not: Paket içerikleri ve fiyatlar buradan kolayca değiştirilebilir.
 */

const APP_DATA = {
  trainer: {
    name: "PT Umut Altun",
    title: "Kıdemli Fitness Koçu & Beslenme Danışmanı",
    experienceYears: "10+",
    totalClients: "500+",
    satisfactionRate: "%98",
    whatsappNumber: "905386376258",
    instagramHandle: "@ptumutaltun0"
  },

  // Paketler (Kompakt & Hizalı İçerik Yapısı)
  packages: [
    {
      id: "pkg-hybrid-macfit",
      name: "Cevahir MACFit Hibrit Koçluk",
      duration: "3 Ay",
      badge: "📍 CEVAHİR AVM ÖZEL",
      featured: false,
      originalPrice: "5.500 ₺",
      price: "3.900 ₺",
      period: "/ Toplam",
      monthlyEquivalent: "~1.300 ₺ / ay",
      description: "Cevahir AVM çevresindekilere özel; uzaktan eğitim + her ay MACFit stüdyosunda birebir özel ders.",
      features: [
        "📍 Her Ay 1 Adet Cevahir MACFit Birebir Özel Ders",
        "Kişiye Özel Antrenman & Beslenme Planı",
        "Salonda Yüz Yüze Form & Postür Analizi",
        "7/24 WhatsApp Desteği & Haftalık Ölçüm Takibi",
        "Randevulu Özel Ders Tarihi Esnekliği"
      ],
      popularTag: false,
      ctaText: "Hibrit Pakete Başvur"
    },
    {
      id: "pkg-3-month",
      name: "3 Aylık Başlangıç & Disiplin",
      duration: "3 Ay",
      badge: "Temel Başlangıç",
      featured: false,
      originalPrice: "5.900 ₺",
      price: "4.500 ₺",
      period: "/ Toplam",
      monthlyEquivalent: "~1.500 ₺ / ay",
      description: "Disiplin kazanmak ve temel antrenman alışkanlığı edinmek isteyenler için ideal.",
      features: [
        "Kişiye Özel Antrenman Programı (Salon/Ev)",
        "Hedefe Uygun Esnek Beslenme & Makro Planı",
        "Egzersiz Form Video Kontrolleri",
        "WhatsApp Üzerinden Soru-Cevap Desteği",
        "2 Haftada Bir Detaylı Form Değerlendirmesi"
      ],
      popularTag: false,
      ctaText: "Başlangıç Paketini Seç"
    },
    {
      id: "pkg-6-month",
      name: "6 Aylık Vücut Yenileme & Hipertrofi",
      duration: "6 Ay",
      badge: "EN POPÜLER",
      featured: true,
      originalPrice: "11.500 ₺",
      price: "7.900 ₺",
      period: "/ Toplam",
      monthlyEquivalent: "~1.316 ₺ / ay",
      description: "Bedenini tamamen dönüştürmek ve kas hacmini artırmak isteyenlerin tercihi.",
      features: [
        "Kişiye Özel Antrenman & Hipertrofi Planı",
        "Detaylı Kalori & Esnek Beslenme Rehberi",
        "Haftalık Online Form & Ölçüm Analizi",
        "7/24 Öncelikli WhatsApp İletişim Hattı",
        "Program Revize Garantisi (Sonsuz Güncelleme)"
      ],
      popularTag: true,
      ctaText: "Popüler Paketi Seç"
    },
    {
      id: "pkg-12-month",
      name: "12 Aylık VIP Şampiyon Dönüşüm",
      duration: "12 Ay",
      badge: "FULL VIP KOÇLUK",
      featured: false,
      originalPrice: "21.000 ₺",
      price: "13.500 ₺",
      period: "/ Toplam",
      monthlyEquivalent: "~1.125 ₺ / ay",
      description: "Yıl boyu sürekli gelişim, elit düzeyde form ve yaşam tarzı değişimi arzulayanlar için.",
      features: [
        "12 Aylık Elit VIP Uzaktan Koçluk Süreci",
        "Aylık Görüntülü WhatsApp Değerlendirmesi",
        "Dönemsel Antrenman Periodizasyon Planı",
        "Haftalık Güncellenen Dinamik Beslenme",
        "7/24 Kesintisiz VIP WhatsApp Erişimi"
      ],
      popularTag: false,
      ctaText: "VIP Pakete Başvur"
    }
  ],

  // Başarı Hikayeleri & Dönüşümler
  transformations: [
    {
      name: "Ahmet Y.",
      age: 28,
      job: "Yazılım Mühendisi",
      duration: "16 Hafta",
      result: "-14 kg Yağ Kaybı, +3 kg Kas Kazanımı",
      tag: "Yağ Yakımı & Sıkılaşma",
      comment: "Umut Hoca ile çalışmaya başlamadan önce masa başı işimden dolayı bel ağrıları çekiyor ve sürekli yorgun hissediyordum. Esnek diyet ve 4 günlük antrenman programı sayesinde aç kalmadan hayatımın en fit haline ulaştım!",
      initialWeight: "94 kg",
      finalWeight: "80 kg"
    },
    {
      name: "Zeynep K.",
      age: 24,
      job: "Mimar",
      duration: "12 Hafta",
      result: "+5 kg Kas Hacmi, Şekilli Bacak & Karın",
      tag: "Kas Kazanımı & Postür",
      comment: "Kilo almakta ve sporda ilerlemekte çok zorlanıyordum. Yanlış beslendiğimi Umut Bey'in hazırladığı makro planıyla anladım. 3 ayda hem enerjim 2 katına çıktı hem de hayal ettiğim hatlara kavuştum.",
      initialWeight: "49 kg",
      finalWeight: "54 kg"
    },
    {
      name: "Caner M.",
      age: 34,
      job: "İş İnsanı",
      duration: "24 Hafta",
      result: "%26'dan %11 Yağ Oranına Düşüş",
      tag: "Vücut Yenileme (Recomp)",
      comment: "Yoğun iş temposuna rağmen haftada 3-4 gün 45 dakikalık antrenmanlarla bu noktaya geldik. Form kontrollerindeki disiplini ve motivasyonu harikaydı. Kesinlikle verdiğim en doğru karardı.",
      initialWeight: "88 kg",
      finalWeight: "75 kg"
    }
  ],

  // Sıkça Sorulan Sorular
  faqs: [
    {
      question: "Uzaktan Koçluk (Uzaktan Eğitim) tam olarak nasıl çalışır?",
      answer: "Kayıt olduktan sonra detaylı bir başvuru formu (yaşam tarzın, sakatlık durumun, beslenme alışkanlıkların, spor geçmişin ve hedeflerin) doldurursun. Bu bilgilere dayanarak antrenman ve beslenme programın 24-48 saat içinde hazırlanır. WhatsApp üzerinden iletişimde kalır, hareket form videolarını atarsın ve her hafta düzenli ölçümlerle gelişimi takip ederiz."
    },
    {
      question: "Spor salonuna gitmeden, sadece evde spor yaparak sonuç alabilir miyim?",
      answer: "Kesinlikle evet! Evinde olan ekipmanlara (dambıl, direnç bandı veya sadece kendi vücut ağırlığına) özel yüksek verimli ev antrenman programları hazırlıyoruz. Önemli olan kaslara doğru mekanik gerilimi uygulamaktır."
    },
    {
      question: "Beslenme programında sevmediğim veya yiyemediğim yiyecekler olacak mı?",
      answer: "Hayır. Diyetlerimiz tek tip Tavuk-Pilav mantığında değildir. Sevdiğin besinler, bütçen ve günlük rutinine uygun 'Esnek Beslenme' (IIFYM) ilkesini uyguluyoruz. Sevmediğin hiçbir yiyeceği yemek zorunda değilsin."
    },
    {
      question: "Hareketleri yanlış yapmaktan korkuyorum, form kontrolleri nasıl oluyor?",
      answer: "Antrenmanlarında şüphelendiğin veya daha iyi öğrenmek istediğin hareketlerin kısa videolarını WhatsApp üzerinden bana gönderirsin. Videoları inceleyip sesli veya videolu geri bildirimle formunu mükemmelleştiririz."
    },
    {
      question: "Ödemeyi nasıl yapabilirim ve süreç ne zaman başlar?",
      answer: "Başvuru formunu doldurduktan sonra sizinle WhatsApp üzerinden iletişime geçip hesap bilgileri/ödeme linkini iletiyoruz. Ödeme onaylandıktan hemen sonra analiz formunuz gönderilir ve aynı gün programlama süreciniz başlar."
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = APP_DATA;
}
