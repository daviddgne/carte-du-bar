// Carte pour l'équipe : boutons dans les mots du client, liste compacte, fiche.
import * as C from './core.js';
import { FORCES, forceDe, UNITES } from './i18n.js';

const { h, t, tn, tx } = C;
const ETAB_KEY = 'carte-etablissement';
const app = document.getElementById('app');

const S = {
  config: null, vocab: null, V: null,
  etabId: null, all: [], produits: [], plats: [], pending: {},
  preview: false, draft: null,
  q: '', sel: emptySel(), mode: 'gout', platOuvert: null
};
const R = {}; // références DOM

function emptySel() {
  return { gout: new Set(), famille: new Set(), force: new Set(), habitude: new Set() };
}

/* ---------- Boutons ---------- */
const OPPOSES = { 'pas-amere': 'amere', amere: 'pas-amere' };

function goutsDe(p) {
  const out = [...(p.gouts || [])];
  if (p.amertume === 'peu') out.push('pas-amere');
  if (p.amertume === 'tres') out.push('amere');
  return out;
}

const RANGEES = [
  { id: 'gout', mode: 'et', valeurs: goutsDe, ordre: () => ids('gouts'), libelle: (v) => C.label(S.V, 'gouts', v) },
  { id: 'famille', mode: 'ou', valeurs: (p) => (p.famille ? [p.famille] : []), ordre: () => ids('familles'), libelle: (v) => C.label(S.V, 'familles', v) },
  {
    id: 'force', mode: 'ou',
    valeurs: (p) => { const f = forceDe(p.alcool); return f ? [f] : []; },
    ordre: () => FORCES.map((f) => f.id), libelle: (v) => t('force.' + v)
  },
  { id: 'habitude', mode: 'ou', valeurs: (p) => p.habitudes || [], ordre: () => ids('habitudes'), libelle: (v) => C.label(S.V, 'habitudes', v) }
];
function ids(list) { return (S.vocab[list] || []).map((x) => x.id); }

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

  const sous = etabs.length > 1
    ? h('select', { class: 'etab-select inline', 'aria-label': t('etab'), onchange: (e) => changerEtab(e.target.value) },
      etabs.map((e) => h('option', { value: e.id, selected: e.id === S.etabId }, [e.nom, e.ville].filter(Boolean).join(' · '))))
    : etab && h('div', { class: 'sub' }, [etab.nom, etab.ville].filter(Boolean).join(' · '));

  app.append(h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('h1', null, nomSite), sous),
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

  R.dialog = h('dialog', { class: 'detail' });
  R.dialog.addEventListener('cancel', (e) => { e.preventDefault(); fermerFiche(); });
  R.dialog.addEventListener('click', (e) => { if (e.target === R.dialog) fermerFiche(); });
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
  R.compte.textContent = tn('results', n.length);
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
      ps.map((p) => ligne(p))));
  }
}

function infos(p) {
  const type = p.style ? C.label(S.V, 'styles', p.style) : C.label(S.V, 'categories', p.categorie);
  return [type, C.fmtAbv(p.alcool), p.amertume ? t('amertume.' + p.amertume) : ''].filter(Boolean).join(' · ');
}
function aromes(p) {
  return (p.aromes || []).map((a) => C.label(S.V, 'aromes', a)).join(', ');
}
function vignette(p) {
  const path = p.image || p.imageEtiquette;
  const ph = () => h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) });
  if (!path) return ph();
  const img = h('img', { src: C.imgSrc(path, S.pending), alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
  return img;
}
function ligne(p, raison) {
  const texteAromes = raison ? '' : aromes(p);
  return h('button', { class: 'ligne', type: 'button', onclick: () => ouvrirFiche(p.id) },
    h('div', { class: 'ligne-photo' }, vignette(p)),
    h('div', { class: 'ligne-texte' },
      h('div', { class: 'ligne-nom' }, h('strong', null, p.nom), p.producteur ? h('span', { class: 'ligne-brasserie' }, ` · ${p.producteur}`) : null),
      h('div', { class: 'ligne-infos' }, infos(p)),
      texteAromes ? h('div', { class: 'ligne-aromes' }, texteAromes) : null,
      raison ? h('div', { class: 'ligne-raison' }, raison) : null));
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
      accords.length ? accords.map((a) => ligne(a.p, a.pourquoi)) : h('div', { class: 'empty' }, t('plats.vide'))) : null);
}

/* ---------- Fiche ---------- */
function ouvrirFiche(id, empiler = true) {
  const p = S.all.find((x) => x.id === id);
  if (!p) { cacherFiche(); return; }
  if (empiler) {
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ detail: id, depth }, '', '#p=' + encodeURIComponent(id));
  }
  dessinerFiche(p);
  if (!R.dialog.open) R.dialog.showModal();
  const inner = R.dialog.querySelector('.detail-inner');
  if (inner) inner.scrollTop = 0;
}
function cacherFiche() { if (R.dialog && R.dialog.open) R.dialog.close(); }
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

function boite(k, v) { return v ? h('div', { class: 'stat-box' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)) : null; }
function paragraphes(texte) { return String(texte).split(/\n+/).filter((s) => s.trim()).map((s) => h('p', null, s)); }
function lignes(texte) { return String(texte || '').split(/\n+/).map((s) => s.trim()).filter(Boolean); }

// Trois lignes au plus, sans répéter une même raison ; les conseils de la brasserie
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

function dessinerFiche(p) {
  C.clear(R.dialog);
  const images = [
    p.image && { path: p.image, label: t('detail.photo') },
    p.imageEtiquette && { path: p.imageEtiquette, label: t('detail.label') }
  ].filter(Boolean);
  const principale = h('div', { class: 'main' });
  const pouces = [];
  const montrer = (i) => {
    C.clear(principale);
    if (!images.length) principale.append(h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) }));
    else {
      const img = h('img', { src: C.imgSrc(images[i].path, S.pending), alt: `${p.nom} — ${images[i].label}` });
      img.addEventListener('error', () => img.replaceWith(h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) })), { once: true });
      principale.append(img);
    }
    pouces.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
  };
  if (images.length > 1) {
    images.forEach((im, i) => pouces.push(h('button', { class: 'thumb', type: 'button', 'aria-label': im.label, onclick: () => montrer(i) },
      h('img', { src: C.imgSrc(im.path, S.pending), alt: '' }))));
  }

  const type = p.style ? C.label(S.V, 'styles', p.style) : C.label(S.V, 'categories', p.categorie);
  const amertume = p.amertume ? t('amertume.' + p.amertume) : '';
  const valeurAmertume = [amertume, p.ibu != null ? `${C.fmtNum(p.ibu)} IBU` : ''].filter(Boolean).join(' · ');
  const provenance = p.provenance ? C.label(S.V, 'provenances', p.provenance) : '';
  const estVin = p.categorie === 'vin';
  const plats = platsDe(p);
  const blocs = [];
  if (p.aromes && p.aromes.length) blocs.push(h('section', { class: 'section' }, h('h3', null, t('detail.aromes')), h('p', null, aromes(p))));
  if (tx(p.notes)) blocs.push(h('section', { class: 'section' }, h('h3', null, t('detail.notes')), paragraphes(tx(p.notes))));
  if (plats.length) {
    blocs.push(h('section', { class: 'section' }, h('h3', null, t('detail.plats')),
      h('ul', { class: 'accords' }, plats.map((a) => h('li', null, h('strong', null, a.nom), h('span', null, a.pourquoi))))));
  }
  if (p.recette) blocs.push(blocRecette(p.recette));

  R.dialog.append(h('div', { class: 'detail-inner' },
    h('div', { class: 'detail-top' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('detail.close'), html: C.UI_ICONS.close, onclick: fermerFiche })),
    h('div', { class: 'detail-media' }, principale, pouces.length ? h('div', { class: 'thumbs' }, pouces) : null),
    h('div', { class: 'detail-body' },
      h('h2', null, p.nom),
      (p.producteur || provenance) ? h('div', { class: 'producer' }, [p.producteur, provenance].filter(Boolean).join(' — ')) : null,
      p.disponible === false ? h('div', { class: 'unavailable' }, t('detail.unavailable')) : null,
      h('div', { class: 'stats-row' },
        boite(t('detail.type'), type),
        boite(t('detail.abv'), C.fmtAbv(p.alcool)),
        boite(t('detail.bitter'), valeurAmertume),
        estVin ? boite(t('detail.vintage'), p.millesime) : null,
        estVin ? boite(t('detail.grapes'), p.cepages) : null),
      blocs)));
  montrer(0);
}

function blocRecette(r) {
  const ingr = (r.ingredients || []).filter((i) => tx(i.nom));
  const unite = (u) => { const x = UNITES.find((y) => y.id === u); return x ? tx(x) : (u || ''); };
  const etapes = lignes(tx(r.etapes));
  return h('section', { class: 'section' },
    h('h3', null, t('detail.recipe')),
    h('div', { class: 'recipe' },
      h('div', { class: 'recipe-meta' },
        boite(t('detail.method'), r.methode ? C.label(S.V, 'methodes', r.methode) : ''),
        boite(t('detail.glass'), r.verre ? C.label(S.V, 'verres', r.verre) : ''),
        boite(t('detail.ice'), r.glace ? C.label(S.V, 'glaces', r.glace) : '')),
      ingr.length ? [
        h('h4', null, t('detail.ingredients')),
        h('ul', { class: 'ingredients' }, ingr.map((i) => {
          const qte = [i.quantite ? C.fmtNum(C.parseNum(i.quantite) ?? i.quantite, 2) || i.quantite : '', unite(i.unite)].filter(Boolean).join(' ');
          const lie = i.produitId && S.all.find((x) => x.id === i.produitId);
          return h('li', null, h('span', { class: 'qty' }, qte),
            lie ? h('button', { type: 'button', onclick: () => ouvrirFiche(lie.id) }, tx(i.nom)) : h('span', null, tx(i.nom)));
        }))
      ] : null,
      etapes.length ? [h('h4', null, t('detail.steps')), h('ol', { class: 'steps' }, etapes.map((s) => h('li', null, s)))] : null,
      tx(r.garniture) ? [h('h4', null, t('detail.garnish')), h('p', null, tx(r.garniture))] : null,
      tx(r.notesEquipe) ? [h('h4', null, t('detail.teamNotes')), h('div', { class: 'team-note' }, paragraphes(tx(r.notesEquipe)))] : null
    ));
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
  const ouverte = R.dialog && R.dialog.open;
  dessiner();
  if (ouverte) syncDepuisHash();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
