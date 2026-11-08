// Vue équipe : recherche par clics, résultats en cartes, fiche détaillée.
import * as C from './core.js';
import { ABV_BUCKETS, IBU_BUCKETS, UNITES } from './i18n.js';

const { h, t, tn, tx } = C;
const ETAB_KEY = 'carte-etablissement';
const app = document.getElementById('app');

const PROFILS = ['coeur', 'sansGluten', 'vegetarien', 'vegan'];

const S = {
  config: null, vocab: null, V: null,
  etabId: null, all: [], produits: [], pending: {},
  preview: false, draft: null,
  q: '', sort: 'default',
  sel: emptySel(),
  openFacets: new Set(['style', 'abv', 'ibu', 'aromes', 'profil']),
  filtersOpen: false
};
const R = {}; // références DOM

function emptySel() {
  return {
    cat: new Set(), style: new Set(), abv: new Set(), ibu: new Set(), aromes: new Set(),
    degustation: new Set(), accords: new Set(), profil: new Set(), etiquettes: new Set(), sansAllergene: new Set()
  };
}

/* ---------- Définition des filtres ---------- */
const vocabOrder = (list) => () => (S.vocab[list] || []).map((x) => x.id);
const vocabLabel = (list) => (v) => C.label(S.V, list, v);

const FACETS = [
  { id: 'cat', mode: 'or', values: (p) => [p.categorie], label: vocabLabel('categories'), order: vocabOrder('categories') },
  { id: 'style', mode: 'or', values: (p) => (p.style ? [p.style] : []), label: vocabLabel('styles'), order: vocabOrder('styles') },
  {
    id: 'abv', mode: 'or',
    values: (p) => { const b = C.bucketOf(ABV_BUCKETS, p.alcool); return b ? [b] : []; },
    label: (v) => tx(ABV_BUCKETS.find((b) => b.id === v)), order: () => ABV_BUCKETS.map((b) => b.id)
  },
  {
    id: 'ibu', mode: 'or',
    values: (p) => { const b = C.bucketOf(IBU_BUCKETS, p.ibu); return b ? [b] : []; },
    label: (v) => tx(IBU_BUCKETS.find((b) => b.id === v)), order: () => IBU_BUCKETS.map((b) => b.id)
  },
  { id: 'aromes', mode: 'or', values: (p) => p.aromes || [], label: vocabLabel('aromes'), order: vocabOrder('aromes') },
  { id: 'degustation', mode: 'or', values: (p) => p.degustation || [], label: vocabLabel('degustation'), order: vocabOrder('degustation') },
  { id: 'accords', mode: 'or', values: (p) => p.accords || [], label: vocabLabel('accords'), order: vocabOrder('accords') },
  { id: 'profil', mode: 'and', values: profilValues, label: (v) => t('profil.' + v), order: () => PROFILS },
  { id: 'etiquettes', mode: 'or', values: (p) => p.etiquettes || [], label: vocabLabel('etiquettes'), order: vocabOrder('etiquettes') },
  { id: 'sansAllergene', mode: 'exclude', values: (p) => p.allergenes || [], label: vocabLabel('allergenes'), order: vocabOrder('allergenes') }
];
const FACET = Object.fromEntries(FACETS.map((f) => [f.id, f]));

function profilValues(p) {
  const out = [];
  if (p.coupDeCoeur) out.push('coeur');
  const r = p.regimes || {};
  if (r.sansGluten === true) out.push('sansGluten');
  if (r.vegetarien === true || r.vegan === true) out.push('vegetarien');
  if (r.vegan === true) out.push('vegan');
  return out;
}

function passes(p, f, sel) {
  if (!sel || !sel.size) return true;
  const vals = f.values(p);
  if (f.mode === 'or') return vals.some((v) => sel.has(v));
  if (f.mode === 'and') return [...sel].every((v) => vals.includes(v));
  return ![...sel].some((v) => vals.includes(v)); // exclude
}

function haystack(p) {
  if (!p._hay) {
    const st = S.V.styles.get(p.style);
    const cat = S.V.categories.get(p.categorie);
    p._hay = C.normalize([p.nom, p.producteur, p.origine, p.cepages, st && st.fr, st && st.en, cat && cat.fr, cat && cat.en].filter(Boolean).join(' '));
  }
  return p._hay;
}
function matchesText(p) {
  const q = C.normalize(S.q).trim();
  if (!q) return true;
  const hay = haystack(p);
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}
function filtered(exceptFacet) {
  return S.produits.filter((p) => matchesText(p) && FACETS.every((f) => f.id === exceptFacet || passes(p, f, S.sel[f.id])));
}
function countFor(f, v, base) {
  if (f.mode === 'or') return base.filter((p) => f.values(p).includes(v)).length;
  const next = new Set(S.sel[f.id]); next.add(v);
  return base.filter((p) => passes(p, f, next)).length;
}
function facetOptions(f) {
  const scope = f.id === 'cat' ? S.produits : S.produits.filter((p) => passes(p, FACET.cat, S.sel.cat));
  const set = new Set();
  for (const p of scope) for (const v of f.values(p)) set.add(v);
  for (const v of S.sel[f.id]) set.add(v);
  const order = f.order();
  return [...order.filter((v) => set.has(v)), ...[...set].filter((v) => !order.includes(v)).sort()];
}
function selectedCount(includeCat = false) {
  return FACETS.reduce((n, f) => n + (f.id === 'cat' && !includeCat ? 0 : S.sel[f.id].size), 0);
}

/* ---------- Tri ---------- */
const SORTS = ['default', 'name', 'abvAsc', 'abvDesc', 'ibuAsc', 'ibuDesc'];
function sortList(list) {
  const byName = (a, b) => a.nom.localeCompare(b.nom, C.getLang() === 'en' ? 'en-CA' : 'fr-CA', { sensitivity: 'base' });
  const num = (key, dir) => (a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return byName(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return dir * (x - y) || byName(a, b);
  };
  const cmp = {
    default: (a, b) => (b.coupDeCoeur ? 1 : 0) - (a.coupDeCoeur ? 1 : 0) || byName(a, b),
    name: byName,
    abvAsc: num('alcool', 1), abvDesc: num('alcool', -1),
    ibuAsc: num('ibu', 1), ibuDesc: num('ibu', -1)
  }[S.sort] || byName;
  return [...list].sort(cmp);
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
    const wanted = params.get('e') || C.load(ETAB_KEY, false);
    S.etabId = (etabs.find((e) => e.id === wanted) || etabs[0] || {}).id || null;
    await loadEtab(S.etabId);
    renderShell();
    refresh();
    syncFromHash();
  } catch (e) {
    console.error(e);
    C.clear(app).append(h('div', { class: 'error-box' }, t('error.load')));
  }
}

async function loadEtab(id) {
  let data = { produits: [] };
  if (id) {
    if (S.draft && S.draft.etabs && S.draft.etabs[id]) data = S.draft.etabs[id];
    else {
      try { data = await C.loadJSON(C.PATHS.etab(id)); }
      catch (e) { if (e.status !== 404) throw e; }
    }
  }
  S.all = (data.produits || []).map((p) => ({ ...p }));
  S.produits = S.all.filter((p) => p.disponible !== false);
  S.sel = emptySel();
  S.q = '';
}

function currentEtab() { return (S.config.etablissements || []).find((e) => e.id === S.etabId); }

/* ---------- Squelette ---------- */
function renderShell() {
  C.clear(app);
  const etabs = S.config.etablissements || [];
  const etab = currentEtab();
  const siteName = tx(S.config.site && S.config.site.nom) || 'Carte';
  document.title = etab ? `${siteName} · ${etab.nom}` : siteName;

  if (S.preview) {
    const exit = new URL(location.href); exit.searchParams.delete('apercu'); exit.hash = '';
    app.append(h('div', { class: 'banner' }, h('span', null, t('preview.banner')), h('a', { href: exit.pathname + exit.search }, t('preview.exit'))));
  }

  const sub = etabs.length > 1
    ? h('select', { class: 'etab-select inline', 'aria-label': t('etab'), onchange: (e) => switchEtab(e.target.value) },
      etabs.map((e) => h('option', { value: e.id, selected: e.id === S.etabId }, [e.nom, e.ville].filter(Boolean).join(' · '))))
    : etab && h('div', { class: 'sub' }, [etab.nom, etab.ville].filter(Boolean).join(' · '));

  app.append(h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('h1', null, siteName), sub),
    h('button', { class: 'btn-lang', type: 'button', 'aria-label': t('lang.switchLabel'), onclick: toggleLang }, t('lang.switch'))
  ));

  R.catbar = h('nav', { class: 'catbar', 'aria-label': t('facet.style') });
  app.append(R.catbar);

  R.search = h('input', {
    type: 'search', placeholder: t('search.placeholder'), 'aria-label': t('search.label'), value: S.q,
    autocomplete: 'off', enterkeyhint: 'search',
    oninput: (e) => { S.q = e.target.value; refresh(); }
  });
  R.filterBadge = h('span', { class: 'badge', hidden: true });
  app.append(h('div', { class: 'toolbar' },
    h('label', { class: 'search', html: C.UI_ICONS.search }, R.search),
    h('button', { class: 'btn-filters', type: 'button', onclick: () => setFiltersOpen(true) },
      h('span', { html: C.UI_ICONS.filter }), t('filters'), R.filterBadge)
  ));

  R.filtersBody = h('div', { class: 'filters-body' });
  R.showBtn = h('button', { class: 'btn-primary', type: 'button', onclick: () => setFiltersOpen(false) });
  R.filters = h('aside', { class: 'filters', 'aria-label': t('filters') },
    h('div', { class: 'filters-head' },
      h('h2', null, t('filters')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('filters.close'), html: C.UI_ICONS.close, onclick: () => setFiltersOpen(false) })),
    R.filtersBody,
    h('div', { class: 'filters-foot' },
      h('button', { class: 'btn-ghost', type: 'button', onclick: clearAll }, t('filters.clear')),
      R.showBtn)
  );

  R.active = h('div', { class: 'active-filters' });
  R.count = h('span');
  R.sort = h('select', { 'aria-label': t('sort.label'), onchange: (e) => { S.sort = e.target.value; refresh(); } },
    SORTS.map((s) => h('option', { value: s, selected: s === S.sort }, t('sort.' + s))));
  R.grid = h('div', { class: 'grid' });
  app.append(h('div', { class: 'layout' },
    R.filters,
    h('main', null, R.active, h('div', { class: 'results-meta' }, R.count, R.sort), R.grid)
  ));

  R.dialog = h('dialog', { class: 'detail' });
  R.dialog.addEventListener('cancel', (e) => { e.preventDefault(); closeDetail(); });
  R.dialog.addEventListener('click', (e) => { if (e.target === R.dialog) closeDetail(); });
  app.append(R.dialog);
}

function setFiltersOpen(open) {
  S.filtersOpen = open;
  R.filters.classList.toggle('open', open);
  document.body.style.overflow = open && window.innerWidth < 960 ? 'hidden' : '';
}

/* ---------- Mise à jour ---------- */
function refresh() {
  renderCatbar();
  renderFilters();
  renderActive();
  renderResults();
}

function renderCatbar() {
  C.clear(R.catbar);
  const f = FACET.cat;
  const opts = facetOptions(f);
  if (opts.length < 2) { R.catbar.hidden = true; return; }
  R.catbar.hidden = false;
  R.catbar.append(h('button', {
    class: 'cat-chip', type: 'button', 'aria-pressed': String(!S.sel.cat.size),
    onclick: () => { S.sel.cat.clear(); refresh(); }
  }, t('all')));
  for (const v of opts) {
    R.catbar.append(h('button', {
      class: 'cat-chip', type: 'button', 'aria-pressed': String(S.sel.cat.has(v)),
      onclick: () => {
        const was = S.sel.cat.has(v);
        S.sel.cat.clear();
        if (!was) S.sel.cat.add(v);
        refresh();
      }
    }, h('span', { html: C.categoryIcon(v, '') }), f.label(v)));
  }
}

function toggle(fid, v) {
  const s = S.sel[fid];
  s.has(v) ? s.delete(v) : s.add(v);
  refresh();
}

function renderFilters() {
  C.clear(R.filtersBody);
  for (const f of FACETS) {
    if (f.id === 'cat') continue;
    const opts = facetOptions(f);
    if (!opts.length) continue;
    const base = filtered(f.id);
    const sel = S.sel[f.id];
    const chips = opts.map((v) => {
      const n = countFor(f, v, base);
      const pressed = sel.has(v);
      return h('button', {
        class: 'chip' + (f.mode === 'exclude' ? ' excl' : ''), type: 'button',
        'aria-pressed': String(pressed), disabled: !pressed && n === 0,
        onclick: () => toggle(f.id, v)
      },
      f.id === 'profil' && v === 'coeur' ? h('span', { html: C.UI_ICONS.heart }) : null,
      f.label(v),
      h('span', { class: 'n' }, String(n)));
    });
    const det = h('details', { class: 'facet', open: S.openFacets.has(f.id) },
      h('summary', null, t('facet.' + f.id), sel.size ? h('span', { class: 'sel-count' }, String(sel.size)) : null),
      h('div', { class: 'chips' }, chips));
    det.addEventListener('toggle', () => (det.open ? S.openFacets.add(f.id) : S.openFacets.delete(f.id)));
    R.filtersBody.append(det);
  }
  const n = selectedCount();
  R.filterBadge.hidden = n === 0;
  R.filterBadge.textContent = String(n);
}

function renderActive() {
  C.clear(R.active);
  for (const f of FACETS) {
    for (const v of S.sel[f.id]) {
      const lbl = f.mode === 'exclude' ? t('excl', { x: f.label(v) }) : f.label(v);
      R.active.append(h('button', {
        class: 'active-chip', type: 'button', 'aria-label': `${lbl} ×`,
        onclick: () => toggle(f.id, v)
      }, lbl, h('span', { html: C.UI_ICONS.close })));
    }
  }
  if (selectedCount(true) > 1 || (selectedCount(true) && S.q)) {
    R.active.append(h('button', { class: 'link-btn', type: 'button', onclick: clearAll }, t('filters.clear')));
  }
}

function clearAll() {
  S.sel = emptySel();
  S.q = '';
  if (R.search) R.search.value = '';
  refresh();
}

function renderResults() {
  const list = sortList(filtered());
  R.count.textContent = tn('results', list.length);
  R.showBtn.textContent = tn('filters.show', list.length);
  R.showBtn.disabled = list.length === 0;
  C.clear(R.grid);
  if (!S.produits.length) {
    R.grid.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, h('strong', null, t('empty.catalog'))));
    return;
  }
  if (!list.length) {
    R.grid.append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, h('strong', null, t('empty')), t('empty.hint')));
    return;
  }
  for (const p of list) R.grid.append(card(p));
}

function media(p, which = 'image') {
  const path = which === 'image' ? (p.image || p.imageEtiquette) : p[which];
  const ph = () => h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) });
  if (!path) return ph();
  const img = h('img', { src: C.imgSrc(path, S.pending), alt: p.nom, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
  return img;
}

function dietStats(p) {
  const r = p.regimes || {};
  const out = [];
  if (r.sansGluten === true) out.push(t('profil.sansGluten'));
  if (r.vegan === true) out.push(t('profil.vegan'));
  else if (r.vegetarien === true && p.categorie === 'cocktail') out.push(t('profil.vegetarien'));
  return out;
}

function card(p) {
  const style = p.style ? C.label(S.V, 'styles', p.style) : C.label(S.V, 'categories', p.categorie);
  return h('button', { class: 'card', type: 'button', onclick: () => openDetail(p.id) },
    h('div', { class: 'card-media' }, media(p)),
    p.coupDeCoeur ? h('span', { class: 'heart', role: 'img', 'aria-label': t('heart'), title: t('heart'), html: C.UI_ICONS.heart }) : null,
    h('div', { class: 'card-body' },
      h('h3', { class: 'card-title' }, p.nom),
      h('div', { class: 'card-sub' }, [style, p.producteur].filter(Boolean).join(' · ')),
      h('div', { class: 'card-stats' },
        p.alcool != null ? h('span', { class: 'stat' }, C.fmtAbv(p.alcool)) : null,
        p.ibu != null ? h('span', { class: 'stat' }, `${C.fmtNum(p.ibu, 0)} IBU`) : null,
        dietStats(p).map((d) => h('span', { class: 'stat diet' }, d))
      )
    )
  );
}

/* ---------- Fiche détaillée ---------- */
function openDetail(id, push = true) {
  const p = S.all.find((x) => x.id === id);
  if (!p) { hideDialog(); return; }
  if (push) {
    const depth = ((history.state && history.state.depth) || 0) + 1;
    history.pushState({ detail: id, depth }, '', '#p=' + encodeURIComponent(id));
  }
  renderDetail(p);
  if (!R.dialog.open) R.dialog.showModal();
  const inner = R.dialog.querySelector('.detail-inner');
  if (inner) inner.scrollTop = 0;
}
function hideDialog() { if (R.dialog && R.dialog.open) R.dialog.close(); }
function closeDetail() {
  const d = (history.state && history.state.depth) || 0;
  if (d > 0) history.go(-d);
  else {
    history.replaceState(null, '', location.pathname + location.search);
    hideDialog();
  }
}
function syncFromHash() {
  const m = location.hash.match(/^#p=(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]), false);
  else hideDialog();
}
window.addEventListener('popstate', syncFromHash);

function filterBy(fid, v) {
  S.sel = emptySel();
  S.q = '';
  if (R.search) R.search.value = '';
  S.sel[fid].add(v);
  closeDetail();
  refresh();
  window.scrollTo({ top: 0 });
}

function tagRow(fid, list, values) {
  return h('div', { class: 'tag-row' }, values.map((v) =>
    h('button', { class: 'chip', type: 'button', onclick: () => filterBy(fid, v) }, C.label(S.V, list, v))));
}
function statBox(k, v) { return v ? h('div', { class: 'stat-box' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)) : null; }
function paragraphs(text) { return String(text).split(/\n+/).filter((s) => s.trim()).map((s) => h('p', null, s)); }
function lines(text) { return String(text || '').split(/\n+/).map((s) => s.trim()).filter(Boolean); }

function renderDetail(p) {
  C.clear(R.dialog);
  const images = [
    p.image && { path: p.image, label: t('detail.photo') },
    p.imageEtiquette && { path: p.imageEtiquette, label: t('detail.label') }
  ].filter(Boolean);
  const main = h('div', { class: 'main' });
  const thumbs = [];
  const show = (i) => {
    C.clear(main);
    if (!images.length) main.append(media(p));
    else {
      const img = h('img', { src: C.imgSrc(images[i].path, S.pending), alt: `${p.nom} — ${images[i].label}` });
      img.addEventListener('error', () => img.replaceWith(h('div', { class: `ph ph-${p.categorie}`, html: C.categoryIcon(p.categorie) })), { once: true });
      main.append(img);
    }
    thumbs.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
  };
  if (images.length > 1) {
    images.forEach((im, i) => thumbs.push(h('button', { class: 'thumb', type: 'button', 'aria-label': im.label, onclick: () => show(i) },
      h('img', { src: C.imgSrc(im.path, S.pending), alt: '' }))));
  }

  const cat = C.label(S.V, 'categories', p.categorie);
  const style = p.style ? C.label(S.V, 'styles', p.style) : '';
  const isWine = p.categorie === 'vin';
  const sections = [];
  let hintShown = false;
  const hint = () => { if (hintShown) return null; hintShown = true; return h('div', { class: 'hint' }, t('detail.tapHint')); };

  if (p.aromes && p.aromes.length) sections.push(h('section', { class: 'section' }, h('h3', null, t('detail.aromes')), tagRow('aromes', 'aromes', p.aromes), hint()));
  if (p.degustation && p.degustation.length) sections.push(h('section', { class: 'section' }, h('h3', null, t('detail.degustation')), tagRow('degustation', 'degustation', p.degustation)));
  if (tx(p.notes)) sections.push(h('section', { class: 'section' }, h('h3', null, t('detail.notes')), paragraphs(tx(p.notes))));
  if (p.recette) sections.push(recipeSection(p.recette));
  if ((p.accords && p.accords.length) || tx(p.accordsNotes)) {
    sections.push(h('section', { class: 'section' }, h('h3', null, t('detail.accords')),
      p.accords && p.accords.length ? tagRow('accords', 'accords', p.accords) : null,
      tx(p.accordsNotes) ? h('p', { style: { marginTop: '8px' } }, tx(p.accordsNotes)) : null, hint()));
  }
  sections.push(dietSection(p));
  if (p.etiquettes && p.etiquettes.length) sections.push(h('section', { class: 'section' }, h('h3', null, t('detail.etiquettes')), tagRow('etiquettes', 'etiquettes', p.etiquettes)));

  const price = isWine && p.prixVerre != null
    ? [statBox(t('detail.priceGlass'), C.fmtPrice(p.prixVerre)), statBox(t('detail.priceBottle'), C.fmtPrice(p.prix))]
    : [statBox(t('detail.price'), C.fmtPrice(p.prix))];

  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('detail.close'), html: C.UI_ICONS.close, onclick: closeDetail });
  R.dialog.append(h('div', { class: 'detail-inner' },
    h('div', { class: 'detail-top' }, closeBtn),
    h('div', { class: 'detail-media' }, main, thumbs.length ? h('div', { class: 'thumbs' }, thumbs) : null),
    h('div', { class: 'detail-body' },
      h('div', { class: 'kicker' }, [cat, style].filter(Boolean).join(' · ')),
      h('h2', null, p.nom),
      (p.producteur || p.origine) ? h('div', { class: 'producer' }, [p.producteur, p.origine].filter(Boolean).join(' — ')) : null,
      p.coupDeCoeur ? h('div', { class: 'heart-inline' }, h('span', { html: C.UI_ICONS.heart }), t('heart')) : null,
      p.disponible === false ? h('div', { class: 'unavailable' }, t('detail.unavailable')) : null,
      h('div', { class: 'stats-row' },
        statBox(t('detail.abv'), C.fmtAbv(p.alcool)),
        statBox(t('detail.ibu'), p.ibu != null ? C.fmtNum(p.ibu, 0) : ''),
        isWine ? statBox(t('detail.vintage'), p.millesime) : null,
        isWine ? statBox(t('detail.grapes'), p.cepages) : null,
        statBox(t('detail.format'), p.format),
        price),
      sections
    )
  ));
  show(0);
}

function recipeSection(r) {
  const ingr = (r.ingredients || []).filter((i) => tx(i.nom));
  const linked = (id) => id && S.all.find((x) => x.id === id);
  const unit = (u) => { const x = UNITES.find((y) => y.id === u); return x ? tx(x) : (u || ''); };
  const steps = lines(tx(r.etapes));
  return h('section', { class: 'section' },
    h('h3', null, t('detail.recipe')),
    h('div', { class: 'recipe' },
      h('div', { class: 'recipe-meta' },
        statBox(t('detail.method'), r.methode ? C.label(S.V, 'methodes', r.methode) : ''),
        statBox(t('detail.glass'), r.verre ? C.label(S.V, 'verres', r.verre) : ''),
        statBox(t('detail.ice'), r.glace ? C.label(S.V, 'glaces', r.glace) : '')),
      ingr.length ? [
        h('h4', null, t('detail.ingredients')),
        h('ul', { class: 'ingredients' }, ingr.map((i) => {
          const prod = linked(i.produitId);
          const qty = [i.quantite ? C.fmtNum(C.parseNum(i.quantite) ?? i.quantite, 2) || i.quantite : '', unit(i.unite)].filter(Boolean).join(' ');
          return h('li', null,
            h('span', { class: 'qty' }, qty),
            prod ? h('button', { type: 'button', onclick: () => openDetail(prod.id) }, tx(i.nom)) : h('span', null, tx(i.nom)));
        }))
      ] : null,
      steps.length ? [h('h4', null, t('detail.steps')), h('ol', { class: 'steps' }, steps.map((s) => h('li', null, s)))] : null,
      tx(r.garniture) ? [h('h4', null, t('detail.garnish')), h('p', null, tx(r.garniture))] : null,
      tx(r.notesEquipe) ? [h('h4', null, t('detail.teamNotes')), h('div', { class: 'team-note' }, paragraphs(tx(r.notesEquipe)))] : null
    )
  );
}

function dietSection(p) {
  const r = p.regimes || {};
  const val = (v) => v === true ? h('span', { class: 'yes' }, t('detail.yes'))
    : v === false ? h('span', { class: 'no' }, t('detail.no'))
      : h('span', { class: 'unk' }, t('detail.unknown'));
  const al = p.allergenes || [];
  return h('section', { class: 'section' },
    h('h3', null, t('detail.diet')),
    h('div', { class: 'diet-list' },
      ['sansGluten', 'vegetarien', 'vegan'].map((k) => h('div', { class: 'diet-item' }, h('span', null, t('profil.' + k)), val(r[k])))),
    h('div', { class: 'tag-row' },
      al.length ? al.map((a) => h('span', { class: 'chip' }, C.label(S.V, 'allergenes', a)))
        : h('span', { class: 'muted' }, t('detail.noAllergen')))
  );
}

/* ---------- Actions ---------- */
async function switchEtab(id) {
  S.etabId = id;
  C.store(ETAB_KEY, id);
  const u = new URL(location.href);
  u.searchParams.set('e', id);
  u.hash = '';
  history.replaceState(null, '', u.pathname + u.search);
  try { await loadEtab(id); } catch (e) { console.error(e); }
  renderShell();
  refresh();
}

function toggleLang() {
  C.setLang(C.getLang() === 'fr' ? 'en' : 'fr');
  const wasOpen = R.dialog && R.dialog.open;
  renderShell();
  refresh();
  if (wasOpen) syncFromHash();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.filtersOpen && !(R.dialog && R.dialog.open)) setFiltersOpen(false);
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
