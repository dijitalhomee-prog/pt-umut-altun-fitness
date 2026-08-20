/**
 * PT Umut Altun — Uzaktan Fitness Koçluğu
 * Interaktif BMR, TDEE & Makro Besin Hesaplayıcı Mantığı
 */

const FitnessCalculator = {
  // BMR (Mifflin-St Jeor)
  calculateBMR(gender, weightKg, heightCm, age) {
    let bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age);
    if (gender === 'male') {
      bmr += 5;
    } else {
      bmr -= 161;
    }
    return Math.round(bmr);
  },

  // TDEE (Activity Factor)
  calculateTDEE(bmr, activityLevel) {
    const multipliers = {
      sedentary: 1.2,      // Masa başı / Az hareketli
      light: 1.375,        // Haftada 1-3 gün spor
      moderate: 1.55,      // Haftada 3-5 gün spor
      active: 1.725        // Haftada 6-7 gün yoğun spor
    };
    const factor = multipliers[activityLevel] || 1.375;
    return Math.round(bmr * factor);
  },

  // Target Calories & Macro Split
  calculateMacros(tdee, weightKg, goal) {
    let targetCalories = tdee;
    let proteinPerKg = 2.0;
    let fatPercentage = 0.25;

    if (goal === 'fat_loss') {
      targetCalories = Math.round(tdee * 0.80); // %20 Deficit
      proteinPerKg = 2.2; // Yüksek protein (kas kaybını önlemek için)
      fatPercentage = 0.25;
    } else if (goal === 'muscle_gain') {
      targetCalories = Math.round(tdee * 1.12); // %12 Surplus
      proteinPerKg = 2.0;
      fatPercentage = 0.25;
    } else if (goal === 'recomp') {
      targetCalories = Math.round(tdee * 0.90); // %10 Deficit
      proteinPerKg = 2.1;
      fatPercentage = 0.25;
    } else {
      // maintenance
      targetCalories = tdee;
      proteinPerKg = 1.8;
      fatPercentage = 0.28;
    }

    // Gram calculations
    const proteinGrams = Math.round(weightKg * proteinPerKg);
    const proteinCalories = proteinGrams * 4;

    const fatCalories = Math.round(targetCalories * fatPercentage);
    const fatGrams = Math.round(fatCalories / 9);

    const carbCalories = Math.max(0, targetCalories - (proteinCalories + fatCalories));
    const carbGrams = Math.round(carbCalories / 4);

    return {
      targetCalories,
      proteinGrams,
      fatGrams,
      carbGrams,
      proteinPercent: Math.round((proteinCalories / targetCalories) * 100),
      fatPercent: Math.round((fatCalories / targetCalories) * 100),
      carbPercent: Math.round((carbCalories / targetCalories) * 100)
    };
  },

  // Single Entry Calculation
  fullCalculation({ gender, weight, height, age, activity, goal }) {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const a = parseInt(age, 10);

    if (isNaN(w) || isNaN(h) || isNaN(a) || w <= 0 || h <= 0 || a <= 0) {
      return null;
    }

    const bmr = this.calculateBMR(gender, w, h, a);
    const tdee = this.calculateTDEE(bmr, activity);
    const macros = this.calculateMacros(tdee, w, goal);

    return {
      bmr,
      tdee,
      ...macros
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FitnessCalculator;
}
