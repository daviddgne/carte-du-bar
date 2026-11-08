// Outils partagés entre la vue équipe et l'administration.
import { STRINGS } from './i18n.js';

export const PATHS = {
  config: 'data/config.json',
  vocab: 'data/vocabulaire.json',
  etab: (id) => `data/etablissements/${id}.json`
};

export const DRAFT_KEY = 'carte-admin-brouillon-v1';
const LANG_KEY = 'carte-langue';

/* ---------- Stockage navigateur (toujours protégé) ---------- */
export function store(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch { return false; }
}
export function load(key, parse = true) {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return null;
    return parse ? JSON.parse(v) : v;
  } catch { return null; }
}

/* ---------- Langue ---------- */
let lang = 'fr';
export function initLang() {
  const saved = load(LANG_KEY, false);
  if (saved === 'fr' || saved === 'en') lang = saved;
  else lang = (navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
  document.documentElement.lang = lang === 'en' ? 'en-CA' : 'fr-CA';
  return lang;
}
export function getLang() { return lang; }
export function setLang(l) {
  lang = l;
  store(LANG_KEY, l);
  document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
}

export function t(key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.fr[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export function tn(base, n) {
  const key = n === 0 && STRINGS.fr[`${base}.zero`] ? `${base}.zero` : n === 1 ? `${base}.one` : `${base}.many`;
  return t(key, { n });
}

// Texte bilingue : { fr, en } ou simple chaîne. L'anglais retombe sur le français.
export function tx(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return (lang === 'en' ? (v.en || v.fr) : (v.fr || v.en)) || '';
}

/* ---------- Construction du DOM (sans innerHTML pour les données) ---------- */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v; // réservé aux icônes SVG internes
      else if (v === true) el.setAttribute(k, '');
      else if (k in el && typeof el[k] !== 'function' && !k.includes('-') && k !== 'list' && k !== 'form') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      }
      else el.setAttribute(k, v);
    }
  }
  appendAll(el, children);
  return el;
}
function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/* ---------- Données ---------- */
export async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status} sur ${path}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

export function indexVocab(vocab) {
  const idx = {};
  for (const [list, items] of Object.entries(vocab || {})) {
    idx[list] = new Map((items || []).map((it) => [it.id, it]));
  }
  return idx;
}
export function label(V, list, id) {
  const it = V[list] && V[list].get(id);
  return it ? tx(it) : id;
}

/* ---------- Formats ---------- */
function locale() { return lang === 'en' ? 'en-CA' : 'fr-CA'; }
export function fmtNum(n, max = 1) {
  if (n == null || n === '' || isNaN(n)) return '';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: max }).format(Number(n));
}
export function fmtAbv(n) { return n == null || n === '' ? '' : `${fmtNum(n)} %`.replace(' %', lang === 'en' ? '%' : ' %'); }
export function fmtPrice(n) {
  if (n == null || n === '' || isNaN(n)) return '';
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'CAD', minimumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n));
}
export function parseNum(s) {
  if (s == null) return null;
  const v = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
export function bucketOf(buckets, v) {
  if (v == null || v === '' || isNaN(v)) return null;
  const n = Number(v);
  const b = buckets.find((b) => n >= b.min && n < b.max);
  return b ? b.id : null;
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'element';
}
export function uid(prefix = 'p') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* ---------- Images ---------- */
// Une image "en attente" (pas encore publiée) est gardée en data URL dans le brouillon.
export function imgSrc(path, pending) {
  if (!path) return '';
  if (pending && pending[path]) return pending[path];
  return path;
}

const ICONS = {
  biere: '<path d="M18 14h24l-3 42H21z"/><path d="M42 22h5a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4h-6"/><path d="M19 24h22"/><path d="M18 14c0-5 5-7 8-4 2-4 8-4 10 0 3-2 7 0 6 4"/>',
  cidre: '<path d="M32 20c-4-4-15-3-16 8-1 11 6 26 12 26 2 0 3-1 4-1s2 1 4 1c6 0 13-15 12-26-1-11-12-12-16-8z"/><path d="M32 20c0-5 2-8 6-10"/><path d="M34 14c3-3 8-3 10-1-3 3-7 3-10 1z"/>',
  vin: '<path d="M21 8h22c0 13-4 22-11 22S21 21 21 8z"/><path d="M22 17h20"/><path d="M32 30v20"/><path d="M23 56h18"/>',
  spiritueux: '<path d="M28 6h8v10l5 7v31a3 3 0 0 1-3 3H26a3 3 0 0 1-3-3V23l5-7z"/><path d="M23 32h18v14H23z"/>',
  cocktail: '<path d="M12 12h40L32 34z"/><path d="M32 34v18"/><path d="M23 56h18"/><path d="M18 18h28"/><circle cx="42" cy="12" r="4"/><path d="M45 9l6-5"/>',
  'sans-alcool': '<path d="M19 20h26l-4 36H23z"/><path d="M35 20l6-14h7"/><path d="M21 31h22"/>'
};
export function categoryIcon(cat, cls = 'cat-icon') {
  const body = ICONS[cat] || ICONS.biere;
  return `<svg class="${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
export const UI_ICONS = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 4.4 2.5.8-1.4 2.3-2.5 4.4-2.5 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
};

/* ---------- Brouillon de l'admin (lu aussi par l'aperçu public) ---------- */
export function readDraft() { return load(DRAFT_KEY); }
