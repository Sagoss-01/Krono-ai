/**
 * src/services/aiWhiteboardService.js
 * L'IA dessine, modifie et organise le tableau blanc. Tout ce qu'elle renvoie est VALIDÉ ici :
 *  - éléments simples (formes, traits, textes, tracés), composants natifs du tableau (« ui »),
 *    composants et gabarits de design (développés par aiDesignLibrary) et images ;
 *  - modifications / suppressions limitées aux ids réellement présents sur le tableau ;
 *  - images : un lien n'est suivi QUE s'il figure dans le message de l'utilisateur, et l'image est
 *    importée par le serveur (wbImageService) — jamais chargée directement par les navigateurs.
 */
const aiService = require('./aiService');
const prompts   = require('./aiPrompts');
const design    = require('./aiDesignLibrary');
const imageService = require('./wbImageService');

const MAX_RAW = 120, MAX_TOTAL = 450, MAX_UPDATES = 60, MAX_DELETES = 60, MAX_IMAGES = 6, MAX_CONTEXT = 140;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const LOCAL_SRC = /^\/wb-media\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const URL_IN_TEXT = /https:\/\/[^\s<>"'`)\]]+/gi;

const KINDS = new Set(['rect', 'ellipse', 'triangle', 'line', 'arrow', 'text', 'freehand', 'ui', 'image']);
const SHAPE_KINDS = new Set(['rect', 'ellipse', 'triangle']);
const DASHES = new Set(['dashed', 'dotted']);

// Composants natifs du tableau (stickers) et propriétés acceptées pour chacun
const S = 's', B = 'b', C = 'c', CSV = 'csv', NUMS = 'nums';
const STICKER_PROPS = {
  btn: { label: S }, input: { label: S, placeholder: S, value: S, hasValue: B, bgColor: C }, card: { title: S, subtitle: S },
  avatar: {}, image: { src: 'src', fit: 'fit', radius: 'n:0-60' }, nav: { brand: S }, table: { rows: 'n:1-20', cols: 'n:1-10' },
  modal: { title: S }, chart: { title: S, chartType: S, values: NUMS, bgColor: C }, toggle: { on: B }, badge: { label: S },
  desktop: { res: S }, laptop: { res: S }, mobile: { res: S }, tablet: { res: S }, browser: { url: S },
  container: { label: S, bgColor: C, borderRadius: 'n:0-40', dashed: B, shadow: B, showHeader: B },
  section: { label: S }, grid2: {}, grid3: {}, flexrow: { items: 'n:2-6' }, hero: { title: S, subtitle: S, cta: S, bgColor: C, borderRadius: 'n:0-40' },
  sidebar: { label: S, items: CSV, bgColor: C }, tabs: { label: S, items: CSV }, checkbox: { items: CSV }, list: { label: S, items: CSV },
  note: { label: S, body: S }, sticky: { label: S, body: S, bgColor: C }, timeline: { title: S, items: CSV }, swimlane: { title: S, lanes: CSV },
  rubric: { criteria: CSV }, lesson: { title: S, items: CSV }, mindmap: { title: S, branches: CSV },
};
const STICKERS = new Set(Object.keys(STICKER_PROPS));

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const color = (v, fb) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fb);
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
const bool = (v) => v === true || v === 'true' || v === 1;

/** Source d'image acceptée : fichier déjà stocké chez nous, ou lien https (à importer ensuite). */
function cleanSrc(v) {
  const s = String(v ?? '').trim();
  if (LOCAL_SRC.test(s)) return s;
  if (/^https:\/\/\S{4,1900}$/i.test(s)) return s;
  return '';
}

/** Valide les propriétés d'un composant natif selon son schéma. */
function sanitizeProps(sticker, raw) {
  const schema = STICKER_PROPS[sticker] || {};
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const [key, type] of Object.entries(schema)) {
    if (src[key] === undefined || src[key] === null) continue;
    const v = src[key];
    if (type === S)        { const t = str(v, 100); if (t) out[key] = t; }
    else if (type === B)   out[key] = bool(v);
    else if (type === C)   { const c = color(v, null); if (c) out[key] = c; }
    else if (type === CSV) { const l = (Array.isArray(v) ? v : String(v).split(',')).map(x => str(x, 30).replace(/,/g, ' ')).filter(Boolean).slice(0, 8); if (l.length) out[key] = l.join(','); }
    else if (type === NUMS){ const l = (Array.isArray(v) ? v : String(v).split(',')).map(x => clamp(num(x, 0), 5, 100)).slice(0, 12); if (l.length) out[key] = l.join(','); }
    else if (type === 'src'){ const s = cleanSrc(v); if (s) out[key] = s; }
    else if (type === 'fit'){ out[key] = v === 'contain' ? 'contain' : 'cover'; }
    else if (type.startsWith('n:')) { const [min, max] = type.slice(2).split('-').map(Number); out[key] = Math.round(clamp(num(v, min), min, max)); }
  }
  return out;
}

function sanitizeElement(el, defaults = { stroke: '#4db8d8', text: '#ffffff' }) {
  if (!el || typeof el !== 'object') return null;
  let kind = String(el.kind || '').toLowerCase();
  if (!KINDS.has(kind)) return null;

  if (kind === 'image') {                                              // une image est un composant natif « image » avec une source
    const src = cleanSrc(el.src || el.url);
    el = { kind: 'ui', sticker: 'image', x: el.x, y: el.y, w: el.w, h: el.h, color: el.color, props: { src, fit: el.fit, radius: el.radius } };
    kind = 'ui';
  }
  if (SHAPE_KINDS.has(kind) || kind === 'ui') {
    const x = clamp(num(el.x)), y = clamp(num(el.y));
    const w = clamp(num(el.w), 0.002, 1 - x), h = clamp(num(el.h), 0.002, 1 - y);
    if (w < 0.002 || h < 0.002) return null;
    if (kind === 'ui') {
      const sticker = String(el.sticker || '').toLowerCase();
      if (!STICKERS.has(sticker)) return null;
      return { kind, sticker, x, y, w, h, color: color(el.color, defaults.stroke), props: sanitizeProps(sticker, el.props) };
    }
    const out = { kind, x, y, w, h, color: color(el.color, defaults.stroke) };
    const fill = color(el.fill, null); if (fill) out.fill = fill;
    if (el.radius !== undefined) out.radius = Math.round(clamp(num(el.radius), 0, 80));
    if (el.strokeSize !== undefined) out.strokeSize = clamp(num(el.strokeSize, 2), 0, 12);
    if (bool(el.noStroke)) out.noStroke = true;
    if (DASHES.has(el.dash)) out.dash = el.dash;
    if (el.opacity !== undefined) out.opacity = Math.round(clamp(num(el.opacity, 100), 10, 100));
    const label = str(el.label, 60); if (label) out.label = label;
    return out;
  }
  if (kind === 'line' || kind === 'arrow') {
    const out = { kind, x1: clamp(num(el.x1)), y1: clamp(num(el.y1)), x2: clamp(num(el.x2)), y2: clamp(num(el.y2)), color: color(el.color, defaults.stroke) };
    if (el.strokeSize !== undefined) out.strokeSize = clamp(num(el.strokeSize, 2), 1, 12);
    if (DASHES.has(el.dash)) out.dash = el.dash;
    return out;
  }
  if (kind === 'text') {
    const text = str(el.text, 120);
    if (!text) return null;
    const out = { kind, text, x: clamp(num(el.x)), y: clamp(num(el.y)), size: clamp(Math.round(num(el.size, 4)), 2, 12), color: color(el.color, defaults.text) };
    if (bool(el.bold)) out.bold = true;
    if (bool(el.italic)) out.italic = true;
    if (el.align === 'center' || el.align === 'right') out.align = el.align;
    return out;
  }
  // freehand
  const points = (Array.isArray(el.points) ? el.points : []).slice(0, 60)
    .map(p => (Array.isArray(p) ? [clamp(num(p[0])), clamp(num(p[1]))] : null)).filter(Boolean);
  if (points.length < 2) return null;
  const out = { kind, points, color: color(el.color, defaults.stroke) };
  if (el.strokeSize !== undefined) out.strokeSize = clamp(num(el.strokeSize, 2), 1, 12);
  return out;
}

/** Modification validée d'un élément (par id) ou d'un groupe (par « group »). */
function sanitizeUpdate(u, ids, groups = new Set(), stickerById = new Map()) {
  if (!u || typeof u !== 'object') return null;
  const out = {};
  if (u.group !== undefined) {
    const g = String(u.group);
    if (!ID_RE.test(g) || !groups.has(g)) return null;
    out.group = g;
  } else {
    const id = String(u.id ?? '');
    if (!ID_RE.test(id) || !ids.has(id)) return null;
    out.id = id;
  }
  const base = Object.keys(out).length;
  if (u.color) { const c = color(u.color, null); if (c) out.color = c; }
  if (u.fill)  { const c = color(u.fill, null);  if (c) out.fill = c; }
  if (u.text !== undefined) { const t = str(u.text, 120); if (t) out.text = t; }
  if (u.size !== undefined) out.size = clamp(Math.round(num(u.size, 4)), 2, 12);
  for (const k of ['x', 'y']) if (u[k] !== undefined) out[k] = clamp(num(u[k]));
  for (const k of ['w', 'h']) if (u[k] !== undefined) out[k] = clamp(num(u[k]), 0.002, 1);
  for (const k of ['dx', 'dy']) if (u[k] !== undefined) out[k] = clamp(num(u[k]), -1, 1);
  if (u.opacity !== undefined) out.opacity = Math.round(clamp(num(u.opacity, 100), 10, 100));
  if (u.props && out.id && stickerById.has(out.id)) {
    const props = sanitizeProps(stickerById.get(out.id), u.props);
    if (Object.keys(props).length) out.props = props;
  }
  return Object.keys(out).length > base ? out : null;
}

const idList = (v, ids, groups, max) => [...new Set((Array.isArray(v) ? v : []).map(String))].filter(i => ids.has(i) || groups.has(i)).slice(0, max);

/** Liens https présents dans le message de l'utilisateur (seuls ceux-là peuvent être importés). */
function urlsInPrompt(text) {
  return new Set((String(text || '').match(URL_IN_TEXT) || []).map(u => u.replace(/[.,;:!?]+$/, '')));
}

function luminance(hex) {
  if (!HEX.test(hex || '')) return 0;
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Développe un composant ou un gabarit en éléments simples (boîte normalisée → pixels → éléments normalisés). */
function expand(raw, designer) {
  const kind = String(raw.kind);
  const name = String(raw.name || '').toLowerCase();
  const isTemplate = kind === 'template';
  const registry = isTemplate ? designer.templates : designer.components;
  if (!Object.prototype.hasOwnProperty.call(registry, name)) return null;
  const x = clamp(num(raw.x, isTemplate ? 0.02 : 0)), y = clamp(num(raw.y, isTemplate ? 0.03 : 0));
  const w = clamp(num(raw.w, isTemplate ? 0.96 : 0), 0, 1 - x), h = clamp(num(raw.h, isTemplate ? 0.94 : 0), 0, 1 - y);
  if (w < 0.02 || h < 0.02) return null;
  const box = { x: x * designer.W, y: y * designer.H, w: w * designer.W, h: h * designer.H };
  return { name, els: registry[name](box, raw) };
}

/**
 * @param {string} userPrompt
 * @param {object} ctx  aspect, bgColor, canvas {w,h}, existing[], groups[]
 * @param {{resolveImage?:(url:string)=>Promise<{url:string}>}} [deps]
 */
async function generate(userPrompt, ctx = {}, deps = {}) {
  const resolveImage = deps.resolveImage || imageService.importFromUrl;
  const bgColor = HEX.test(ctx.bgColor || '') ? ctx.bgColor : '#1a2540';
  const dark = luminance(bgColor) < 0.5;
  const defaults = { stroke: dark ? '#4db8d8' : '#0f4c81', text: dark ? '#ffffff' : '#0f172a' };

  const W = clamp(num(ctx.canvas?.w, 1600), 400, 6000), H = clamp(num(ctx.canvas?.h, 900), 300, 4000);
  const existing = (Array.isArray(ctx.existing) ? ctx.existing : []).slice(0, MAX_CONTEXT)
    .filter(e => ID_RE.test(String(e?.id ?? '')))
    .map(e => ({
      id: String(e.id), t: str(e.t, 12), st: STICKERS.has(e.st) ? e.st : '', x: num(e.x).toFixed(2), y: num(e.y).toFixed(2),
      w: num(e.w).toFixed(2), h: num(e.h).toFixed(2), text: str(e.text, 40), color: color(e.color, ''), fill: color(e.fill, ''),
      labelOf: ID_RE.test(String(e.labelOf ?? '')) ? String(e.labelOf) : '', g: ID_RE.test(String(e.g ?? '')) ? String(e.g) : '',
      src: LOCAL_SRC.test(String(e.src ?? '')) ? String(e.src) : '',
    }));
  const groups = (Array.isArray(ctx.groups) ? ctx.groups : []).slice(0, 40)
    .filter(g => ID_RE.test(String(g?.g ?? '')))
    .map(g => ({ g: String(g.g), n: str(g.n, 24), x: num(g.x).toFixed(2), y: num(g.y).toFixed(2), w: num(g.w).toFixed(2), h: num(g.h).toFixed(2), count: Math.round(num(g.count)) }));
  const ids = new Set(existing.map(e => e.id)), groupIds = new Set(groups.map(g => g.g));
  const stickerById = new Map(existing.filter(e => e.st).map(e => [e.id, e.st]));

  const system = prompts.whiteboardSystem({
    aspect: str(ctx.aspect, 12) || '16:9', bgColor, existing, groups,
    stickers: Object.keys(STICKER_PROPS), templates: design.TEMPLATE_NAMES, components: design.COMPONENT_NAMES, icons: design.ICON_NAMES,
  });
  const promptText = str(userPrompt, 800);
  const data = await aiService.chatJson(
    [{ role: 'system', content: system }, { role: 'user', content: promptText }],
    { maxTokens: 6000, temperature: 0.3 },
  );

  // ── Ajouts : éléments simples + composants + gabarits ─────────────────────────────────────────────
  const warnings = [];
  const designer = design.create({ W, H, theme: data.theme && typeof data.theme === 'object' ? data.theme : {} });
  const elements = [];
  let groupSeq = 0;
  for (const raw of (Array.isArray(data.elements) ? data.elements : []).slice(0, MAX_RAW)) {
    if (!raw || typeof raw !== 'object' || elements.length >= MAX_TOTAL) continue;
    const kind = String(raw.kind || '').toLowerCase();
    if (kind === 'component' || kind === 'template') {
      let out = null;
      try { out = expand({ ...raw, kind }, designer); } catch (e) { warnings.push(`« ${str(raw.name, 24)} » n'a pas pu être dessiné.`); }
      if (!out) { if (!warnings.length) warnings.push(`Composant inconnu ignoré : ${str(raw.name, 24)}.`); continue; }
      const g = `g${++groupSeq}`;
      for (const el of out.els) {
        const clean = sanitizeElement(el, defaults);
        if (clean && elements.length < MAX_TOTAL) elements.push({ ...clean, g, n: out.name });
      }
    } else {
      const clean = sanitizeElement(raw, defaults);
      if (clean) elements.push(clean);
    }
  }

  // ── Images : liens suivis seulement s'ils sont dans le message ; importés par le serveur ──────────────
  const allowed = urlsInPrompt(promptText);
  const wanted = [...new Set(elements.filter(e => e.kind === 'ui' && e.sticker === 'image' && /^https:/i.test(e.props.src || '')).map(e => e.props.src))];
  const resolved = new Map();
  await Promise.all(wanted.slice(0, MAX_IMAGES).map(async (url) => {
    if (!allowed.has(url.replace(/[.,;:!?]+$/, ''))) { warnings.push("Un lien d'image a été ignoré : il ne figure pas dans votre message."); return; }
    try { resolved.set(url, (await resolveImage(url)).url); }
    catch (e) { warnings.push(`Image non chargée (${e.message || 'erreur'}) : un cadre vide a été placé.`); }
  }));
  for (const e of elements) {
    if (e.kind !== 'ui' || e.sticker !== 'image' || !/^https:/i.test(e.props.src || '')) continue;
    if (resolved.has(e.props.src)) e.props.src = resolved.get(e.props.src); else delete e.props.src;
  }

  // ── Modifications et organisation ─────────────────────────────────────────────────────────────────
  const updates = (Array.isArray(data.updates) ? data.updates : []).slice(0, MAX_UPDATES)
    .map(u => {
      const clean = sanitizeUpdate(u, ids, groupIds, stickerById);
      if (clean && u?.props && clean.props && clean.props.src && /^https:/i.test(clean.props.src)) delete clean.props.src;   // pas de lien direct en modification
      return clean;
    }).filter(Boolean);
  const deletes = idList(data.deletes, ids, groupIds, MAX_DELETES);
  const order = {
    front: idList(data.order?.front, ids, groupIds, 40), back: idList(data.order?.back, ids, groupIds, 40),
  };
  const align = (Array.isArray(data.align) ? data.align : []).slice(0, 10).map(a => ({
    ids: idList(a?.ids, ids, groupIds, 40), mode: ['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(a?.mode) ? a.mode : '',
  })).filter(a => a.ids.length >= 2 && a.mode);
  const distribute = (Array.isArray(data.distribute) ? data.distribute : []).slice(0, 10).map(a => ({
    ids: idList(a?.ids, ids, groupIds, 40), axis: a?.axis === 'v' ? 'v' : 'h',
  })).filter(a => a.ids.length >= 3);
  const clear = data.clear === true;                       // effacer tout exige un vrai booléen true (pas la chaîne « true »)

  const changed = elements.length || updates.length || deletes.length || order.front.length || order.back.length || align.length || distribute.length || clear;
  let message = str(data.message, 320) || (changed ? 'Voici la modification demandée.' : "Je n'ai rien pu faire pour cette demande.");
  if (warnings.length) message += ' — ' + [...new Set(warnings)].slice(0, 2).join(' ');
  return { message, elements, updates, deletes, order, align, distribute, clear };
}

module.exports = { generate, sanitizeElement, sanitizeUpdate, sanitizeProps, urlsInPrompt, STICKERS: [...STICKERS] };
