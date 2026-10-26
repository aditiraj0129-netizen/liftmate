/**
 * Everything the coach says instantly during a set (no AI wait).
 * Several versions of each line so it never sounds repetitive.
 * Hindi is written in Devanagari so the Hindi voice pronounces it naturally.
 */
import type { Lang } from "./pose/engines";

type Pool = Record<Lang, string[]>;

export const LINES: Record<string, Pool> = {
  struggle: {
    en: ["Come on! Push!", "Drive it up! You've got this!", "Don't quit now! Fight for it!", "Push push push!", "It's time to be strong!", "Breathe and drive! Almost there!", "Come on, grind it out!"],
    hi: ["चलो! पुश करो!", "पूरा दम लगाओ! तुम कर सकते हो!", "हार मत मानो! लड़ो!", "चलो चलो चलो!", "अब ताकत दिखाने का टाइम है!", "सांस लो और ज़ोर लगाओ! बस हो गया!", "रुकना नहीं, पूरा करो!"],
  },
  praise: {
    en: ["Beautiful rep!", "That's it!", "Perfect form!", "Clean rep!", "Nice and controlled!", "Strong!"],
    hi: ["बहुत बढ़िया!", "एकदम सही!", "शानदार रेप!", "परफेक्ट फॉर्म!", "वाह, कंट्रोल बढ़िया है!", "दमदार!"],
  },
  badRep: {
    en: ["That one wasn't clean.", "Fix that next rep.", "Not quite, reset."],
    hi: ["ये रेप सही नहीं था।", "अगले रेप में ठीक करो।", "थोड़ा गड़बड़, सही करो।"],
  },
  firstRep: {
    en: ["Great start!", "Nice first rep!", "That's how we start!"],
    hi: ["बढ़िया शुरुआत!", "शानदार पहला रेप!", "ऐसे होती है शुरुआत!"],
  },
  bonus: {
    en: ["Bonus rep! Only if form stays clean.", "Extra rep! Beast mode!"],
    hi: ["बोनस रेप! फॉर्म सही रहे तो ही।", "एक्स्ट्रा रेप! ज़बरदस्त!"],
  },
  lastTwo: {
    en: ["Last two! Make them count!", "Two more! Finish strong!"],
    hi: ["आखिरी दो! पूरा ज़ोर!", "बस दो और! दमदार खत्म करो!"],
  },
  target: {
    en: ["Target done! Keep going only if form stays clean.", "That's your target! Great set."],
    hi: ["टारगेट पूरा! फॉर्म सही है तभी आगे बढ़ो।", "टारगेट हो गया! शानदार सेट।"],
  },
  lowRir: {
    en: ["One or two strong reps left. Stay tight!", "You're close to your limit. Make every rep clean!"],
    hi: ["बस एक-दो और, टाइट रहो!", "लिमिट के पास हो, हर रेप साफ़ करो!"],
  },
  idle: {
    en: ["Take a breath. Go again when ready, or end the set.", "Shake it out. Ready when you are."],
    hi: ["सांस ले लो। तैयार हो तो फिर शुरू करो, या सेट खत्म करो।", "थोड़ा रिलैक्स करो, तैयार होते ही शुरू।"],
  },
  holdPush: {
    en: ["Hold it! You're doing great!", "Stay strong, keep breathing!", "Don't drop! Keep it tight!"],
    hi: ["होल्ड करो! बहुत बढ़िया!", "मज़बूत रहो, सांस लेते रहो!", "गिरना नहीं! टाइट रखो!"],
  },
  nextSet: { en: ["Next set! Get into position."], hi: ["अगला सेट! पोज़ीशन में आओ।"] },
  paused: { en: ["Paused."], hi: ["रुक गए।"] },
  resumed: { en: ["Let's go!"], hi: ["चलो, शुरू!"] },
  restTen: { en: ["Ten seconds left, get ready."], hi: ["दस सेकंड बचे हैं, तैयार हो जाओ।"] },
  restDone: { en: ["Rest over. Next set when you're ready."], hi: ["रेस्ट खत्म। तैयार हो तो अगला सेट।"] },
  settingUp: { en: ["Setting up your coach."], hi: ["कोच तैयार हो रहा है।"] },
};

const HI_NUMBERS = ["", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस",
  "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस"];
const EN_NUMBERS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty one", "Twenty two", "Twenty three", "Twenty four", "Twenty five", "Twenty six", "Twenty seven", "Twenty eight", "Twenty nine", "Thirty"];

export function countWord(n: number, lang: Lang) {
  const list = lang === "hi" ? HI_NUMBERS : EN_NUMBERS;
  return n < list.length ? list[n] : String(n);
}

export function secondsLine(n: number, lang: Lang) {
  return lang === "hi" ? `${n} सेकंड!` : `${n} seconds!`;
}

const lastPicked = new Map<string, number>();
/** A random line from a pool, never the same one twice in a row. */
export function line(key: keyof typeof LINES, lang: Lang): string {
  const pool = LINES[key][lang];
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastPicked.get(`${key}${lang}`)) i = (i + 1) % pool.length;
  lastPicked.set(`${key}${lang}`, i);
  return pool[i];
}

/** "Six more! You can do it!" style lines, counting down to the target. */
export function remainingLines(rem: number, lang: Lang): string[] {
  const w = countWord(rem, lang);
  if (rem === 1) {
    return lang === "hi"
      ? ["बस एक और! सबसे बढ़िया वाला!", "आखिरी रेप! पूरा दम लगाओ!", "एक और! चलो!"]
      : ["One more! Make it your best!", "Last one! Give it everything!", "One more! Come on!"];
  }
  return lang === "hi"
    ? [`${w} और! तुम कर सकते हो!`, `बस ${w} बाकी! मज़बूत रहो!`, `सिर्फ़ ${w} और! चलो!`, `${w} और! अब ताकत दिखाने का टाइम है!`]
    : [`${w} more! You can do it!`, `${w} to go! Stay strong!`, `Only ${w.toLowerCase()} left! Come on!`, `${w} more! It's time to be strong!`];
}

const lastRemaining = new Map<string, number>();
export function remainingLine(rem: number, lang: Lang): string {
  const pool = remainingLines(rem, lang);
  const key = `${lang}${rem}`;
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastRemaining.get(key)) i = (i + 1) % pool.length;
  lastRemaining.set(key, i);
  return pool[i];
}

export function allLines(lang: Lang): string[] {
  return Object.values(LINES).flatMap((pool) => pool[lang]);
}
