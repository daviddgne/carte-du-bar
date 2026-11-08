// Administration : établissements, catalogue, listes, publication sur GitHub.
import * as C from './core.js';
import { GitHub, ConflictError } from './github.js';
import { UNITES } from './i18n.js';

const { h } = C;
const P = C.PATHS;
const GH_KEY = 'carte-admin-github-v1';
const EDIT_KEY = 'carte-admin-edition-v1';
const root = document.getElementById('admin');

const ETAB_TYPES = [['pub', 'Pub'], ['restaurant', 'Restaurant'], ['bar', 'Bar'], ['microbrasserie', 'Microbrasserie'], ['autre', 'Autre']];
const LISTS = [
  ['styles', 'Types / styles'], ['aromes', 'Arômes dominants'], ['degustation', 'En bouche'],
  ['accords', 'Accords mets'], ['etiquettes', 'Étiquettes'], ['allergenes', 'Allergènes'],
  ['methodes', 'Méthodes (cocktails)'], ['verres', 'Verres'], ['glaces', 'Glace'], ['categories', 'Catégories']
];
const PRODUCT_LIST_FIELDS = { aromes: 'aromes', degustation: 'degustation', accords: 'accords', etiquettes: 'etiquettes', allergenes: 'allergenes' };
const PRODUCER_LABEL = {
  biere: 'Microbrasserie / brasserie', cidre: 'Cidrerie', vin: 'Domaine / producteur',
  spiritueux: 'Distillerie / marque', cocktail: 'Création de (optionnel)', 'sans-alcool': 'Producteur / marque'
};

const A = {
  config: null, vocab: null, etabs: {}, shas: {},
  pendingImages: {}, recentImages: {},
  dirty: new Set(), deleted: new Set(),
  source: 'site', ghError: '',
  etabId: null, tab: 'catalogue', editing: null,
  search: '', catFilter: '', listTab: 'aromes',
  gh: C.load(GH_KEY) || { owner: '', repo: '', branch: 'main', token: '', basePath: '' },
  publishing: false, notices: []
};
const R = {};

/* ================= Outils ================= */
const debounce = (fn, ms) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };
const lbl = (list, id) => { const it = (A.vocab[list] || []).find((x) => x.id === id); return it ? it.fr : id; };
const bi = (v) => (v && typeof v === 'object' ? { fr: v.fr || '', en: v.en || '' } : { fr: typeof v === 'string' ? v : '', en: '' });
const ghClient = () => new GitHub(A.gh || {});
const allImages = () => ({ ...A.recentImages, ...A.pendingImages, ...(A.editing ? A.editing.newImages : {}) });
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg, kind = 'info', ms = 4200) {
  if (!R.toasts) return;
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  R.toasts.append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

function defaultConfig() { return { site: { nom: { fr: 'Carte du bar', en: 'Bar menu' } }, etablissements: [] }; }

function blankProduct(cat = 'biere') {
  return {
    id: C.uid('p'), nom: '', categorie: cat, style: '', producteur: '', origine: '',
    alcool: null, ibu: null, format: '', prix: null,
    aromes: [], degustation: [], accords: [], etiquettes: [],
    notes: { fr: '', en: '' }, accordsNotes: { fr: '', en: '' },
    coupDeCoeur: false, disponible: true,
    regimes: { sansGluten: null, vegetarien: null, vegan: null },
    allergenes: [], image: '', imageEtiquette: ''
  };
}
function blankRecipe() {
  return {
    methode: '', verre: '', glace: '',
    ingredients: [{ quantite: '', unite: 'ml', nom: { fr: '', en: '' }, produitId: '' }],
    etapes: { fr: '', en: '' }, garniture: { fr: '', en: '' }, notesEquipe: { fr: '', en: '' }
  };
}
function normalizeProduct(src) {
  const p = { ...blankProduct(src.categorie), ...structuredClone(src) };
  for (const k of ['aromes', 'degustation', 'accords', 'etiquettes', 'allergenes']) if (!Array.isArray(p[k])) p[k] = [];
  p.notes = bi(p.notes); p.accordsNotes = bi(p.accordsNotes);
  p.regimes = { sansGluten: null, vegetarien: null, vegan: null, ...(p.regimes || {}) };
  if (p.categorie === 'cocktail') ensureRecipe(p);
  return p;
}
function ensureRecipe(p) {
  const r = { ...blankRecipe(), ...(p.recette || {}) };
  r.etapes = bi(r.etapes); r.garniture = bi(r.garniture); r.notesEquipe = bi(r.notesEquipe);
  r.ingredients = (r.ingredients || []).map((i) => ({ quantite: i.quantite || '', unite: i.unite || 'ml', nom: bi(i.nom), produitId: i.produitId || '' }));
  if (!r.ingredients.length) r.ingredients = blankRecipe().ingredients;
  p.recette = r;
}

/* ================= Brouillon ================= */
function saveDraft() {
  const ok = C.store(C.DRAFT_KEY, {
    v: 1, savedAt: Date.now(), source: A.source,
    config: A.config, vocab: A.vocab, etabs: A.etabs, shas: A.shas,
    pendingImages: A.pendingImages, dirty: [...A.dirty], deleted: [...A.deleted]
  });
  if (!ok) toast('Le brouillon est trop lourd pour être gardé dans ce navigateur (trop de photos en attente). Publiez dès que possible.', 'warn', 7000);
}
const saveDraftSoon = debounce(saveDraft, 250);

function markDirty(path) {
  A.dirty.add(path);
  saveDraftSoon();
  updatePublishBar();
}
const saveEditSnapshot = debounce(() => {
  if (!A.editing) { C.store(EDIT_KEY, undefined); return; }
  C.store(EDIT_KEY, { etabId: A.etabId, ...A.editing });
}, 400);
function markEdit() { if (A.editing) { A.editing.changed = true; saveEditSnapshot(); } }

/* ================= Chargement ================= */
async function init() {
  const draft = C.readDraft();
  try {
    if (draft && Array.isArray(draft.dirty) && draft.dirty.length && draft.config && draft.vocab) {
      Object.assign(A, {
        config: draft.config, vocab: draft.vocab, etabs: draft.etabs || {}, shas: draft.shas || {},
        pendingImages: draft.pendingImages || {}, dirty: new Set(draft.dirty), deleted: new Set(draft.deleted || []),
        source: draft.source || 'site'
      });
      A.notices.push(`Brouillon non publié restauré : ${A.dirty.size} fichier(s) modifié(s) en attente de publication.`);
      await ensureEtabsLoaded();
    } else {
      await loadFromSource();
    }
  } catch (e) {
    console.error(e);
    C.clear(root).append(h('div', { class: 'error-box' },
      h('p', null, 'Impossible de charger les données : ' + e.message),
      h('button', { class: 'btn-primary', type: 'button', onclick: () => location.reload() }, 'Réessayer')));
    return;
  }
  const etabs = A.config.etablissements || [];
  const saved = C.load('carte-admin-etab', false);
  A.etabId = (etabs.find((e) => e.id === saved) || etabs[0] || {}).id || null;

  const snap = C.load(EDIT_KEY);
  if (snap && snap.p && A.etabs[snap.etabId]) {
    A.etabId = snap.etabId;
    A.editing = { p: snap.p, isNew: !!snap.isNew, newImages: snap.newImages || {}, removed: snap.removed || [], changed: true };
    A.notices.push('Une fiche en cours de modification a été restaurée.');
  }
  render();
}

async function loadFromSource() {
  const gh = ghClient();
  A.etabs = {}; A.shas = {}; A.pendingImages = {}; A.dirty = new Set(); A.deleted = new Set(); A.ghError = '';
  if (gh.ready) {
    try {
      const [cfg, voc] = await Promise.all([gh.readJSON(P.config), gh.readJSON(P.vocab)]);
      A.config = cfg ? cfg.data : defaultConfig();
      A.shas[P.config] = cfg ? cfg.sha : null;
      A.vocab = voc ? voc.data : await C.loadJSON(P.vocab);
      A.shas[P.vocab] = voc ? voc.sha : null;
      A.source = 'github';
      await ensureEtabsLoaded();
      return;
    } catch (e) {
      console.error(e);
      A.ghError = e.message;
      A.notices.push(`Lecture GitHub impossible (${e.message}). Données du site affichées à la place.`);
      A.etabs = {}; A.shas = {};
    }
  }
  A.source = 'site';
  A.config = await C.loadJSON(P.config).catch(() => defaultConfig());
  A.vocab = await C.loadJSON(P.vocab);
  await ensureEtabsLoaded();
}

async function ensureEtabsLoaded() {
  const gh = ghClient();
  for (const e of A.config.etablissements || []) {
    if (A.etabs[e.id]) continue;
    const path = P.etab(e.id);
    if (A.source === 'github' && gh.ready) {
      const r = await gh.readJSON(path);
      A.etabs[e.id] = r ? r.data : { produits: [] };
      A.shas[path] = r ? r.sha : null;
    } else {
      try { A.etabs[e.id] = await C.loadJSON(path); } catch { A.etabs[e.id] = { produits: [] }; }
    }
    if (!Array.isArray(A.etabs[e.id].produits)) A.etabs[e.id].produits = [];
  }
}

/* ================= Rendu général ================= */
function render() {
  C.clear(root);
  document.body.classList.toggle('editing', !!A.editing);
  const etabs = A.config.etablissements || [];
  root.append(h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('h1', null, 'Administration'),
      etabs.length ? h('select', { class: 'etab-select inline', 'aria-label': 'Établissement', onchange: (e) => switchEtab(e.target.value, e.target) },
        etabs.map((e) => h('option', { value: e.id, selected: e.id === A.etabId }, e.nom))) : h('div', { class: 'sub' }, 'Aucun établissement')),
    h('a',{ class: 'btn-lang', href: `index.html${A.etabId ? '?e=' + encodeURIComponent(A.etabId) : ''}`, target: '_blank', rel: 'noopener' }, 'Voir le site')
  ));

  if (!A.editing) {
    root.append(h('nav', { class: 'tabs', 'aria-label': 'Sections' },
      [['catalogue', 'Catalogue'], ['etablissements', 'Établissements'], ['listes', 'Listes'], ['parametres', 'Paramètres']]
        .map(([id, l]) => h('button', { type: 'button', class: 'tab', 'aria-current': A.tab === id ? 'page' : null, onclick: () => setTab(id) }, l))));
  }

  for (const n of A.notices) {
    const el = h('div', { class: 'notice' }, h('span', null, n),
      h('button', { type: 'button', class: 'link-btn', onclick: () => { A.notices = A.notices.filter((x) => x !== n); el.remove(); } }, 'OK'));
    root.append(el);
  }

  const view = h('main', { class: 'admin-main' });
  root.append(view);
  if (A.editing) view.append(viewEditor());
  else if (A.tab === 'catalogue') view.append(viewCatalogue());
  else if (A.tab === 'etablissements') view.append(viewEtabs());
  else if (A.tab === 'listes') view.append(viewLists());
  else view.append(viewSettings());

  if (!A.editing) {
    R.pub = h('div', { class: 'publish-bar' });
    root.append(R.pub);
    updatePublishBar();
  } else R.pub = null;

  R.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  root.append(R.toasts);
}

function setTab(id) {
  A.tab = id;
  render();
  window.scrollTo({ top: 0 });
}

function switchEtab(id, selectEl) {
  if (A.editing && A.editing.changed && !confirm('Abandonner les modifications de la fiche en cours ?')) {
    if (selectEl) selectEl.value = A.etabId;
    return;
  }
  closeEditor();
  A.etabId = id;
  C.store('carte-admin-etab', id);
  render();
}

function updatePublishBar() {
  if (!R.pub) return;
  C.clear(R.pub);
  const n = A.dirty.size;
  const has = n > 0 || A.deleted.size > 0;
  const gh = ghClient();
  R.pub.append(
    h('div', { class: 'pub-status' },
      h('strong', null, has ? `${n || 1} fichier(s) à publier` : 'Tout est publié'),
      h('span', null, gh.ready ? `GitHub : ${gh.owner}/${gh.repo}` : 'GitHub pas encore relié')),
    h('button', { type: 'button', class: 'btn-ghost', onclick: openPreview }, 'Aperçu'),
    h('button', { type: 'button', class: 'btn-primary', disabled: !has || A.publishing, onclick: publish }, A.publishing ? 'Publication…' : 'Publier')
  );
}

function openPreview() {
  saveDraft();
  window.open(`index.html?apercu&e=${encodeURIComponent(A.etabId || '')}`, '_blank', 'noopener');
}

/* ================= Publication ================= */
function referencedImages() {
  const set = new Set();
  for (const d of Object.values(A.etabs)) for (const p of d.produits || []) {
    if (p.image) set.add(p.image);
    if (p.imageEtiquette) set.add(p.imageEtiquette);
  }
  return set;
}
function dataFor(path) {
  if (path === P.config) return A.config;
  if (path === P.vocab) return A.vocab;
  const m = path.match(/^data\/etablissements\/(.+)\.json$/);
  return m ? (A.etabs[m[1]] || { produits: [] }) : null;
}

async function publish() {
  const gh = ghClient();
  if (!gh.ready) {
    toast('Reliez d’abord votre dépôt GitHub dans Paramètres.', 'warn');
    setTab('parametres');
    return;
  }
  A.publishing = true;
  updatePublishBar();
  try {
    const referenced = referencedImages();
    const files = [];
    for (const path of A.dirty) {
      const data = dataFor(path);
      if (data) files.push({ path, text: JSON.stringify(data, null, 2) + '\n' });
    }
    for (const [path, url] of Object.entries(A.pendingImages)) {
      if (referenced.has(path)) files.push({ path, base64: url.slice(url.indexOf(',') + 1) });
    }
    const deletes = [...A.deleted].filter((p) => !referenced.has(p) && !A.dirty.has(p));
    const expect = {};
    if (A.source === 'github') for (const path of A.dirty) if (path in A.shas) expect[path] = A.shas[path];
    const message = `Admin : mise à jour du catalogue (${files.length} fichier(s)${deletes.length ? `, ${deletes.length} suppression(s)` : ''})`;

    let res;
    try {
      res = await gh.commit({ files, deletes, message, expect });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      const ok = confirm(`Ces fichiers ont été modifiés ailleurs depuis leur chargement :\n${e.paths.join('\n')}\n\nÉcraser avec votre version ?`);
      if (!ok) { toast('Publication annulée. Rien n’a été modifié.', 'warn'); return; }
      res = await gh.commit({ files, deletes, message, expect, force: true });
    }
    for (const [p, sha] of Object.entries(res.newShas)) A.shas[p] = sha;
    Object.assign(A.recentImages, A.pendingImages);
    A.pendingImages = {};
    A.dirty.clear();
    A.deleted.clear();
    A.source = 'github';
    saveDraft();
    toast('Publié ! Le site public sera à jour d’ici une à deux minutes.', 'ok', 6000);
  } catch (e) {
    console.error(e);
    toast('Échec de la publication : ' + e.message, 'error', 8000);
  } finally {
    A.publishing = false;
    updatePublishBar();
  }
}

/* ================= Catalogue ================= */
function thumb(p) {
  const path = p.image || p.imageEtiquette;
  const ph = () => h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) });
  if (!path) return ph();
  const img = h('img', { src: C.imgSrc(path, allImages()), alt: '', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
  return img;
}

function viewCatalogue() {
  if (!A.etabId) {
    return h('div', { class: 'empty' }, h('strong', null, 'Aucun établissement.'), 'Créez-en un pour commencer.',
      h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn-primary', type: 'button', onclick: () => setTab('etablissements') }, 'Créer un établissement')));
  }
  const listEl = h('div', { class: 'rows' });
  const draw = () => {
    C.clear(listEl);
    const q = C.normalize(A.search).trim();
    const prods = (A.etabs[A.etabId].produits || [])
      .filter((p) => !A.catFilter || p.categorie === A.catFilter)
      .filter((p) => !q || C.normalize(`${p.nom} ${p.producteur} ${lbl('styles', p.style)}`).includes(q))
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr-CA', { sensitivity: 'base' }));
    if (!prods.length) {
      listEl.append(h('div', { class: 'empty' }, h('strong', null, A.search || A.catFilter ? 'Aucun produit trouvé.' : 'Catalogue vide.'), 'Ajoutez votre premier produit avec « Nouveau produit ».'));
      return;
    }
    for (const p of prods) {
      listEl.append(h('button', { class: 'row', type: 'button', onclick: () => openEditor(p.id) },
        h('div', { class: 'row-thumb' }, thumb(p)),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, p.nom || '(sans nom)', p.coupDeCoeur ? h('span', { class: 'row-heart', html: C.UI_ICONS.heart, title: 'Coup de cœur' }) : null),
          h('div', { class: 'row-sub' }, [lbl('categories', p.categorie), p.style && lbl('styles', p.style), p.producteur].filter(Boolean).join(' · '))),
        h('div', { class: 'row-tags' },
          p.alcool != null ? h('span', { class: 'stat' }, C.fmtAbv(p.alcool)) : null,
          p.ibu != null ? h('span', { class: 'stat' }, `${p.ibu} IBU`) : null,
          p.disponible === false ? h('span', { class: 'stat off' }, 'Masqué') : null)
      ));
    }
  };
  draw();
  const count = (A.etabs[A.etabId].produits || []).length;
  return h('div', null,
    h('div', { class: 'admin-toolbar' },
      h('input', { type: 'search', class: 'input', placeholder: `Rechercher parmi ${count} produit(s)…`, value: A.search, 'aria-label': 'Rechercher', oninput: (e) => { A.search = e.target.value; draw(); } }),
      selectEl([['', 'Toutes catégories'], ...(A.vocab.categories || []).map((c) => [c.id, c.fr])], A.catFilter, (v) => { A.catFilter = v; draw(); }, { class: 'input', 'aria-label': 'Catégorie' }),
      h('button', { class: 'btn-primary', type: 'button', onclick: () => openEditor(null) }, '+ Nouveau produit')),
    listEl);
}

/* ================= Éditeur de fiche ================= */
function openEditor(id) {
  const prods = A.etabs[A.etabId].produits;
  const src = id ? prods.find((p) => p.id === id) : blankProduct(A.catFilter || 'biere');
  if (!src) return;
  A.editing = { p: normalizeProduct(src), isNew: !id, newImages: {}, removed: [], changed: false };
  render();
  window.scrollTo({ top: 0 });
}
function closeEditor() {
  A.editing = null;
  C.store(EDIT_KEY, undefined);
}
function cancelEditor() {
  if (A.editing && A.editing.changed && !confirm('Abandonner les modifications de cette fiche ?')) return;
  closeEditor();
  render();
}

function saveEditor() {
  const ed = A.editing;
  const p = ed.p;
  p.nom = (p.nom || '').trim();
  if (!p.nom) { toast('Le nom est obligatoire.', 'error'); R.nameInput && R.nameInput.focus(); return; }
  if (p.categorie !== 'cocktail') delete p.recette;
  else if (p.recette) p.recette.ingredients = p.recette.ingredients.filter((i) => i.nom.fr.trim() || i.nom.en.trim() || i.quantite);
  if (p.categorie !== 'vin') { delete p.prixVerre; delete p.cepages; delete p.millesime; }
  p.maj = today();

  const prods = A.etabs[A.etabId].produits;
  const i = prods.findIndex((x) => x.id === p.id);
  if (i >= 0) prods[i] = p; else prods.push(p);

  Object.assign(A.pendingImages, ed.newImages);
  for (const old of ed.removed) {
    if (A.pendingImages[old]) delete A.pendingImages[old];
    else A.deleted.add(old);
  }
  closeEditor();
  markDirty(P.etab(A.etabId));
  saveDraft();
  render();
  toast(`« ${p.nom} » enregistré. Pensez à publier.`, 'ok');
}

function deleteProduct() {
  const ed = A.editing;
  if (ed.isNew) { cancelEditor(); return; }
  if (!confirm(`Supprimer « ${ed.p.nom} » du catalogue ? (Retirée du site à la prochaine publication.)`)) return;
  const prods = A.etabs[A.etabId].produits;
  const orig = prods.find((x) => x.id === ed.p.id);
  A.etabs[A.etabId].produits = prods.filter((x) => x.id !== ed.p.id);
  for (const path of [orig && orig.image, orig && orig.imageEtiquette].filter(Boolean)) {
    if (A.pendingImages[path]) delete A.pendingImages[path]; else A.deleted.add(path);
  }
  closeEditor();
  markDirty(P.etab(A.etabId));
  render();
  toast('Produit supprimé.', 'ok');
}

function duplicateProduct() {
  const ed = A.editing;
  if (ed.changed && !confirm('La fiche actuelle n’est pas enregistrée. Dupliquer quand même (les modifications seront reprises dans la copie) ?')) return;
  const copy = structuredClone(ed.p);
  copy.id = C.uid('p');
  copy.nom = `${copy.nom} (copie)`;
  A.editing = { p: copy, isNew: true, newImages: { ...ed.newImages }, removed: [], changed: true };
  render();
  toast('Copie créée : modifiez-la puis enregistrez.', 'info');
}

function viewEditor() {
  const ed = A.editing;
  const p = ed.p;
  const wrap = h('div', { class: 'editor' });
  const rerender = () => { const y = window.scrollY; C.clear(root.querySelector('.admin-main')).append(viewEditor()); window.scrollTo({ top: y }); };

  R.nameInput = txt(p, 'nom', { placeholder: 'Ex. : IPA du Nord', required: true });
  const catOptions = (A.vocab.categories || []).map((c) => [c.id, c.fr]);
  const styles = (A.vocab.styles || []).filter((s) => !s.categorie || s.categorie === p.categorie);

  wrap.append(h('div', { class: 'editor-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour au catalogue', html: C.UI_ICONS.back, onclick: cancelEditor }),
    h('h2', null, ed.isNew ? 'Nouveau produit' : (p.nom || 'Fiche produit')),
    h('button', { type: 'button', class: 'btn-ai', disabled: true, title: 'Bientôt : remplira la fiche à partir du nom et du producteur.' }, '✨ Pré-remplir avec l’IA (bientôt)')
  ));

  // 1. Identité
  wrap.append(card('Identité',
    field('Nom *', R.nameInput),
    h('div', { class: 'grid2' },
      field('Catégorie', selectEl(catOptions, p.categorie, (v) => {
        p.categorie = v;
        if (p.style && !(A.vocab.styles || []).some((s) => s.id === p.style && (!s.categorie || s.categorie === v))) p.style = '';
        if (v === 'cocktail') ensureRecipe(p);
        markEdit(); rerender();
      })),
      fieldDiv('Type / style',
        selectEl([['', '— Aucun —'], ...styles.map((s) => [s.id, s.fr])], p.style, (v) => { p.style = v; markEdit(); }),
        addInline('styles', 'Nouveau style…', (id) => { p.style = id; markEdit(); rerender(); }, { categorie: p.categorie }))),
    h('div', { class: 'grid2' },
      field(PRODUCER_LABEL[p.categorie] || 'Producteur', txt(p, 'producteur')),
      field('Origine', txt(p, 'origine', { placeholder: 'Ex. : Québec, QC' }))),
    p.categorie === 'vin' ? h('div', { class: 'grid2' },
      field('Cépages', txt(p, 'cepages', { placeholder: 'Ex. : Syrah, grenache' })),
      field('Millésime', txt(p, 'millesime', { placeholder: 'Ex. : 2023', inputmode: 'numeric' }))) : null,
    h('div', { class: p.categorie === 'vin' ? 'grid3' : 'grid2' },
      field('Format', txt(p, 'format', { placeholder: p.categorie === 'vin' ? 'Verre 6 oz / bouteille 750 ml' : 'Ex. : Pinte 20 oz' })),
      p.categorie === 'vin' ? field('Prix au verre ($)', num(p, 'prixVerre', { placeholder: '0,00' })) : null,
      field(p.categorie === 'vin' ? 'Prix bouteille ($)' : 'Prix ($)', num(p, 'prix', { placeholder: '0,00' })))
  ));

  // 2. Caractéristiques
  wrap.append(card('Caractéristiques',
    h('div', { class: 'grid2' },
      field('Alcool (%)', num(p, 'alcool', { placeholder: 'Ex. : 6,5' })),
      field('IBU (amertume)', num(p, 'ibu', { placeholder: p.categorie === 'biere' ? 'Ex. : 45' : 'Surtout pour la bière' }))),
    h('div', { class: 'toggles' },
      toggle('Coup de cœur', p.coupDeCoeur, (v) => { p.coupDeCoeur = v; markEdit(); }),
      toggle('Visible sur le site', p.disponible !== false, (v) => { p.disponible = v; markEdit(); }))
  ));

  // 3. Profil organoleptique
  wrap.append(card('Profil de dégustation',
    fieldDiv('Arômes dominants', picker('aromes', p, 'aromes')),
    fieldDiv('En bouche', picker('degustation', p, 'degustation')),
    biField('Notes de dégustation', p, 'notes', { multiline: true, rows: 4 })
  ));

  // 4. Recette (cocktails)
  if (p.categorie === 'cocktail') wrap.append(recipeCard(p, rerender));

  // 5. Accords
  wrap.append(card('Accords mets',
    fieldDiv('Plats', picker('accords', p, 'accords')),
    biField('Commentaire sur les accords', p, 'accordsNotes', { multiline: true, rows: 2 })
  ));

  // 6. Régimes & allergènes
  wrap.append(card('Régimes & allergènes',
    h('div', { class: 'tri-grid' },
      triField('Sans gluten', p.regimes, 'sansGluten'),
      triField('Végétarien', p.regimes, 'vegetarien'),
      triField('Vegan', p.regimes, 'vegan', (v) => { if (v === true) p.regimes.vegetarien = true; rerender(); })),
    fieldDiv('Allergènes présents', picker('allergenes', p, 'allergenes'))
  ));

  // 7. Étiquettes
  wrap.append(card('Étiquettes', picker('etiquettes', p, 'etiquettes')));

  // 8. Images
  wrap.append(card('Images',
    h('div', { class: 'grid2' }, imageSlot(p, 'image', 'Photo du produit', rerender), imageSlot(p, 'imageEtiquette', 'Étiquette', rerender))));

  if (!ed.isNew) {
    wrap.append(h('div', { class: 'editor-extra' },
      h('button', { type: 'button', class: 'btn-ghost sm', onclick: duplicateProduct }, 'Dupliquer cette fiche'),
      h('button', { type: 'button', class: 'btn-danger sm', onclick: deleteProduct }, 'Supprimer ce produit')));
  }
  wrap.append(h('div', { class: 'editor-actions' },
    h('button', { type: 'button', class: 'btn-ghost', onclick: cancelEditor }, 'Annuler'),
    h('button', { type: 'button', class: 'btn-primary', onclick: saveEditor }, 'Enregistrer')
  ));
  return wrap;
}

function recipeCard(p, rerender) {
  const r = p.recette;
  const mk = (list) => [['', '—'], ...(A.vocab[list] || []).map((x) => [x.id, x.fr])];
  const prods = (A.etabs[A.etabId].produits || []).filter((x) => x.categorie !== 'cocktail' && x.id !== p.id);
  const dlId = 'dl-produits';
  const list = h('div', { class: 'ingr-list' });
  const draw = () => {
    C.clear(list);
    r.ingredients.forEach((ing, idx) => {
      const linked = prods.find((x) => x.id === ing.produitId);
      const nameFr = h('input', {
        class: 'input', type: 'text', value: ing.nom.fr, placeholder: 'Ingrédient (FR)', list: dlId, 'aria-label': 'Ingrédient en français',
        oninput: (e) => {
          ing.nom.fr = e.target.value;
          const m = prods.find((x) => x.nom.toLowerCase() === e.target.value.trim().toLowerCase());
          ing.produitId = m ? m.id : '';
          linkBadge.hidden = !m;
          markEdit();
        }
      });
      const linkBadge = h('span', { class: 'link-badge', hidden: !linked, title: 'Lié à un produit de l’inventaire' }, 'lié');
      list.append(h('div', { class: 'ingr-row' },
        h('input', { class: 'input qty', type: 'text', inputmode: 'decimal', value: ing.quantite, placeholder: 'Qté', 'aria-label': 'Quantité', oninput: (e) => { ing.quantite = e.target.value; markEdit(); } }),
        selectEl(UNITES.map((u) => [u.id, u.fr]), ing.unite, (v) => { ing.unite = v; markEdit(); }, { class: 'input unit', 'aria-label': 'Unité' }),
        h('div', { class: 'ingr-names' },
          h('div', { class: 'ingr-fr' }, nameFr, linkBadge),
          h('input', { class: 'input small', type: 'text', value: ing.nom.en, placeholder: 'English (optional)', 'aria-label': 'Ingrédient en anglais', oninput: (e) => { ing.nom.en = e.target.value; markEdit(); } })),
        h('div', { class: 'ingr-btns' },
          idx > 0 ? h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Monter', onclick: () => { r.ingredients.splice(idx - 1, 0, r.ingredients.splice(idx, 1)[0]); markEdit(); draw(); } }, '↑') : null,
          h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Retirer', html: C.UI_ICONS.close, onclick: () => { r.ingredients.splice(idx, 1); markEdit(); draw(); } }))
      ));
    });
    list.append(h('button', { type: 'button', class: 'btn-ghost sm', onclick: () => { r.ingredients.push({ quantite: '', unite: 'ml', nom: { fr: '', en: '' }, produitId: '' }); markEdit(); draw(); } }, '+ Ingrédient'));
  };
  draw();
  return card('Recette (pour l’équipe)',
    h('div', { class: 'grid3' },
      fieldDiv('Méthode', selectEl(mk('methodes'), r.methode, (v) => { r.methode = v; markEdit(); })),
      fieldDiv('Verre', selectEl(mk('verres'), r.verre, (v) => { r.verre = v; markEdit(); })),
      fieldDiv('Glace', selectEl(mk('glaces'), r.glace, (v) => { r.glace = v; markEdit(); }))),
    fieldDiv('Ingrédients et dosages', list,
      h('datalist', { id: dlId }, prods.map((x) => h('option', { value: x.nom }))),
      h('span', { class: 'hint' }, 'Astuce : tapez le nom exact d’un produit du catalogue pour le lier à sa fiche.')),
    biField('Étapes de préparation (une par ligne)', r, 'etapes', { multiline: true, rows: 5 }),
    biField('Décoration du verre', r, 'garniture', { multiline: true, rows: 2 }),
    biField('Notes pour l’équipe', r, 'notesEquipe', { multiline: true, rows: 2 })
  );
}

/* ---------- Composants de formulaire ---------- */
function card(title, ...children) {
  return h('section', { class: 'form-card' }, h('h3', null, title), children);
}
function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}
function fieldDiv(label, ...controls) {
  return h('div', { class: 'field' }, h('span', { class: 'label' }, label), controls);
}
function txt(obj, key, attrs = {}) {
  return h('input', { class: 'input', type: 'text', value: obj[key] || '', ...attrs, oninput: (e) => { obj[key] = e.target.value; markEdit(); } });
}
function num(obj, key, attrs = {}) {
  return h('input', {
    class: 'input', type: 'text', inputmode: 'decimal', ...attrs,
    value: obj[key] == null ? '' : String(obj[key]).replace('.', ','),
    oninput: (e) => {
      const raw = e.target.value.trim();
      const v = C.parseNum(raw);
      const bad = raw !== '' && v == null;
      e.target.classList.toggle('invalid', bad);
      if (!bad) { obj[key] = v; markEdit(); }
    }
  });
}
function selectEl(options, value, onchange, attrs = { class: 'input' }) {
  const s = h('select', { ...attrs, onchange: (e) => onchange(e.target.value) },
    options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value || '';
  if (s.value !== (value || '') && value) { s.append(h('option', { value }, value)); s.value = value; }
  if (s.selectedIndex === -1 && s.options.length) s.selectedIndex = 0;
  return s;
}
function biField(label, obj, key, { multiline = false, rows = 3, onChange = markEdit } = {}) {
  obj[key] = bi(obj[key]);
  const mk = (lng) => h(multiline ? 'textarea' : 'input', {
    class: 'input', rows: multiline ? rows : null, type: multiline ? null : 'text',
    value: obj[key][lng], 'aria-label': `${label} (${lng.toUpperCase()})`,
    placeholder: lng === 'en' ? 'English (optional)' : '',
    oninput: (e) => { obj[key][lng] = e.target.value; onChange(); }
  });
  return h('div', { class: 'field' }, h('span', { class: 'label' }, label),
    h('div', { class: 'bi' }, h('span', { class: 'lang-tag' }, 'FR'), mk('fr')),
    h('div', { class: 'bi' }, h('span', { class: 'lang-tag en' }, 'EN'), mk('en')));
}
function toggle(label, value, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', null, label));
}
function triField(label, obj, key, after) {
  const wrap = h('div', { class: 'tri' }, h('span', { class: 'label' }, label));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const opts = [[true, 'Oui'], [false, 'Non'], [null, '?']];
  const draw = () => {
    C.clear(seg);
    for (const [v, l] of opts) {
      seg.append(h('button', {
        type: 'button', 'aria-pressed': String(obj[key] === v), title: v === null ? 'Non précisé' : null,
        onclick: () => { obj[key] = v; markEdit(); draw(); if (after) after(v); }
      }, l));
    }
  };
  draw();
  wrap.append(seg);
  return wrap;
}

function uniqueVocabId(list, base) {
  const ids = new Set((A.vocab[list] || []).map((x) => x.id));
  let id = base, i = 2;
  while (ids.has(id)) id = `${base}-${i++}`;
  return id;
}
// Ajout rapide d'une entrée dans une liste contrôlée.
function addInline(list, placeholder, onAdded, extra = {}) {
  const input = h('input', { class: 'input small', type: 'text', placeholder, 'aria-label': placeholder });
  const add = () => {
    const fr = input.value.trim();
    if (!fr) return;
    const items = A.vocab[list] || (A.vocab[list] = []);
    const existing = items.find((x) => C.normalize(x.fr) === C.normalize(fr) && (!extra.categorie || !x.categorie || x.categorie === extra.categorie));
    let id;
    if (existing) id = existing.id;
    else {
      id = uniqueVocabId(list, C.slugify(fr));
      items.push({ id, fr, en: '', ...extra });
      markDirty(P.vocab);
      toast(`« ${fr} » ajouté à la liste. Traduction anglaise modifiable dans l’onglet Listes.`, 'info');
    }
    input.value = '';
    onAdded(id);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return h('div', { class: 'add-inline' }, input, h('button', { type: 'button', class: 'btn-ghost sm', onclick: add }, 'Ajouter'));
}
function picker(list, obj, key) {
  const wrap = h('div', { class: 'picker' });
  const draw = () => {
    C.clear(wrap);
    const items = A.vocab[list] || [];
    const sel = obj[key];
    const extra = sel.filter((id) => !items.some((it) => it.id === id));
    wrap.append(h('div', { class: 'chips' },
      [...items.map((it) => [it.id, it.fr]), ...extra.map((id) => [id, id])].map(([id, l]) =>
        h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(sel.includes(id)),
          onclick: () => {
            const i = sel.indexOf(id);
            if (i >= 0) sel.splice(i, 1); else sel.push(id);
            markEdit(); draw();
          }
        }, l))));
    wrap.append(addInline(list, 'Autre… (ajouter à la liste)', (id) => { if (!sel.includes(id)) sel.push(id); markEdit(); draw(); }));
  };
  draw();
  return wrap;
}

/* ---------- Images ---------- */
async function resizeImage(file, max = 1400, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image illisible')); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), hgt = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    return canvas.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}
function imageSlot(p, key, label, rerender) {
  const ed = A.editing;
  const path = p[key];
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const dataUrl = await resizeImage(f);
      const newPath = `images/${A.etabId}/${C.slugify(p.nom || p.id)}-${key === 'image' ? 'photo' : 'etiquette'}-${Date.now().toString(36)}.jpg`;
      if (p[key]) removeImage(p, key);
      ed.newImages[newPath] = dataUrl;
      p[key] = newPath;
      markEdit();
      rerender();
    } catch (e) { toast(e.message, 'error'); }
  });
  return h('div', { class: 'img-slot' },
    h('span', { class: 'label' }, label),
    h('div', { class: 'img-box' }, path ? h('img', { src: C.imgSrc(path, allImages()), alt: label }) : h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) })),
    h('div', { class: 'img-btns' },
      h('button', { type: 'button', class: 'btn-ghost sm', onclick: () => fileInput.click() }, path ? 'Remplacer' : 'Choisir / photographier'),
      path ? h('button', { type: 'button', class: 'btn-ghost sm', onclick: () => { removeImage(p, key); p[key] = ''; markEdit(); rerender(); } }, 'Retirer') : null),
    fileInput);
}
function removeImage(p, key) {
  const ed = A.editing;
  const old = p[key];
  if (!old) return;
  if (ed.newImages[old]) delete ed.newImages[old];
  else ed.removed.push(old);
}

/* ================= Établissements ================= */
function viewEtabs() {
  const cfg = A.config;
  cfg.site = cfg.site || { nom: { fr: '', en: '' } };
  const list = h('div', { class: 'etab-list' });
  for (const e of cfg.etablissements || []) {
    const n = (A.etabs[e.id] && A.etabs[e.id].produits.length) || 0;
    list.append(h('section', { class: 'form-card' },
      h('div', { class: 'grid3' },
        field('Nom', h('input', { class: 'input', type: 'text', value: e.nom, oninput: (ev) => { e.nom = ev.target.value; markDirty(P.config); } })),
        fieldDiv('Type', selectEl(ETAB_TYPES, e.type, (v) => { e.type = v; markDirty(P.config); })),
        field('Ville', h('input', { class: 'input', type: 'text', value: e.ville || '', oninput: (ev) => { e.ville = ev.target.value; markDirty(P.config); } }))),
      h('div', { class: 'etab-foot' },
        h('span', { class: 'muted' }, `${n} produit(s) · identifiant : ${e.id}`),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn-ghost sm', onclick: () => { A.etabId = e.id; C.store('carte-admin-etab', e.id); setTab('catalogue'); } }, 'Ouvrir le catalogue'),
        h('button', { type: 'button', class: 'btn-danger sm', onclick: () => deleteEtab(e) }, 'Supprimer'))
    ));
  }
  const newName = h('input', { class: 'input', type: 'text', placeholder: 'Nom du nouvel établissement' });
  const newType = selectEl(ETAB_TYPES, 'pub', () => {});
  const add = () => {
    const nom = newName.value.trim();
    if (!nom) { newName.focus(); return; }
    const ids = new Set((cfg.etablissements || []).map((x) => x.id));
    let id = C.slugify(nom), i = 2;
    while (ids.has(id)) id = `${C.slugify(nom)}-${i++}`;
    (cfg.etablissements = cfg.etablissements || []).push({ id, nom, type: newType.value, ville: '' });
    A.etabs[id] = { produits: [] };
    A.deleted.delete(P.etab(id));
    markDirty(P.config);
    markDirty(P.etab(id));
    if (!A.etabId) A.etabId = id;
    render();
    toast(`Établissement « ${nom} » créé.`, 'ok');
  };
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('div', null,
    h('section', { class: 'form-card' }, h('h3', null, 'Nom du site'),
      biField('Titre affiché en haut de la carte', cfg.site, 'nom', { onChange: () => markDirty(P.config) }),
      h('span', { class: 'hint' }, 'Les modifications de cet onglet sont gardées automatiquement ; publiez pour les mettre en ligne.')),
    h('h2', { class: 'section-title' }, 'Établissements'),
    list,
    h('section', { class: 'form-card' }, h('h3', null, 'Ajouter un établissement'),
      h('div', { class: 'admin-toolbar' }, newName, newType, h('button', { type: 'button', class: 'btn-primary', onclick: add }, 'Créer')))
  );
}
function deleteEtab(e) {
  const n = (A.etabs[e.id] && A.etabs[e.id].produits.length) || 0;
  if (!confirm(`Supprimer « ${e.nom} » et ses ${n} produit(s) ? Ce sera définitif à la prochaine publication.`)) return;
  for (const p of (A.etabs[e.id] && A.etabs[e.id].produits) || []) {
    for (const path of [p.image, p.imageEtiquette].filter(Boolean)) {
      if (A.pendingImages[path]) delete A.pendingImages[path]; else A.deleted.add(path);
    }
  }
  A.config.etablissements = A.config.etablissements.filter((x) => x.id !== e.id);
  delete A.etabs[e.id];
  const path = P.etab(e.id);
  A.dirty.delete(path);
  A.deleted.add(path);
  if (A.etabId === e.id) A.etabId = (A.config.etablissements[0] || {}).id || null;
  markDirty(P.config);
  render();
}

/* ================= Listes ================= */
function usageCount(list, id) {
  let n = 0;
  for (const d of Object.values(A.etabs)) for (const p of d.produits || []) {
    if (list === 'styles' && p.style === id) n++;
    else if (list === 'categories' && p.categorie === id) n++;
    else if (PRODUCT_LIST_FIELDS[list] && (p[PRODUCT_LIST_FIELDS[list]] || []).includes(id)) n++;
    else if (p.recette && ((list === 'methodes' && p.recette.methode === id) || (list === 'verres' && p.recette.verre === id) || (list === 'glaces' && p.recette.glace === id))) n++;
  }
  return n;
}
function removeUsage(list, id) {
  for (const [eid, d] of Object.entries(A.etabs)) {
    let touched = false;
    for (const p of d.produits || []) {
      if (list === 'styles' && p.style === id) { p.style = ''; touched = true; }
      const f = PRODUCT_LIST_FIELDS[list];
      if (f && (p[f] || []).includes(id)) { p[f] = p[f].filter((x) => x !== id); touched = true; }
      if (p.recette) {
        for (const [l, k] of [['methodes', 'methode'], ['verres', 'verre'], ['glaces', 'glace']]) {
          if (list === l && p.recette[k] === id) { p.recette[k] = ''; touched = true; }
        }
      }
    }
    if (touched) markDirty(P.etab(eid));
  }
}

function viewLists() {
  const list = A.listTab;
  const items = A.vocab[list] || (A.vocab[list] = []);
  const fixed = list === 'categories';
  const catOpts = [['', 'Toutes'], ...(A.vocab.categories || []).map((c) => [c.id, c.fr])];
  const table = h('div', { class: 'vocab-table' });
  items.forEach((it, idx) => {
    const n = usageCount(list, it.id);
    table.append(h('div', { class: 'vocab-row' },
      h('input', { class: 'input', type: 'text', value: it.fr, 'aria-label': 'Libellé français', oninput: (e) => { it.fr = e.target.value; markDirty(P.vocab); } }),
      h('input', { class: 'input', type: 'text', value: it.en || '', placeholder: 'English', 'aria-label': 'Libellé anglais', oninput: (e) => { it.en = e.target.value; markDirty(P.vocab); } }),
      list === 'styles' ? selectEl(catOpts, it.categorie || '', (v) => { if (v) it.categorie = v; else delete it.categorie; markDirty(P.vocab); }, { class: 'input', 'aria-label': 'Catégorie' }) : null,
      h('span', { class: 'usage' }, n ? `${n} produit(s)` : 'inutilisé'),
      h('div', { class: 'vocab-btns' },
        idx > 0 ? h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': 'Monter', onclick: () => { items.splice(idx - 1, 0, items.splice(idx, 1)[0]); markDirty(P.vocab); render(); } }, '↑') : null,
        fixed ? null : h('button', {
          type: 'button', class: 'icon-btn sm', 'aria-label': `Supprimer ${it.fr}`, html: C.UI_ICONS.close,
          onclick: () => {
            if (n && !confirm(`« ${it.fr} » est utilisé par ${n} produit(s). Le retirer de la liste et de ces produits ?`)) return;
            if (n) removeUsage(list, it.id);
            items.splice(idx, 1);
            markDirty(P.vocab);
            render();
          }
        }))
    ));
  });
  const newFr = h('input', { class: 'input', type: 'text', placeholder: 'Nouveau (français)' });
  const newEn = h('input', { class: 'input', type: 'text', placeholder: 'New (English)' });
  const newCat = list === 'styles' ? selectEl(catOpts, 'biere', () => {}) : null;
  const add = () => {
    const fr = newFr.value.trim();
    if (!fr) { newFr.focus(); return; }
    const entry = { id: uniqueVocabId(list, C.slugify(fr)), fr, en: newEn.value.trim() };
    if (newCat && newCat.value) entry.categorie = newCat.value;
    items.push(entry);
    markDirty(P.vocab);
    render();
  };
  newFr.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  newEn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  return h('div', null,
    h('div', { class: 'list-tabs' }, LISTS.map(([id, l]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(id === list), onclick: () => { A.listTab = id; render(); } }, l))),
    h('section', { class: 'form-card' },
      h('h3', null, (LISTS.find((x) => x[0] === list) || [])[1]),
      h('p', { class: 'hint' }, fixed
        ? 'Les catégories structurent l’application (icônes, champs vin et cocktail) : on peut les renommer, pas les supprimer.'
        : 'Ces listes alimentent les pastilles cliquables du site. Le libellé anglais est facultatif (le français est utilisé à défaut).'),
      table,
      fixed ? null : h('div', { class: 'vocab-row add' }, newFr, newEn, newCat, h('button', { type: 'button', class: 'btn-primary', onclick: add }, 'Ajouter')))
  );
}

/* ================= Paramètres ================= */
function viewSettings() {
  const g = { ...A.gh };
  const inp = (key, attrs = {}) => h('input', { class: 'input', type: 'text', value: g[key] || '', autocomplete: 'off', spellcheck: false, ...attrs, oninput: (e) => { g[key] = e.target.value.trim(); } });
  const status = h('div', { class: 'gh-status' }, A.ghError ? h('span', { class: 'err' }, A.ghError) : null);

  const saveGh = async () => {
    A.gh = { owner: g.owner || '', repo: g.repo || '', branch: g.branch || 'main', token: g.token || '', basePath: g.basePath || '' };
    C.store(GH_KEY, A.gh);
    C.clear(status).append('Test de la connexion…');
    try {
      const r = await ghClient().test();
      C.clear(status).append(
        r.canWrite ? h('span', { class: 'ok' }, '✓ Connexion réussie, écriture autorisée.') : h('span', { class: 'err' }, 'Connecté, mais ce jeton ne peut pas écrire dans le dépôt (permission « Contents : Read and write » requise).'),
        r.isPrivate ? h('div', { class: 'hint' }, 'Rappel : même avec un dépôt privé, un site GitHub Pages reste public (sauf offre Enterprise).') : null);
      A.ghError = '';
      updatePublishBar();
      if (A.source !== 'github' && !A.dirty.size) {
        await loadFromSource();
        render();
        toast('Données rechargées depuis GitHub.', 'ok');
      }
    } catch (e) {
      C.clear(status).append(h('span', { class: 'err' }, `Échec : ${e.message}. Vérifiez le propriétaire, le dépôt, la branche et le jeton.`));
    }
  };
  const forget = () => {
    A.gh = { ...A.gh, token: '' };
    C.store(GH_KEY, A.gh);
    render();
    toast('Jeton effacé de ce navigateur.', 'ok');
  };
  const reload = async () => {
    if ((A.dirty.size || A.deleted.size) && !confirm('Abandonner toutes les modifications non publiées et recharger les données ?')) return;
    C.store(C.DRAFT_KEY, undefined);
    closeEditor();
    try { await loadFromSource(); } catch (e) { toast(e.message, 'error'); }
    render();
    toast('Données rechargées.', 'ok');
  };
  const exportBackup = () => {
    const data = { type: 'carte-sauvegarde', version: 1, date: new Date().toISOString(), config: A.config, vocab: A.vocab, etabs: A.etabs };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `sauvegarde-carte-${today()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async () => {
    const f = importInput.files && importInput.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.type !== 'carte-sauvegarde' || !data.config || !data.vocab || !data.etabs) throw new Error('Ce fichier n’est pas une sauvegarde de la carte.');
      if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ? (Rien n’est publié tant que vous ne cliquez pas sur Publier.)')) return;
      const oldIds = (A.config.etablissements || []).map((e) => e.id);
      A.config = data.config; A.vocab = data.vocab; A.etabs = data.etabs;
      const newIds = (A.config.etablissements || []).map((e) => e.id);
      for (const id of oldIds) if (!newIds.includes(id)) A.deleted.add(P.etab(id));
      markDirty(P.config); markDirty(P.vocab);
      for (const id of newIds) { if (!A.etabs[id]) A.etabs[id] = { produits: [] }; markDirty(P.etab(id)); }
      A.etabId = newIds[0] || null;
      render();
      toast('Sauvegarde importée. Vérifiez puis publiez.', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    importInput.value = '';
  });

  return h('div', null,
    h('section', { class: 'form-card' },
      h('h3', null, 'Publication sur GitHub'),
      h('p', { class: 'hint' }, 'Le site est hébergé gratuitement par GitHub Pages. Pour publier depuis cette page (ordinateur ou téléphone), elle a besoin d’un jeton d’accès limité à votre dépôt. Le jeton reste uniquement dans ce navigateur.'),
      h('ol', { class: 'steps-help' },
        h('li', null, 'Sur GitHub, ouvrez ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'Settings › Developer settings › Fine-grained tokens › Generate new token'), '.'),
        h('li', null, 'Repository access : « Only select repositories » → votre dépôt.'),
        h('li', null, 'Permissions › Repository › Contents : « Read and write ». Rien d’autre.'),
        h('li', null, 'Copiez le jeton généré et collez-le ci-dessous vous-même.')),
      h('div', { class: 'grid2' },
        field('Propriétaire (votre identifiant GitHub)', inp('owner', { placeholder: 'mon-identifiant' })),
        field('Nom du dépôt', inp('repo', { placeholder: 'carte-du-bar' }))),
      h('div', { class: 'grid2' },
        field('Branche', inp('branch', { placeholder: 'main' })),
        field('Dossier du site dans le dépôt (facultatif)', inp('basePath', { placeholder: 'vide = racine' }))),
      field('Jeton d’accès (fine-grained)', inp('token', { type: 'password', placeholder: g.token ? '•••••• (enregistré)' : 'github_pat_…' })),
      h('div', { class: 'admin-toolbar' },
        h('button', { type: 'button', class: 'btn-primary', onclick: saveGh }, 'Enregistrer et tester'),
        g.token ? h('button', { type: 'button', class: 'btn-ghost', onclick: forget }, 'Oublier le jeton') : null),
      status),
    h('section', { class: 'form-card' },
      h('h3', null, 'Données'),
      h('p', { class: 'hint' }, A.source === 'github' ? 'Données lues depuis GitHub.' : 'Données lues depuis le site publié (GitHub pas encore relié).'),
      h('div', { class: 'admin-toolbar wrap' },
        h('button', { type: 'button', class: 'btn-ghost', onclick: reload }, 'Recharger (abandonner le brouillon)'),
        h('button', { type: 'button', class: 'btn-ghost', onclick: exportBackup }, 'Exporter une sauvegarde'),
        h('button', { type: 'button', class: 'btn-ghost', onclick: () => importInput.click() }, 'Importer une sauvegarde'),
        importInput)),
    h('section', { class: 'form-card soon' },
      h('h3', null, 'Assistant IA (prochaine étape)'),
      h('p', { class: 'hint' }, 'Prévu : pré-remplir une fiche à partir du nom et du producteur, et proposer des cocktails ou des accords à partir de l’inventaire, via l’API Claude. La clé d’API sera saisie ici et restera dans ce navigateur.'))
  );
}

/* ================= Démarrage ================= */
window.addEventListener('beforeunload', (e) => {
  if (A.editing && A.editing.changed) { e.preventDefault(); e.returnValue = ''; }
});
init();
