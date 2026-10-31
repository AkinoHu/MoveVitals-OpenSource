// Body Lab copy: domain names and, per item, what it is, how to get it and
// what knowing it tells you. Item codes match src/lib/lab/markers.ts.

const lab = {
  domains: {
    fitness: { name: "Cardio fitness", desc: "How much work your heart, lungs and muscles can do — the strongest single predictor of long-term health." },
    heart: { name: "Heart and blood pressure", desc: "Autonomic balance and the pressure your arteries live under every day." },
    lipids: { name: "Blood lipids", desc: "The particles that build plaque in arteries, and the ones that clear it." },
    metabolic: { name: "Blood sugar and metabolism", desc: "How well you handle glucose, years before anything shows up as disease." },
    sleep: { name: "Sleep and breathing", desc: "Quantity, quality and how well you breathe and oxygenate at night." },
    body: { name: "Body composition", desc: "Weight is one number; fat, muscle and where they sit tell the real story." },
    inflammation: { name: "Inflammation and blood", desc: "Background inflammation and your blood's capacity to carry oxygen." },
    hormones: { name: "Hormones", desc: "Thyroid and sex hormones set your energy, recovery and metabolism." },
    nutrients: { name: "Micronutrients", desc: "Common deficiencies that quietly limit energy, immunity and recovery." },
    organs: { name: "Liver and kidneys", desc: "The organs that filter and process everything else on this page." },
  },
  items: {
    // Lab markers
    total_cholesterol: { name: "Total cholesterol", what: "All cholesterol carried in your blood, good and bad together.", how: "Standard lipid panel (blood draw), ideally fasting. Part of most check-ups.", learn: "On its own it says little — read it with LDL, HDL and ApoB." },
    ldl_c: { name: "LDL cholesterol", what: "Cholesterol carried by low-density lipoproteins, the main driver of arterial plaque.", how: "Standard lipid panel (blood draw).", learn: "Lower is better for arteries over decades; it is the main target of diet and medication." },
    hdl_c: { name: "HDL cholesterol", what: "Cholesterol carried back to the liver by high-density lipoproteins.", how: "Standard lipid panel (blood draw).", learn: "Low HDL often travels with insulin resistance and inactivity; exercise tends to raise it." },
    triglycerides: { name: "Triglycerides", what: "Fat circulating in the blood, strongly affected by sugar, alcohol and refined carbs.", how: "Lipid panel after a 9–12 hour fast.", learn: "High values point to insulin resistance and respond quickly to diet and training." },
    apob: { name: "ApoB", what: "A count of every plaque-forming particle (LDL, VLDL, Lp(a)) — one ApoB per particle.", how: "Ask for an ApoB test with your lipid panel; inexpensive and widely available.", learn: "The most accurate single measure of cardiovascular risk from lipids." },
    lp_a: { name: "Lipoprotein(a)", what: "A genetically determined, particularly sticky LDL-like particle.", how: "A single blood test; once in a lifetime is usually enough because it barely changes.", learn: "About 1 in 5 people have high Lp(a), which raises heart risk regardless of lifestyle." },
    fasting_glucose: { name: "Fasting glucose", what: "Blood sugar after at least 8 hours without food.", how: "Basic metabolic panel (blood draw) or a finger-prick meter in the morning.", learn: "A snapshot of glucose control; 100–125 mg/dL signals prediabetes." },
    hba1c: { name: "HbA1c", what: "The share of haemoglobin with sugar attached — a ~3-month average of blood sugar.", how: "Blood draw, no fasting needed. Often included in check-ups.", learn: "5.7–6.4 % is prediabetes; it shows trends a single glucose reading misses." },
    fasting_insulin: { name: "Fasting insulin", what: "How much insulin your body needs to keep fasting glucose normal.", how: "Blood draw after an overnight fast; ask for it specifically.", learn: "Rising insulin is often the earliest sign of insulin resistance, years before glucose moves." },
    hs_crp: { name: "hs-CRP", what: "A sensitive marker of low-grade inflammation throughout the body.", how: "Blood draw; avoid testing within two weeks of illness or a very hard session.", learn: "Below 1 mg/L is low cardiovascular risk; above 3 mg/L warrants a closer look." },
    hemoglobin: { name: "Haemoglobin", what: "The oxygen-carrying protein in red blood cells.", how: "Complete blood count (CBC), part of almost every check-up.", learn: "Low values (anaemia) cap endurance and cause fatigue; check iron stores alongside." },
    tsh: { name: "TSH", what: "The pituitary signal that tells your thyroid how hard to work.", how: "Blood draw, ideally in the morning.", learn: "High TSH suggests an underactive thyroid (fatigue, weight gain); low suggests overactive." },
    free_t4: { name: "Free T4", what: "The main hormone your thyroid releases, in its active, unbound form.", how: "Blood draw, usually ordered with TSH.", learn: "Confirms whether an abnormal TSH reflects a real thyroid problem." },
    testosterone: { name: "Total testosterone", what: "The main androgen, important for muscle, bone, mood and libido in all sexes.", how: "Blood draw between 7 and 10 am; repeat if low, as levels vary day to day.", learn: "Low levels in men are linked to fatigue and poor recovery; overtraining can suppress it." },
    vitamin_d: { name: "Vitamin D (25-OH)", what: "Your body's vitamin D stores, made in skin from sunlight or taken in food and supplements.", how: "25-hydroxyvitamin D blood test; best at the end of winter.", learn: "Deficiency is very common and affects bone, muscle and immunity; it's easy to correct." },
    ferritin: { name: "Ferritin", what: "The protein that stores iron — your iron reserve.", how: "Blood draw; test when you're not ill, as inflammation raises it.", learn: "Low ferritin causes fatigue and poor endurance before anaemia appears; common in runners and women." },
    vitamin_b12: { name: "Vitamin B12", what: "A vitamin needed for nerves and red blood cell production.", how: "Blood draw; ask for it if you eat little or no animal food.", learn: "Low B12 causes fatigue and nerve symptoms; vegans and older adults are most at risk." },
    omega3_index: { name: "Omega-3 index", what: "EPA + DHA as a percentage of fatty acids in red blood cell membranes.", how: "At-home finger-prick kit or a specialised lab.", learn: "8 % or more is linked to lower cardiovascular risk; below 4 % is high risk." },
    alt: { name: "ALT", what: "A liver enzyme that leaks into blood when liver cells are stressed.", how: "Liver panel or comprehensive metabolic panel (blood draw).", learn: "Mildly raised ALT often means fatty liver; hard training can raise it temporarily." },
    ast: { name: "AST", what: "An enzyme found in liver and muscle.", how: "Liver panel (blood draw).", learn: "Read with ALT: AST high but ALT normal after training usually means muscle, not liver." },
    creatinine: { name: "Creatinine", what: "A waste product from muscle, cleared by the kidneys.", how: "Basic metabolic panel (blood draw).", learn: "Used to estimate kidney function; muscular people and creatine users run higher." },
    egfr: { name: "eGFR", what: "Estimated kidney filtration rate, calculated from creatinine, age and sex.", how: "Reported automatically with a creatinine test.", learn: "Below 60 for three months defines chronic kidney disease." },
    dexa_body_fat: { name: "Body fat (DEXA)", what: "Body fat measured by a low-dose X-ray scan — the practical gold standard.", how: "DEXA scan at a clinic, sports lab or imaging centre; about 10 minutes.", learn: "Shows fat, lean mass and visceral fat precisely, and how far off your smart scale is." },
    vo2max_lab: { name: "VO₂ max (lab test)", what: "Maximal oxygen uptake measured with a mask during an all-out treadmill or bike test.", how: "Sports-science lab, university or performance clinic.", learn: "Calibrates your watch's estimate and sets accurate training zones." },
    // Wearable metrics
    vo2max: { what: "Your watch's estimate of maximal oxygen uptake.", how: "Garmin, Apple Watch, Polar, COROS and Suunto estimate it from runs and rides with heart rate.", learn: "Each step up in VO₂ max is linked to markedly lower all-cause mortality." },
    resting_hr: { what: "Your heart rate at complete rest, usually measured overnight.", how: "Any ring, band or watch worn at night: WHOOP, Oura, Garmin, Apple Watch, Polar.", learn: "Falls as fitness improves; a sudden rise often means illness, stress or overreaching." },
    hrv_rmssd: { what: "Beat-to-beat variation in heart rhythm, a window into your nervous system.", how: "Overnight measurement from WHOOP, Oura, Garmin or Polar, or a morning reading with a Polar H10.", learn: "Compared with your own baseline, it shows how recovered you are." },
    bp_systolic: { what: "Peak pressure in your arteries as the heart beats.", how: "A validated upper-arm cuff (Withings, Omron, iHealth); measure seated, morning and evening.", learn: "High blood pressure is silent and the biggest modifiable heart risk; 120/80 or below is ideal." },
    bp_diastolic: { what: "Pressure in your arteries between beats.", how: "Measured together with systolic pressure on an upper-arm cuff.", learn: "Persistently above 80 mmHg raises cardiovascular risk." },
    blood_glucose: { what: "Glucose measured continuously under the skin, every few minutes.", how: "A CGM such as Dexcom; many are available without prescription.", learn: "Shows how food, training, sleep and stress move your blood sugar in real life." },
    glucose_tir: { what: "Share of the day your glucose stays in the target range.", how: "Calculated from CGM data (e.g. Dexcom).", learn: "A practical daily score of glucose stability." },
    sleep_duration: { what: "Total time asleep per night.", how: "Any ring, band or watch worn at night, or a bed sensor such as Withings Sleep.", learn: "Adults need 7–9 hours; short sleep hurts recovery, appetite and glucose control." },
    sleep_efficiency: { what: "Share of time in bed actually spent asleep.", how: "Ring, band, watch or bed sensor.", learn: "Below 85 % suggests fragmented sleep or too long in bed." },
    respiratory_rate: { what: "Breaths per minute during sleep.", how: "WHOOP, Oura, Garmin, Apple Watch and Withings measure it overnight.", learn: "Very stable night to night — a rise is one of the earliest signs of illness." },
    spo2: { what: "Oxygen saturation of your blood.", how: "Oura, WHOOP, Garmin, Apple Watch or a fingertip pulse oximeter.", learn: "Repeated overnight dips can point to sleep-disordered breathing worth checking." },
    weight: { what: "Body weight.", how: "Any smart scale (Withings, iHealth) or manual entry.", learn: "The trend over weeks matters, not daily swings from water and food." },
    body_fat: { what: "Body fat percentage estimated by a smart scale.", how: "Bioimpedance scales such as Withings Body+ / Body Comp.", learn: "Good for trends; calibrate the absolute number against a DEXA scan." },
    muscle_mass: { what: "Estimated muscle mass from a bioimpedance scale.", how: "Withings Body Comp and similar scales.", learn: "Keeping muscle is central to metabolic health and healthy ageing." },
  },
};

export default lab;
export type LabCopy = typeof lab;
