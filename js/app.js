/**
 * PT Umut Altun — Uzaktan Fitness Koçluğu
 * Ana Uygulama & Interaktif Etkileşim Scripti
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Render Dynamic Components
  renderPackages();
  renderTransformations();
  renderFAQs();
  initCalculator();
  initOnboardingModal();
  initNavigation();
  initScrollAnimations();
});

/* ==========================================================================
   1. Dynamic Rendering (Paketler, Dönüşümler, SSS)
   ========================================================================== */

async function renderPackages() {
  const container = document.getElementById('packages-container');
  const modalSelect = document.getElementById('form-package');

  try {
    const res = await fetch('/api/packages');
    const data = await res.json();
    if (data.success && Array.isArray(data.packages) && data.packages.length > 0) {
      data.packages.forEach(apiPkg => {
        if (APP_DATA && Array.isArray(APP_DATA.packages)) {
          const localMatch = APP_DATA.packages.find(p => p.name === apiPkg.name || p.id === apiPkg.id || (p.name && apiPkg.name && (p.name.includes(apiPkg.name) || apiPkg.name.includes(p.name))));
          if (localMatch) {
            localMatch.price = `${apiPkg.price.toLocaleString('tr-TR')} ₺`;
            if (apiPkg.compareAtPrice) {
              localMatch.originalPrice = `${apiPkg.compareAtPrice.toLocaleString('tr-TR')} ₺`;
            }
            localMatch.description = apiPkg.packageDescription || localMatch.description;
          }
        }
      });

      // Populate onboarding modal dropdown dynamically from API catalog
      if (modalSelect) {
        modalSelect.innerHTML = data.packages.map(p => {
          const priceStr = p.price ? ` (${p.price.toLocaleString('tr-TR')} ₺)` : '';
          return `<option value="${p.name}">${p.name}${priceStr}</option>`;
        }).join('');
      }
    }
  } catch (err) {
    console.warn('Dynamic packages sync error:', err);
  }

  if (!container || !APP_DATA || !APP_DATA.packages) return;

  container.innerHTML = APP_DATA.packages.map(pkg => `
    <div class="package-card ${pkg.featured ? 'featured' : ''}" data-package-id="${pkg.id}">
      ${pkg.popularTag ? `<div class="popular-badge"><i class="fas fa-fire"></i> ${pkg.badge}</div>` : `<div class="badge-subtle">${pkg.badge}</div>`}
      
      <div class="package-header">
        <h3 class="package-title">${pkg.name}</h3>
        <p class="package-description">${pkg.description}</p>
      </div>

      <div class="package-pricing">
        <div class="price-row">
          <span class="original-price">${pkg.originalPrice}</span>
          <span class="current-price">${pkg.price}</span>
          <span class="price-period">${pkg.period}</span>
        </div>
        <div class="monthly-tag">${pkg.monthlyEquivalent}</div>
      </div>

      <ul class="package-features">
        ${pkg.features.map(feat => `
          <li>
            <i class="fas fa-check-circle feature-icon"></i>
            <span>${feat}</span>
          </li>
        `).join('')}
      </ul>

      <div class="package-action">
        <button class="btn ${pkg.featured ? 'btn-primary-glow' : 'btn-outline'} btn-block select-package-btn" data-package-name="${pkg.name}">
          ${pkg.ctaText} <i class="fas fa-arrow-right"></i>
        </button>
      </div>
    </div>
  `).join('');

  // Attach event listeners to buttons
  document.querySelectorAll('.select-package-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const packageName = e.currentTarget.getAttribute('data-package-name');
      openModalWithPackage(packageName);
    });
  });
}

function renderTransformations() {
  const container = document.getElementById('transformations-container');
  if (!container || !APP_DATA || !APP_DATA.transformations) return;

  container.innerHTML = APP_DATA.transformations.map(t => `
    <div class="transformation-card">
      <div class="transformation-badge">${t.tag}</div>
      <div class="transformation-meta">
        <div>
          <h4>${t.name}, <span class="age">${t.age} Yaş</span></h4>
          <span class="job">${t.job}</span>
        </div>
        <div class="duration-pill"><i class="fas fa-stopwatch"></i> ${t.duration}</div>
      </div>

      <div class="result-box">
        <i class="fas fa-trophy trophy-icon"></i>
        <span>${t.result}</span>
      </div>

      <p class="comment">"${t.comment}"</p>

      <div class="weight-change">
        <div class="weight-item">
          <span class="label">Başlangıç</span>
          <span class="val">${t.initialWeight}</span>
        </div>
        <i class="fas fa-long-arrow-alt-right arrow"></i>
        <div class="weight-item highlight">
          <span class="label">Son Durum</span>
          <span class="val">${t.finalWeight}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderFAQs() {
  const container = document.getElementById('faq-accordion');
  if (!container || !APP_DATA || !APP_DATA.faqs) return;

  container.innerHTML = APP_DATA.faqs.map((faq, index) => `
    <div class="faq-item ${index === 0 ? 'active' : ''}">
      <button class="faq-question">
        <span>${faq.question}</span>
        <i class="fas fa-chevron-down faq-chevron"></i>
      </button>
      <div class="faq-answer">
        <p>${faq.answer}</p>
      </div>
    </div>
  `).join('');

  // Accordion Event Listeners
  document.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.parentElement;
      const isActive = item.classList.contains('active');
      
      // Close all
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
      
      // Toggle clicked
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
}

/* ==========================================================================
   2. Interaktif BMR & Makro Hesaplayıcı UI
   ========================================================================== */

function initCalculator() {
  const genderInputs = document.querySelectorAll('input[name="calc-gender"]');
  const ageInput = document.getElementById('calc-age');
  const heightInput = document.getElementById('calc-height');
  const weightInput = document.getElementById('calc-weight');
  const activitySelect = document.getElementById('calc-activity');
  const goalSelect = document.getElementById('calc-goal');
  const calcBtn = document.getElementById('calc-btn');

  if (!calcBtn) return;

  // Run calculation on button click or input change
  const updateCalc = () => {
    const gender = document.querySelector('input[name="calc-gender"]:checked')?.value || 'male';
    const age = ageInput.value;
    const height = heightInput.value;
    const weight = weightInput.value;
    const activity = activitySelect.value;
    const goal = goalSelect.value;

    const res = FitnessCalculator.fullCalculation({ gender, weight, height, age, activity, goal });

    if (!res) return;

    // Display numbers with counting animation
    document.getElementById('res-bmr').textContent = res.bmr + ' kcal';
    document.getElementById('res-tdee').textContent = res.tdee + ' kcal';
    document.getElementById('res-target').textContent = res.targetCalories + ' kcal';

    // Macros
    document.getElementById('res-protein').textContent = res.proteinGrams + 'g';
    document.getElementById('res-carb').textContent = res.carbGrams + 'g';
    document.getElementById('res-fat').textContent = res.fatGrams + 'g';

    // Progress Bars
    document.getElementById('bar-protein').style.width = res.proteinPercent + '%';
    document.getElementById('bar-carb').style.width = res.carbPercent + '%';
    document.getElementById('bar-fat').style.width = res.fatPercent + '%';

    document.getElementById('pct-protein').textContent = `%${res.proteinPercent}`;
    document.getElementById('pct-carb').textContent = `%${res.carbPercent}`;
    document.getElementById('pct-fat').textContent = `%${res.fatPercent}`;
  };

  calcBtn.addEventListener('click', updateCalc);

  // Trigger default initial calculation
  updateCalc();
}

/* ==========================================================================
   3. Onboarding & Modal Flow (WhatsApp Transfer)
   ========================================================================== */

function initOnboardingModal() {
  const modal = document.getElementById('onboarding-modal');
  const closeModalBtn = document.getElementById('close-modal');
  const openModalBtns = document.querySelectorAll('.open-modal-btn');
  const form = document.getElementById('onboarding-form');

  if (!modal) return;

  openModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      openModalWithPackage(null);
    });
  });

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  // Close modal when clicking backdrop
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Form submit -> Format message -> Open WhatsApp
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const name = document.getElementById('form-name').value.trim();
      const phone = document.getElementById('form-phone').value.trim();
      const age = document.getElementById('form-age').value.trim();
      const weight = document.getElementById('form-weight').value.trim();
      const height = document.getElementById('form-height').value.trim();
      const goal = document.getElementById('form-goal').value;
      const experience = document.getElementById('form-experience').value;
      const selectedPkg = document.getElementById('form-package').value;
      const note = document.getElementById('form-note').value.trim();

      const messageText = `Merhaba Umut Hocam, web siteniz üzerinden yeni bir koçluk başvurusu yapıyorum.

*Seçilen Paket:* ${selectedPkg || 'Paket Seçilmedi'}
*Ad Soyad:* ${name}
*Telefon:* ${phone}
*Fiziksel Bilgiler:* ${age} Yaş | ${height} cm | ${weight} kg
*Ana Hedef:* ${goal}
*Spor Geçmişi:* ${experience}
${note ? `*Ek Not:* ${note}\n` : ''}
Kayıt ve başvuru sürecini tamamlamak için detayları alabilir miyim?`;

      const encodedMsg = encodeURIComponent(messageText);
      const whatsappUrl = `https://wa.me/${APP_DATA.trainer.whatsappNumber}?text=${encodedMsg}`;

      // Open WhatsApp in new tab
      window.open(whatsappUrl, '_blank');
      
      // Close modal
      modal.classList.remove('active');
      document.body.style.overflow = '';
    });
  }
}

function openModalWithPackage(packageName) {
  const modal = document.getElementById('onboarding-modal');
  const pkgSelect = document.getElementById('form-package');

  if (!modal) return;

  if (packageName && pkgSelect) {
    // Select matching option
    for (let opt of pkgSelect.options) {
      if (opt.text.includes(packageName) || opt.value.includes(packageName)) {
        opt.selected = true;
        break;
      }
    }
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

/* ==========================================================================
   4. Navigation & Mobile Menu
   ========================================================================== */

function initNavigation() {
  const navbar = document.querySelector('.navbar');
  const menuToggle = document.getElementById('menu-toggle');
  const navLinks = document.querySelector('.nav-links');

  // Sticky header class on scroll
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  // Mobile menu toggle
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
      const icon = menuToggle.querySelector('i');
      if (navLinks.classList.contains('active')) {
        icon.className = 'fas fa-times';
      } else {
        icon.className = 'fas fa-bars';
      }
    });

    // Close menu when clicking link
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        const icon = menuToggle.querySelector('i');
        if (icon) icon.className = 'fas fa-bars';
      });
    });
  }
}

/* ==========================================================================
   5. Scroll Animations (Intersection Observer)
   ========================================================================== */

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.animate-on-scroll').forEach(el => {
    observer.observe(el);
  });
}
