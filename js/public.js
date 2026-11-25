// Carte pour l'équipe : liste avec boutons de goût, fiche d'un coup d'œil, mots expliqués.
import * as C from './core.js';
import { FORCES, forceDe, UNITES } from './i18n.js';

const { h, t, tn, tx } = C;
const ETAB_KEY = 'carte-etablissement';
const app = document.getElementById('app');

// Couleur du haut de la fiche selon le type de bière.
const COULEURS = { blonde: '#a8741a', blanche: '#efe3bd', rousse: '#a84d17', noire: '#2b1d16', ipa: '#a9690c', cidre: '#55801f' };
const COULEUR_DEFAUT = '#8f2747';
const NIVEAU_AMERTUME = { peu: 1, moyenne: 2, tres: 3 };
const NIVEAU_FORCE = { legere: 1, moyenne: 2, forte: 3 };

const S = {
  config: null, vocab: null, V: null,
  etabId: null, all: [], produits: [], plats: [], pending: {},
  preview: false, draft: null,
  q: '', sel: emptySel(), mode: 'gout', platOuvert: null,
  motsRe: []
};
const R = {}; // références DOM

function emptySel() {
  return { gout: new Set(), famille: new Set(), force: new Set() };
}

/* ---------- Boutons de recherche ---------- */
const OPPOSES = { 'pas-amere': 'amere', amere: 'pas-amere' };

function goutsDe(p) {
  const out = [...(p.gouts || [])];
  if (p.amertume === 'peu') out.push('pas-amere');
  if (p.amertume === 'tres') out.push('amere');
  return out;
}
const ids = (list) => (S.vocab[list] || []).map((x) => x.id);

const RANGEES = [
  { id: 'gout', mode: 'et', valeurs: goutsDe, ordre: () => ids('gouts'), libelle: (v) => C.label(S.V, 'gouts', v) },
  { id: 'famille', mode: 'ou', valeurs: (p) => (p.famille ? [p.famille] : []), ordre: () => ids('familles'), libelle: (v) => C.label(S.V, 'familles', v) },
  {
    id: 'force', mode: 'ou',
    valeurs: (p) => { const f = forceDe(p.alcool); return f ? [f] : []; },
    ordre: () => FORCES.map((f) => f.id), libelle: (v) => t('force.' + v)
  }
];

function correspond(p, r, sel) {
  if (!sel.size) return true;
  const vals = r.valeurs(p);
  return r.mode === 'et' ? [...sel].every((v) => vals.includes(v)) : vals.some((v) => sel.has(v));
}
function correspondTexte(p) {
  const q = C.normalize(S.q).trim();
  if (!q) return true;
  if (!p._hay) p._hay = C.normalize(`${p.nom} ${p.producteur || ''}`);
  return q.split(/\s+/).every((m) => p._hay.includes(m));
}
function filtres(sauf, selTest) {
  return S.produits.filter((p) => correspondTexte(p) && RANGEES.every((r) => {
    if (r.id === sauf) return selTest ? correspond(p, r, selTest) : true;
    return correspond(p, r, S.sel[r.id]);
  }));
}
function selectionAvec(r, v) {
  const next = new Set(S.sel[r.id]);
  if (OPPOSES[v]) next.delete(OPPOSES[v]);
  next.add(v);
  return next;
}
function basculer(r, v) {
  const sel = S.sel[r.id];
  if (sel.has(v)) sel.delete(v);
  else { if (OPPOSES[v]) sel.delete(OPPOSES[v]); sel.add(v); }
  actualiser();
}

/* ---------- Mots expliqués ---------- */
function preparerMots() {
  const en = C.getLang() === 'en';
  S.motsRe = (S.vocab.mots || []).map((m) => {
    const motif = en ? m.motif_en : m.motif;
    if (!motif) return null;
    try { return { m, re: new RegExp('(^|[^\\p{L}\\p{N}])(' + motif + ')(?![\\p{L}\\p{N}])', 'iu') }; }
    catch { return null; }
  }).filter(Boolean);
}

// Transforme les mots du lexique en boutons (3 au plus par texte, une fois chacun).
function lier(texte, exclure) {
  const trouves = [];
  for (const { m, re } of S.motsRe) {
    if (m.id === exclure) continue;
    const r = re.exec(texte);
    if (!r) continue;
    const debut = r.index + r[1].length;
    trouves.push({ debut, fin: debut + r[2].length, m, mot: r[2] });
  }
  trouves.sort((a, b) => a.debut - b.debut);
  const out = [];
  let pos = 0, n = 0;
  for (const f of trouves) {
    if (f.debut < pos || n >= 3) continue;
    out.push(texte.slice(pos, f.debut));
    out.push(h('button', { type: 'button', class: 'mot', onclick: (e) => { e.stopPropagation(); ouvrirMot(f.m.id); } }, f.mot));
    pos = f.fin;
    n++;
  }
  out.push(texte.slice(pos));
  return out;
}

function noms(liste) { return liste.slice(0, 4).map((p) => p.nom).join(', '); }
function exempleMot(id) {
  const P = S.produits;
  const extremes = (cle, fmt, modele) => {
    const l = P.filter((p) => p[cle] != null).sort((a, b) => a[cle] - b[cle]);
    if (l.length < 2) return null;
    const a = l[0], b = l[l.length - 1];
    return t(modele, { a: a.nom, x: fmt(a[cle]), b: b.nom, y: fmt(b[cle]) });
  };
  const liste = (f) => { const l = P.filter(f); return l.length ? t('ex.liste', { l: noms(l) }) : null; };
  switch (id) {
    case 'amertume': case 'ibu': return extremes('ibu', (n) => C.fmtNum(n), 'ex.ibu');
    case 'force': return extremes('alcool', (n) => C.fmtAbv(n), 'ex.force');
    case 'sure': return liste((p) => (p.gouts || []).includes('acidulee'));
    case 'houblon': return liste((p) => p.amertume === 'tres');
    case 'malt': return liste((p) => (p.gouts || []).includes('caramel'));
    case 'torrefie': return liste((p) => (p.gouts || []).includes('cafe-chocolat'));
    case 'lager': return liste((p) => ['lager', 'lager-legere', 'pilsner'].includes(p.style));
    case 'trouble': return liste((p) => ['neipa', 'weizen', 'gose', 'blanche'].includes(p.style));
    default: return null;
  }
}

function ouvrirMot(id) {
  const m = (S.vocab.mots || []).find((x) => x.id === id);
  if (!m || !R.feuille) return;
  const ex = exempleMot(id);
  C.clear(R.feuille);
  R.feuille.append(
    h('div', { class: 'feuille-fond', onclick: fermerMot }),
    h('div', { class: 'feuille', role: 'dialog', 'aria-label': tx(m) },
      h('div', { class: 'feuille-tete' },
        h('h3', null, tx(m)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('mot.fermer'), html: C.UI_ICONS.close, onclick: fermerMot })),
      h('p', null, lier(tx(m.definition), id)),
      ex ? h('div', { class: 'feuille-ex' }, h('div', { class: 'et' }, t('mot.exemple')), ex) : null));
  R.feuille.hidden = false;
}
function fermerMot() { if (R.feuille) { R.feuille.hidden = true; C.clear(R.feuille); } }

/* ---------- Chargement ---------- */
async function init() {
  C.initLang();
  const params = new URLSearchParams(location.search);
  S.preview = params.has('apercu');
  try {
    if (S.preview) S.draft = C.readDraft();
    if (S.draft) {
      S.config = S.draft.config; S.vocab = S.draft.vocab; S.pending = S.draft.pendingImages || {};
    } else {
      S.preview = false;
      [S.config, S.vocab] = await Promise.all([C.loadJSON(C.PATHS.config), C.loadJSON(C.PATHS.vocab)]);
    }
    S.V = C.indexVocab(S.vocab);
    preparerMots();
    const etabs = S.config.etablissements || [];
    const voulu = params.get('e') || C.load(ETAB_KEY, false);
    S.etabId = (etabs.find((e) => e.id === voulu) || etabs[0] || {}).id || null;
    await chargerEtab(S.etabId);
    dessiner();
    syncDepuisHash();
  } catch (e) {
    console.error(e);
    C.clear(app).append(h('div', { class: 'error-box' }, t('error.load')));
  }
}

async function chargerEtab(id) {
  let data = { produits: [], plats: [] };
  if (id) {
    if (S.draft && S.draft.etabs && S.draft.etabs[id]) data = S.draft.etabs[id];
    else {
      try { data = await C.loadJSON(C.PATHS.etab(id)); }
      catch (e) { if (e.status !== 404) throw e; }
    }
  }
  S.all = (data.produits || []).map((p) => ({ ...p }));
  S.produits = S.all.filter((p) => p.disponible !== false);
  S.plats = data.plats || [];
  S.sel = emptySel();
  S.q = '';
  S.platOuvert = null;
  if (!S.plats.length) S.mode = 'gout';
}

function etabCourant() { return (S.config.etablissements || []).find((e) => e.id === S.etabId); }

/* ---------- Page ---------- */
function dessiner() {
  C.clear(app);
  const etabs = S.config.etablissements || [];
  const etab = etabCourant();
  const nomSite = tx(S.config.site && S.config.site.nom) || 'Carte';
  document.title = etab ? `${nomSite} · ${etab.nom}` : nomSite;

  if (S.preview) {
    const sortie = new URL(location.href); sortie.searchParams.delete('apercu'); sortie.hash = '';
    app.append(h('div', { class: 'banner' }, h('span', null, t('preview.banner')), h('a', { href: sortie.pathname + sortie.search }, t('preview.exit'))));
  }

  const pub = etabs.length > 1
    ? h('select', { class: 'etab-select', 'aria-label': t('etab'), onchange: (e) => changerEtab(e.target.value) },
      etabs.map((e) => h('option', { value: e.id, selected: e.id === S.etabId }, e.nom)))
    : etab && h('span', { class: 'etab-nom' }, etab.nom);

  app.append(h('header', { class: 'topbar' },
    h('h1', null, nomSite),
    pub,
    h('button', { class: 'btn-lang', type: 'button', 'aria-label': t('lang.switchLabel'), onclick: changerLangue }, t('lang.switch'))
  ));

  if (S.plats.length) {
    app.append(h('div', { class: 'modes', role: 'group', 'aria-label': t('mode.label') },
      ['gout', 'plat'].map((m) => h('button', {
        type: 'button', class: 'mode', 'aria-pressed': String(S.mode === m),
        onclick: () => { if (S.mode !== m) { S.mode = m; dessiner(); } }
      }, t('mode.' + m)))));
  }

  R.corps = h('main', { class: 'corps' });
  app.append(R.corps);
  if (S.mode === 'plat') dessinerPlats(); else dessinerGout();

  R.fiche = h('div', { class: 'detail-inner' });
  R.feuille = h('div', { class: 'feuille-zone', hidden: true });
  R.dialog = h('dialog', { class: 'detail' }, R.fiche, R.feuille);
  R.dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!R.feuille.hidden) fermerMot(); else fermerFiche();
  });
  app.append(R.dialog);
}

/* ---------- Mode « Par goût » ---------- */
function dessinerGout() {
  R.search = h('input', {
    type: 'search', placeholder: t('search.placeholder'), 'aria-label': t('search.label'), value: S.q,
    autocomplete: 'off', enterkeyhint: 'search',
    oninput: (e) => { S.q = e.target.value; actualiser(); }
  });
  R.rangees = h('div', { class: 'rangees' });
  R.boutons = [];
  for (const r of RANGEES) {
    const presentes = new Set();
    for (const p of S.produits) for (const v of r.valeurs(p)) presentes.add(v);
    const options = r.ordre().filter((v) => presentes.has(v));
    if (!options.length) continue;
    const puces = options.map((v) => {
      const b = h('button', { type: 'button', class: 'puce', onclick: () => basculer(r, v) }, r.libelle(v));
      R.boutons.push({ r, v, b });
      return b;
    });
    R.rangees.append(h('div', { class: 'rangee' },
      h('span', { class: 'rangee-titre' }, t('row.' + r.id)),
      h('div', { class: 'rangee-puces' }, puces)));
  }
  R.compte = h('span');
  R.effacer = h('button', { class: 'link-btn', type: 'button', onclick: toutEffacer }, t('clear'));
  R.liste = h('div', { class: 'liste' });
  R.corps.append(
    h('label', { class: 'search', html: C.UI_ICONS.search }, R.search),
    R.rangees,
    h('div', { class: 'meta' }, R.compte, R.effacer),
    R.liste);
  actualiser();
}

function actualiser() {
  for (const { r, v, b } of R.boutons) {
    const actif = S.sel[r.id].has(v);
    b.setAttribute('aria-pressed', String(actif));
    b.disabled = !actif && filtres(r.id, r.mode === 'et' ? selectionAvec(r, v) : new Set([v])).length === 0;
  }
  const n = filtres();
  C.clear(R.compte).append(h('b', null, String(n.length)), ' ', tn('results', n.length).replace(/^\d+\s*/, ''));
  R.effacer.hidden = !S.q && !Object.values(S.sel).some((s) => s.size);
  dessinerListe(n);
}

function toutEffacer() {
  S.sel = emptySel();
  S.q = '';
  if (R.search) R.search.value = '';
  actualiser();
}

function dessinerListe(produits) {
  C.clear(R.liste);
  if (!S.produits.length) {
    R.liste.append(h('div', { class: 'empty' }, h('strong', null, t('empty.catalog'))));
    return;
  }
  if (!produits.length) {
    R.liste.append(h('div', { class: 'empty' }, h('strong', null, t('empty')), t('empty.hint')));
    return;
  }
  const groupes = new Map();
  for (const p of produits) {
    const cle = p.provenance || '';
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(p);
  }
  for (const [cle, ps] of groupes) {
    R.liste.append(h('section', { class: 'groupe' },
      cle ? h('h2', { class: 'groupe-titre' }, C.label(S.V, 'provenances', cle)) : null,
      ps.map((p) => carte(p))));
  }
}

/* ---------- Morceaux communs ---------- */
function typeDe(p) { return p.style ? C.label(S.V, 'styles', p.style) : C.label(S.V, 'categories', p.categorie); }
function seg(n) { return h('span', { class: 'seg', 'aria-hidden': 'true' }, [1, 2, 3].map((i) => h('i', { class: i <= n ? 'on' : null }))); }
function photo(p) {
  const path = p.image || p.imageEtiquette;
  const ph = () => h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) });
  if (!path) return ph();
  const img = h('img', { src: C.imgSrc(path, S.pending), alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
  return img;
}
function jauges(p) {
  const na = NIVEAU_AMERTUME[p.amertume] || 0, nf = NIVEAU_FORCE[forceDe(p.alcool)] || 0;
  return h('div', { class: 'jauges' },
    h('span', null, t('jauge.amertume')), seg(na), h('span', { class: 'val' }, p.amertume ? t('amertume.' + p.amertume) : '—'),
    h('span', null, t('jauge.force')), seg(nf), h('span', { class: 'val' }, C.fmtAbv(p.alcool) || '—'));
}

function carte(p, raison) {
  return h('button', { class: 'carte', type: 'button', onclick: () => ouvrirFiche(p.id) },
    h('div', { class: 'carte-photo' }, photo(p)),
    h('div', { class: 'carte-texte' },
      h('div', { class: 'carte-nom' }, p.nom),
      h('div', { class: 'carte-sous' }, [p.producteur, typeDe(p)].filter(Boolean).join(' · ')),
      jauges(p),
      raison ? h('div', { class: 'carte-raison' }, raison)
        : (tx(p.notes) ? h('div', { class: 'carte-note' }, tx(p.notes)) : null)));
}

/* ---------- Mode « Par plat » ---------- */
function dessinerPlats() {
  const sections = new Map();
  for (const pl of S.plats) {
    const cle = tx(pl.section) || '';
    if (!sections.has(cle)) sections.set(cle, []);
    sections.get(cle).push(pl);
  }
  R.corps.append(h('p', { class: 'intro' }, t('plats.intro')));
  for (const [titre, plats] of sections) {
    R.corps.append(h('section', { class: 'groupe' },
      titre ? h('h2', { class: 'groupe-titre' }, titre) : null,
      plats.map(blocPlat)));
  }
}
function blocPlat(pl) {
  const ouvert = S.platOuvert === pl.id;
  const accords = (pl.accords || []).map((a) => ({ p: S.produits.find((x) => x.id === a.produit), pourquoi: tx(a.pourquoi) })).filter((a) => a.p);
  return h('div', { class: 'plat' },
    h('button', {
      class: 'plat-titre', type: 'button', 'aria-expanded': String(ouvert),
      onclick: () => { S.platOuvert = ouvert ? null : pl.id; const y = window.scrollY; C.clear(R.corps); dessinerPlats(); window.scrollTo({ top: y }); }
    }, h('span', null, tx(pl.nom)), h('span', { class: 'plat-nb' }, String(accords.length))),
    ouvert ? h('div', { class: 'plat-accords' },
      accords.length ? accords.map((a) => carte(a.p, a.pourquoi)) : h('div', { class: 'empty' }, t('plats.vide'))) : null);
}

/* ---------- Fiche ---------- */
function ouvrirFiche(id, empiler = true) {
  const p = S.all.find((x) => x.id === id);
  if (!p) { cacherFiche(); return; }
  if (empiler) {
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ detail: id, depth }, '', '#p=' + encodeURIComponent(id));
  }
  fermerMot();
  dessinerFiche(p);
  if (!R.dialog.open) R.dialog.showModal();
  R.fiche.scrollTop = 0;
}
function cacherFiche() { fermerMot(); if (R.dialog && R.dialog.open) R.dialog.close(); }
function fermerFiche() {
  const d = (history.state && history.state.depth) || 0;
  if (d > 0) history.go(-d);
  else {
    history.replaceState(null, '', location.pathname + location.search);
    cacherFiche();
  }
}
function syncDepuisHash() {
  const m = location.hash.match(/^#p=(.+)$/);
  if (m) ouvrirFiche(decodeURIComponent(m[1]), false);
  else cacherFiche();
}
window.addEventListener('popstate', syncDepuisHash);

// Trois plats au plus, sans répéter une même raison ; les conseils de la brasserie
// ou du menu passent avant les conseils généraux de style.
function platsDe(p) {
  const trouves = [];
  for (const pl of S.plats) {
    const a = (pl.accords || []).find((x) => x.produit === p.id);
    if (a) trouves.push({ nom: tx(pl.nom), pourquoi: tx(a.pourquoi), officiel: !!a.officiel });
  }
  trouves.sort((a, b) => Number(b.officiel) - Number(a.officiel));
  const vues = new Set();
  return trouves.filter((a) => !vues.has(a.pourquoi) && vues.add(a.pourquoi)).slice(0, 3);
}

// Bières proches : même type, amertume voisine, goûts en commun, % proche.
function semblables(p) {
  const goutsP = p.gouts || [];
  const sureP = goutsP.includes('acidulee'), noireP = p.famille === 'noire';
  const score = (x) => {
    let s = 0;
    if (x.famille && x.famille === p.famille) s += 4;
    if ((x.famille === 'noire') !== noireP) s -= 4;
    if ((x.gouts || []).includes('acidulee') !== sureP) s -= 3;
    if (x.amertume && p.amertume) s += Math.max(0, 2 - Math.abs(NIVEAU_AMERTUME[x.amertume] - NIVEAU_AMERTUME[p.amertume]));
    s += 2 * (x.gouts || []).filter((g) => goutsP.includes(g)).length;
    if (x.alcool != null && p.alcool != null && Math.abs(x.alcool - p.alcool) < 1) s += 1;
    return s;
  };
  const ecart = (x) => (x.alcool == null || p.alcool == null ? 99 : Math.abs(x.alcool - p.alcool));
  return S.produits.filter((x) => x.id !== p.id)
    .map((x) => [score(x), x])
    .filter((a) => a[0] > 0)
    .sort((a, b) => b[0] - a[0] || ecart(a[1]) - ecart(b[1]))
    .slice(0, 3).map((a) => a[1]);
}

function tuile(motId, titre, valeur, detail, n) {
  return h('button', { type: 'button', class: 'tuile', onclick: () => ouvrirMot(motId) },
    h('span', { class: 'et' }, titre),
    h('b', null, valeur, detail ? h('small', null, ' ' + detail) : null),
    seg(n));
}

function dessinerFiche(p) {
  C.clear(R.fiche);
  const couleur = COULEURS[p.famille] || COULEUR_DEFAUT;
  const st = p.style && S.V.styles.get(p.style);
  const desc = st ? tx(st.description) : '';
  const plats = platsDe(p);
  const semb = semblables(p);
  const fo = forceDe(p.alcool);

  const bande = h('header', { class: 'fiche-bande' + (p.famille === 'blanche' ? ' clair' : ''), style: { background: couleur } },
    h('button', { class: 'fiche-x', type: 'button', 'aria-label': t('detail.close'), html: C.UI_ICONS.close, onclick: fermerFiche }),
    h('h2', null, p.nom),
    h('div', { class: 'fiche-sous' }, [p.producteur, typeDe(p)].filter(Boolean).join(' · ')),
    h('div', { class: 'fiche-photo' }, photo(p)));

  const blocs = [
    h('div', { class: 'tuiles' },
      tuile('amertume', t('jauge.amertume'), p.amertume ? t('amertume.' + p.amertume) : '—', p.ibu != null ? `${C.fmtNum(p.ibu)} IBU` : '', NIVEAU_AMERTUME[p.amertume] || 0),
      tuile('force', t('jauge.force'), C.fmtAbv(p.alcool) || '—', fo ? t('force.' + fo) : '', NIVEAU_FORCE[fo] || 0)),
    p.disponible === false ? h('div', { class: 'indispo' }, t('detail.unavailable')) : null,
    tx(p.notes) ? h('p', { class: 'fiche-note' }, lier(tx(p.notes))) : null,
    desc ? h('div', { class: 'fiche-style' }, h('div', { class: 'et' }, t('detail.style')), h('p', null, lier(desc))) : null
  ];

  if (plats.length) {
    const raison = h('div', { class: 'raison' });
    const puces = plats.map((a, i) => h('button', {
      type: 'button', class: 'puce',
      onclick: () => choisir(i)
    }, a.nom));
    const choisir = (i) => {
      puces.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
      raison.textContent = plats[i].pourquoi;
    };
    blocs.push(h('div', { class: 'fiche-bloc' }, h('div', { class: 'et' }, t('detail.vaAvec')), h('div', { class: 'puces' }, puces), raison));
    choisir(0);
  }

  if (semb.length) {
    blocs.push(h('div', { class: 'fiche-bloc' }, h('div', { class: 'et' }, t('detail.semblables')),
      h('div', { class: 'semb' }, semb.map((x) => h('button', { type: 'button', class: 'semb-b', onclick: () => ouvrirFiche(x.id) },
        h('div', { class: 'semb-photo' }, photo(x)), h('span', null, x.nom))))));
  }
  if (p.recette) blocs.push(blocRecette(p.recette));

  R.fiche.append(bande, h('div', { class: 'fiche-corps' }, blocs));
}

function boite(k, v) { return v ? h('div', { class: 'stat-box' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)) : null; }
function paragraphes(texte) { return String(texte).split(/\n+/).filter((s) => s.trim()).map((s) => h('p', null, s)); }
function lignes(texte) { return String(texte || '').split(/\n+/).map((s) => s.trim()).filter(Boolean); }
function blocRecette(r) {
  const ingr = (r.ingredients || []).filter((i) => tx(i.nom));
  const unite = (u) => { const x = UNITES.find((y) => y.id === u); return x ? tx(x) : (u || ''); };
  const etapes = lignes(tx(r.etapes));
  return h('section', { class: 'fiche-bloc' },
    h('div', { class: 'et' }, t('detail.recipe')),
    h('div', { class: 'recipe' },
      h('div', { class: 'recipe-meta' },
        boite(t('detail.method'), r.methode ? C.label(S.V, 'methodes', r.methode) : ''),
        boite(t('detail.glass'), r.verre ? C.label(S.V, 'verres', r.verre) : ''),
        boite(t('detail.ice'), r.glace ? C.label(S.V, 'glaces', r.glace) : '')),
      ingr.length ? [h('h4', null, t('detail.ingredients')), h('ul', { class: 'ingredients' }, ingr.map((i) => {
        const qte = [i.quantite ? C.fmtNum(C.parseNum(i.quantite) ?? i.quantite, 2) || i.quantite : '', unite(i.unite)].filter(Boolean).join(' ');
        return h('li', null, h('span', { class: 'qty' }, qte), h('span', null, tx(i.nom)));
      }))] : null,
      etapes.length ? [h('h4', null, t('detail.steps')), h('ol', { class: 'steps' }, etapes.map((s) => h('li', null, s)))] : null,
      tx(r.garniture) ? [h('h4', null, t('detail.garnish')), h('p', null, tx(r.garniture))] : null,
      tx(r.notesEquipe) ? [h('h4', null, t('detail.teamNotes')), h('div', { class: 'team-note' }, paragraphes(tx(r.notesEquipe)))] : null));
}

/* ---------- Actions ---------- */
async function changerEtab(id) {
  S.etabId = id;
  C.store(ETAB_KEY, id);
  const u = new URL(location.href);
  u.searchParams.set('e', id);
  u.hash = '';
  history.replaceState(null, '', u.pathname + u.search);
  try { await chargerEtab(id); } catch (e) { console.error(e); }
  dessiner();
}

function changerLangue() {
  C.setLang(C.getLang() === 'fr' ? 'en' : 'fr');
  preparerMots();
  const ouverte = R.dialog && R.dialog.open;
  dessiner();
  if (ouverte) syncDepuisHash();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
