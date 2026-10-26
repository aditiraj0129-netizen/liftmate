/**
 * Liftmate voice.
 * speak(): plays a realistic neural voice (Indian English / Hindi) from our backend /tts.
 *          Clips are cached, so rep counts and cues play instantly after the first time.
 *          If the voice service is unreachable, it falls back to the browser's built-in voice.
 * listen(): speech-to-text from the browser (Chrome / Edge).
 */
import { supabase } from "./supabase";

export type Lang = "en" | "hi";
export type Gender = "female" | "male";
export type Style = "normal" | "hype" | "calm";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

// ---------- settings ----------
let muted = false;
export const setMuted = (value: boolean) => {
  muted = value;
  if (value) stopSpeaking();
};
export const isMuted = () => muted;

export function getVoiceGender(): Gender {
  if (typeof window === "undefined") return "female";
  try {
    return (localStorage.getItem("lm_voice") as Gender) || "female";
  } catch {
    return "female";
  }
}
export function setVoiceGender(gender: Gender) {
  try {
    localStorage.setItem("lm_voice", gender);
  } catch {
    /* ignore */
  }
}

// ---------- neural voice clips ----------
const clipCache = new Map<string, Promise<string | null>>();
let serviceDown = false;

function clipKey(text: string, lang: Lang, style: Style, gender: Gender) {
  return `${lang}|${gender}|${style}|${text}`;
}

function fetchClip(text: string, lang: Lang, style: Style, gender = getVoiceGender()): Promise<string | null> {
  const key = clipKey(text, lang, style, gender);
  const hit = clipCache.get(key);
  if (hit) return hit;
  const job = (async () => {
    if (serviceDown) return null;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const response = await fetch(`${API_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text, lang, gender, style }),
    });
    if (response.status === 503) serviceDown = true; // stop trying for this page visit
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  })().catch(() => null);
  clipCache.set(key, job);
  job.then((url) => {
    if (!url) clipCache.delete(key);
  });
  return job;
}

/** Download clips in the background so they play with no delay later. */
export async function preload(texts: string[], lang: Lang, style: Style = "normal") {
  const unique = [...new Set(texts.filter(Boolean))];
  let index = 0;
  const worker = async () => {
    while (index < unique.length && !serviceDown) {
      const text = unique[index++];
      await fetchClip(text, lang, style);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// ---------- playback queue ----------
type Item = { text: string; lang: Lang; style: Style };
let queue: Item[] = [];
let playing = false;
let generation = 0;
let audio: HTMLAudioElement | null = null;

function player() {
  if (!audio && typeof window !== "undefined") audio = new Audio();
  return audio;
}

/** Call once inside a tap (e.g. the Start button) so phones allow audio to play later. */
export function unlockAudio() {
  const a = player();
  if (!a) return;
  a.src = SILENT_WAV;
  a.play().catch(() => {});
  if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}

export function stopSpeaking() {
  generation += 1;
  queue = [];
  playing = false;
  audio?.pause();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function isSpeaking() {
  return playing;
}

/**
 * Say something.
 * interrupt = true cuts off whatever is playing (rep counts, safety cues).
 * style "hype" = faster and more energetic (motivation).
 */
export function speak(text: string, lang: Lang = "en", interrupt = false, style: Style = "normal") {
  if (muted || typeof window === "undefined" || !text?.trim()) return;
  if (interrupt) stopSpeaking();
  queue.push({ text: text.trim(), lang, style });
  if (!playing) void playNext();
}

async function playNext() {
  const item = queue.shift();
  if (!item) {
    playing = false;
    return;
  }
  playing = true;
  const gen = generation;
  const url = await fetchClip(item.text, item.lang, item.style);
  if (gen !== generation) return; // interrupted while loading
  const a = player();
  if (url && a) {
    a.onended = () => gen === generation && void playNext();
    a.onerror = () => gen === generation && void playNext();
    a.src = url;
    try {
      await a.play();
      return;
    } catch {
      /* fall through to browser voice */
    }
  }
  browserSpeak(item, () => gen === generation && void playNext());
}

// ---------- browser voice fallback ----------
function pickBrowserVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const codes = lang === "hi" ? ["hi-in", "hi"] : ["en-in", "en-gb", "en-us", "en"];
  for (const code of codes) {
    const matches = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(code));
    const best = matches.find((v) => /natural|neural|google|premium|enhanced/i.test(v.name)) ?? matches[0];
    if (best) return best;
  }
  return undefined;
}

function browserSpeak(item: Item, done: () => void) {
  if (!("speechSynthesis" in window)) return done();
  const utterance = new SpeechSynthesisUtterance(item.text);
  const voice = pickBrowserVoice(item.lang);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? (item.lang === "hi" ? "hi-IN" : "en-IN");
  utterance.rate = item.style === "hype" ? 1.08 : 1;
  utterance.onend = done;
  utterance.onerror = done;
  window.speechSynthesis.speak(utterance);
}

// ---------- listening ----------
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (event: { error: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => recognitionClass() !== null;

/** Listen once and return what the user said ("" if nothing). */
export function listen(lang: Lang = "en"): Promise<string> {
  const Klass = recognitionClass();
  if (!Klass) return Promise.reject(new Error("Voice input isn't supported in this browser. Try Chrome."));
  stopSpeaking();
  return new Promise((resolve, reject) => {
    const rec = new Klass();
    rec.lang = lang === "hi" ? "hi-IN" : "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text = "";
    rec.onresult = (event) => {
      text = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    rec.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") resolve("");
      else reject(new Error(event.error === "not-allowed" ? "Microphone permission was blocked." : `Voice error: ${event.error}`));
    };
    rec.onend = () => resolve(text);
    rec.start();
  });
}
