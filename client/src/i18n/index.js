// Minimal i18n: English is the source language (strings in code), other languages are dictionaries.
// t('Save') -> 'Speichern' when German is active. Missing entries fall back to English.
import { useSyncExternalStore } from 'react';
import de from './de.js';

const DICTS = { de };
export const LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
];
const STORAGE_KEY = 'cd2000.lang';

function initialLang() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'de' || s === 'en') return s;
  } catch {
    /* storage unavailable */
  }
  return (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'de';
}

let current = initialLang();
const listeners = new Set();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;

export function setLang(lang) {
  if (!['de', 'en'].includes(lang) || lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  listeners.forEach((f) => f());
}

export function useLang() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
}

export function fill(s, params) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
}

export function t(s, params) {
  const dict = DICTS[current];
  return fill((dict && dict[s]) || s, params);
}

/** Locale for number/date formatting */
export const locale = () => (current === 'de' ? 'de-DE' : 'en-GB');
