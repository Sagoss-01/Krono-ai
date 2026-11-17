/**
 * src/services/aiDesignLibrary.js
 * Bibliothèque de design pour l'IA du tableau blanc : icônes, composants d'interface et gabarits de pages.
 * L'IA décrit « un composant » ou « un gabarit » en quelques champs ; ce module le transforme en dizaines
 * d'éléments simples (rectangles, textes, traits…) → maquettes soignées, cohérentes et peu coûteuses en
 * tokens, même avec un modèle gratuit. Toutes les coordonnées de sortie sont normalisées (0..1).
 */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const arr = (v, n = 12) => (Array.isArray(v) ? v : []).slice(0, n);

const THEMES = {
  light: { bg: '#ffffff', surface: '#f1f5f9', card: '#ffffff', border: '#e2e8f0', text: '#0f172a', muted: '#64748b', primary: '#2563eb', onPrimary: '#ffffff', accent: '#f59e0b', danger: '#ef4444', success: '#16a34a', dark: '#0f172a', onDark: '#f8fafc' },
  dark:  { bg: '#0f172a', surface: '#1e293b', card: '#172036', border: '#334155', text: '#f1f5f9', muted: '#94a3b8', primary: '#38bdf8', onPrimary: '#04202b', accent: '#fbbf24', danger: '#f87171', success: '#4ade80', dark: '#020617', onDark: '#f8fafc' },
};

/** Thème : base « light » ou « dark », avec surcharges de couleurs valides. */
function buildTheme(raw = {}) {
  const base = THEMES[raw.mode === 'dark' ? 'dark' : 'light'];
  const out = { ...base };
  for (const k of Object.keys(base)) if (HEX.test(raw[k] || '')) out[k] = raw[k];
  return out;
}

// ── Icônes : tracés dans un carré unité [0..1] (l = polyligne, c = cercle) ─────────────────────────────
const star = (() => { const p = []; for (let i = 0; i < 11; i++) { const r = i % 2 ? 0.2 : 0.46, a = -Math.PI / 2 + i * Math.PI / 5; p.push([0.5 + r * Math.cos(a), 0.54 + r * Math.sin(a)]); } return p; })();
const ICONS = {
  search: [['c', 0.42, 0.42, 0.28], ['l', [[0.62, 0.62], [0.9, 0.9]]]],
  cart: [['l', [[0.05, 0.15], [0.2, 0.15], [0.3, 0.65], [0.8, 0.65], [0.9, 0.3], [0.24, 0.3]]], ['c', 0.38, 0.84, 0.07], ['c', 0.72, 0.84, 0.07]],
  bag: [['l', [[0.2, 0.3], [0.8, 0.3], [0.9, 0.9], [0.1, 0.9], [0.2, 0.3]]], ['l', [[0.35, 0.3], [0.35, 0.2], [0.65, 0.2], [0.65, 0.3]]]],
  user: [['c', 0.5, 0.3, 0.2], ['l', [[0.12, 0.92], [0.15, 0.72], [0.3, 0.6], [0.7, 0.6], [0.85, 0.72], [0.88, 0.92]]]],
  heart: [['l', [[0.5, 0.9], [0.15, 0.5], [0.12, 0.3], [0.25, 0.15], [0.4, 0.18], [0.5, 0.32], [0.6, 0.18], [0.75, 0.15], [0.88, 0.3], [0.85, 0.5], [0.5, 0.9]]]],
  menu: [['l', [[0.1, 0.25], [0.9, 0.25]]], ['l', [[0.1, 0.5], [0.9, 0.5]]], ['l', [[0.1, 0.75], [0.9, 0.75]]]],
  home: [['l', [[0.1, 0.5], [0.5, 0.12], [0.9, 0.5]]], ['l', [[0.2, 0.45], [0.2, 0.88], [0.8, 0.88], [0.8, 0.45]]], ['l', [[0.42, 0.88], [0.42, 0.62], [0.58, 0.62], [0.58, 0.88]]]],
  mail: [['l', [[0.08, 0.2], [0.92, 0.2], [0.92, 0.8], [0.08, 0.8], [0.08, 0.2]]], ['l', [[0.08, 0.2], [0.5, 0.55], [0.92, 0.2]]]],
  star: [['l', star]],
  check: [['l', [[0.18, 0.52], [0.42, 0.76], [0.84, 0.26]]]],
  close: [['l', [[0.2, 0.2], [0.8, 0.8]]], ['l', [[0.8, 0.2], [0.2, 0.8]]]],
  plus: [['l', [[0.5, 0.15], [0.5, 0.85]]], ['l', [[0.15, 0.5], [0.85, 0.5]]]],
  arrow_right: [['l', [[0.12, 0.5], [0.88, 0.5]]], ['l', [[0.62, 0.24], [0.88, 0.5], [0.62, 0.76]]]],
  settings: [['c', 0.5, 0.5, 0.16], ['c', 0.5, 0.5, 0.36]],
  bell: [['l', [[0.2, 0.72], [0.28, 0.7], [0.3, 0.45], [0.5, 0.2], [0.7, 0.45], [0.72, 0.7], [0.8, 0.72], [0.2, 0.72]]], ['l', [[0.42, 0.84], [0.58, 0.84]]]],
  truck: [['l', [[0.05, 0.3], [0.6, 0.3], [0.6, 0.7], [0.05, 0.7], [0.05, 0.3]]], ['l', [[0.6, 0.42], [0.85, 0.42], [0.95, 0.58], [0.95, 0.7], [0.6, 0.7]]], ['c', 0.25, 0.76, 0.08], ['c', 0.78, 0.76, 0.08]],
  shield: [['l', [[0.5, 0.08], [0.85, 0.22], [0.82, 0.55], [0.5, 0.92], [0.18, 0.55], [0.15, 0.22], [0.5, 0.08]]], ['l', [[0.35, 0.5], [0.46, 0.62], [0.67, 0.38]]]],
  tag: [['l', [[0.1, 0.1], [0.55, 0.1], [0.92, 0.47], [0.55, 0.9], [0.1, 0.45], [0.1, 0.1]]], ['c', 0.3, 0.3, 0.06]],
  location: [['l', [[0.5, 0.92], [0.2, 0.5], [0.2, 0.3], [0.35, 0.12], [0.65, 0.12], [0.8, 0.3], [0.8, 0.5], [0.5, 0.92]]], ['c', 0.5, 0.34, 0.1]],
  clock: [['c', 0.5, 0.5, 0.4], ['l', [[0.5, 0.25], [0.5, 0.5], [0.7, 0.6]]]],
  chat: [['l', [[0.1, 0.15], [0.9, 0.15], [0.9, 0.7], [0.45, 0.7], [0.25, 0.9], [0.25, 0.7], [0.1, 0.7], [0.1, 0.15]]]],
  credit_card: [['l', [[0.06, 0.22], [0.94, 0.22], [0.94, 0.78], [0.06, 0.78], [0.06, 0.22]]], ['l', [[0.06, 0.4], [0.94, 0.4]]]],
  lock: [['l', [[0.2, 0.45], [0.8, 0.45], [0.8, 0.9], [0.2, 0.9], [0.2, 0.45]]], ['l', [[0.3, 0.45], [0.3, 0.3], [0.4, 0.15], [0.6, 0.15], [0.7, 0.3], [0.7, 0.45]]]],
  globe: [['c', 0.5, 0.5, 0.4], ['l', [[0.1, 0.5], [0.9, 0.5]]], ['l', [[0.5, 0.1], [0.5, 0.9]]]],
  chart: [['l', [[0.1, 0.9], [0.1, 0.1]]], ['l', [[0.1, 0.9], [0.9, 0.9]]], ['l', [[0.2, 0.7], [0.4, 0.5], [0.58, 0.62], [0.85, 0.25]]]],
  package: [['l', [[0.5, 0.08], [0.9, 0.28], [0.9, 0.72], [0.5, 0.92], [0.1, 0.72], [0.1, 0.28], [0.5, 0.08]]], ['l', [[0.1, 0.28], [0.5, 0.5], [0.9, 0.28]]], ['l', [[0.5, 0.5], [0.5, 0.92]]]],
};
const ICON_NAMES = Object.keys(ICONS);

/**
 * Fabrique un « dessinateur » : toutes les mesures de mise en page sont en pixels, la sortie est normalisée.
 * @param {{W?:number,H?:number,theme?:object}} o
 */
function create({ W = 1600, H = 900, theme = {} } = {}) {
  W = clamp(Number(W) || 1600, 400, 6000); H = clamp(Number(H) || 900, 300, 4000);
  const th = buildTheme(theme);
  const nx = (p) => clamp(p / W, 0, 1), ny = (p) => clamp(p / H, 0, 1);
  /** Mélange `hex` sur `base` avec une opacité `a` → couleur pleine #RRGGBB (le tableau n'accepte pas #RRGGBBAA). */
  const mix = (hex, base, a) => {
    const c = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    const ch = (i) => Math.round(c(hex, i) * a + c(base, i) * (1 - a)).toString(16).padStart(2, '0');
    return '#' + ch(0) + ch(1) + ch(2);
  };
  const CHAR = 0.6;                                                    // largeur moyenne d'un caractère / taille de police
  const sizeFor = (fontPx) => clamp(Math.round(fontPx / 5), 2, 12);
  const textW = (t, fontPx) => String(t).length * CHAR * fontPx;
  const fitPx = (t, maxW, maxPx, minPx = 10) => clamp(Math.min(maxPx, maxW / Math.max(1, String(t).length * CHAR)), minPx, maxPx);

  // ── Briques élémentaires (entrées en pixels) ───────────────────────────────────────────────────────
  const rect = (x, y, w, h, o = {}) => ({
    kind: o.round ? 'ellipse' : 'rect', x: nx(x), y: ny(y), w: Math.max(0.002, nx(w)), h: Math.max(0.002, ny(h)),
    fill: o.fill, color: o.stroke || o.fill || th.border, radius: o.r ?? 0, strokeSize: o.sw ?? 1, noStroke: !o.stroke,
    ...(o.dash ? { dash: o.dash } : {}), ...(o.opacity ? { opacity: o.opacity } : {}),
  });
  const line = (x1, y1, x2, y2, o = {}) => ({ kind: 'line', x1: nx(x1), y1: ny(y1), x2: nx(x2), y2: ny(y2), color: o.color || th.border, strokeSize: o.sw ?? 1, ...(o.dash ? { dash: o.dash } : {}) });
  const text = (t, x, y, o = {}) => {
    const px = o.px ?? 14;
    return { kind: 'text', text: str(t, 120), x: nx(x), y: ny(y), size: sizeFor(px), color: o.color || th.text, bold: !!o.bold, italic: !!o.italic, align: o.align || 'left' };
  };
  /** Texte vertical-centré dans une ligne de hauteur h (baseline « top » du tableau). */
  const textMid = (t, x, y, h, o = {}) => text(t, x, y + (h - Math.max(10, sizeFor(o.px ?? 14) * 5) * 1.25) / 2 + 1, o);
  const poly = (pts, o = {}) => ({ kind: 'freehand', points: pts.map(([x, y]) => [nx(x), ny(y)]), color: o.color || th.text, strokeSize: o.sw ?? 2 });
  const ui = (sticker, x, y, w, h, o = {}) => ({ kind: 'ui', sticker, x: nx(x), y: ny(y), w: nx(w), h: ny(h), color: o.color || th.muted, props: o.props || {} });

  // ── Icône dans une boîte carrée (px) ─────────────────────────────────────────────────────────────────
  const iconAt = (name, x, y, s, o = {}) => {
    const def = ICONS[name] || ICONS.star, out = [];
    const color = o.color || th.text, sw = o.sw ?? Math.max(1.5, s / 14);
    for (const part of def) {
      if (part[0] === 'l') out.push(poly(part[1].map(([u, v]) => [x + u * s, y + v * s]), { color, sw }));
      else out.push(rect(x + (part[1] - part[3]) * s, y + (part[2] - part[3]) * s, part[3] * 2 * s, part[3] * 2 * s, { round: true, stroke: color, sw }));
    }
    return out;
  };

  const button = (x, y, w, h, label, o = {}) => {
    const v = o.variant || 'primary';
    const fill = v === 'primary' ? (o.color || th.primary) : v === 'dark' ? th.dark : v === 'accent' ? th.accent : undefined;
    const txt = v === 'primary' ? th.onPrimary : v === 'dark' ? th.onDark : v === 'accent' ? th.dark : (o.color || th.primary);
    const px = fitPx(label, w - 20, Math.min(16, h * 0.42), 10);
    return [
      rect(x, y, w, h, { fill, stroke: v === 'outline' ? (o.color || th.primary) : undefined, r: o.r ?? Math.min(10, h / 3), sw: 1.5 }),
      textMid(label, x + w / 2, y, h, { px, bold: true, color: txt, align: 'center' }),
    ];
  };

  const pill = (x, y, label, o = {}) => {
    const px = o.px ?? 11, w = textW(label, px) + 18, h = px + 12;
    return { w, els: [rect(x, y, w, h, { fill: o.fill || th.danger, r: h / 2 }), textMid(label, x + w / 2, y, h, { px, bold: true, color: o.color || '#ffffff', align: 'center' })] };
  };

  const stars = (x, y, n, o = {}) => {
    const full = clamp(Math.round(Number(n) || 4), 0, 5), px = o.px ?? 13;
    return [text('★'.repeat(full) + '☆'.repeat(5 - full), x, y, { px, color: th.accent })];
  };

  // ── Composants (entrée : boîte normalisée + paramètres ; sortie : éléments) ─────────────────────────────
  const C = {};

  C.icon = (b, p) => {
    const s = Math.min(b.w, b.h);
    return iconAt(String(p.name), b.x + (b.w - s) / 2, b.y + (b.h - s) / 2, s, { color: HEX.test(p.color || '') ? p.color : th.text });
  };

  C.button = (b, p) => button(b.x, b.y, b.w, b.h, str(p.label || 'Bouton', 40), { variant: ['primary', 'outline', 'dark', 'accent'].includes(p.variant) ? p.variant : 'primary' });

  C.badge = (b, p) => pill(b.x, b.y, str(p.label || 'Promo', 24), { fill: HEX.test(p.color || '') ? p.color : th.danger }).els;

  C.stars = (b, p) => stars(b.x, b.y, p.rating ?? 4, { px: clamp(b.h * 0.8, 10, 30) });

  C.searchbar = (b, p) => {
    const iconS = Math.min(20, b.h * 0.5);
    return [
      rect(b.x, b.y, b.w, b.h, { fill: th.surface, stroke: th.border, r: b.h / 2 }),
      ...iconAt('search', b.x + 14, b.y + (b.h - iconS) / 2, iconS, { color: th.muted }),
      textMid(str(p.placeholder || 'Rechercher un produit…', 60), b.x + 14 + iconS + 10, b.y, b.h, { px: fitPx('Rechercher un produit…', b.w - 60, 14), color: th.muted }),
    ];
  };

  C.breadcrumb = (b, p) => [text(arr(p.items, 6).map(i => str(i, 24)).join('  /  ') || 'Accueil  /  Catégorie', b.x, b.y, { px: 12, color: th.muted })];

  C.section_title = (b, p) => {
    const align = p.align === 'center' ? 'center' : 'left', ax = align === 'center' ? b.x + b.w / 2 : b.x;
    const out = [text(str(p.title || 'Titre de section', 60), ax, b.y, { px: clamp(b.h * 0.5, 16, 30), bold: true, align })];
    if (p.subtitle) out.push(text(str(p.subtitle, 100), ax, b.y + clamp(b.h * 0.5, 16, 30) * 1.4, { px: 13, color: th.muted, align }));
    return out;
  };

  C.navbar = (b, p) => {
    const dark = !!p.dark, bg = dark ? th.dark : th.card, fg = dark ? th.onDark : th.text;
    const out = [rect(b.x, b.y, b.w, b.h, { fill: bg }), line(b.x, b.y + b.h, b.x + b.w, b.y + b.h, { color: th.border })];
    const pad = 22, px = clamp(b.h * 0.36, 12, 18);
    const brand = str(p.brand || 'Marque', 24), brandPx = clamp(b.h * 0.42, 14, 24);
    out.push(textMid(brand, b.x + pad, b.y, b.h, { px: brandPx, bold: true, color: dark ? th.onDark : th.primary }));
    // actions à droite (icônes + bouton)
    let right = b.x + b.w - pad;
    if (p.cta) { const bw = textW(p.cta, px) + 36, bh = b.h * 0.56; right -= bw; out.push(...button(right, b.y + (b.h - bh) / 2, bw, bh, str(p.cta, 24), { variant: dark ? 'accent' : 'primary' })); right -= 18; }
    const iconS = clamp(b.h * 0.4, 16, 24);
    for (const name of arr(p.icons, 4).reverse()) {
      if (!ICONS[name]) continue;
      right -= iconS; out.push(...iconAt(name, right, b.y + (b.h - iconS) / 2, iconS, { color: fg })); right -= 16;
    }
    // liens au centre
    let cx = b.x + pad + textW(brand, brandPx) + 48;
    for (const item of arr(p.items, 7)) {
      const t = str(item, 20), w = textW(t, px);
      if (cx + w > right - 12) break;
      out.push(textMid(t, cx, b.y, b.h, { px, color: fg })); cx += w + 28;
    }
    return out;
  };

  C.hero = (b, p) => {
    const tone = ['dark', 'primary', 'light'].includes(p.tone) ? p.tone : 'light';
    const bg = tone === 'dark' ? th.dark : tone === 'primary' ? th.primary : th.surface;
    const fg = tone === 'light' ? th.text : (tone === 'primary' ? th.onPrimary : th.onDark);
    const sub = tone === 'light' ? th.muted : fg;
    const hasImg = p.image !== false, pad = Math.min(48, b.w * 0.04);
    const textW_ = hasImg ? b.w * 0.5 - pad : b.w - pad * 2;
    const out = [rect(b.x, b.y, b.w, b.h, { fill: bg, r: p.rounded ? 16 : 0 })];
    const title = str(p.title || 'Un titre qui donne envie', 80);
    const tPx = clamp(Math.min(b.h * 0.15, (textW_ / Math.max(8, title.length * 0.5)) * 0.9), 20, 52);
    const lines = wrap(title, textW_, tPx), lh = Math.round(tPx * 1.25);
    let y = b.y + Math.max(pad * 0.8, (b.h - (lines.length * lh + (p.subtitle ? 60 : 0) + 64)) / 2);
    lines.forEach((l, i) => out.push(text(l, b.x + pad, y + i * lh, { px: tPx, bold: true, color: fg })));
    y += lines.length * lh + 12;
    if (p.subtitle) { const sl = wrap(str(p.subtitle, 160), textW_, 15); sl.forEach((l, i) => out.push(text(l, b.x + pad, y + i * 20, { px: 15, color: sub }))); y += sl.length * 20 + 16; }
    if (p.cta) { const bw = Math.max(150, textW(p.cta, 15) + 40); out.push(...button(b.x + pad, y, bw, 44, str(p.cta, 28), { variant: tone === 'light' ? 'primary' : 'accent' })); if (p.secondary) out.push(...button(b.x + pad + bw + 14, y, Math.max(130, textW(p.secondary, 15) + 36), 44, str(p.secondary, 28), { variant: 'outline', color: fg })); }
    if (hasImg) out.push(ui('image', b.x + b.w * 0.54, b.y + pad * 0.7, b.w * 0.42, b.h - pad * 1.4, { color: tone === 'light' ? th.muted : th.onDark, props: p.src ? { src: p.src } : {} }));
    return out;
  };

  C.product_card = (b, p) => {
    const out = [rect(b.x, b.y, b.w, b.h, { fill: th.card, stroke: th.border, r: 12 })];
    const m = 10, imgH = b.h * 0.5;
    out.push(ui('image', b.x + m, b.y + m, b.w - m * 2, imgH, { color: th.muted, props: p.src ? { src: p.src } : {} }));
    if (p.badge) out.push(...pill(b.x + m + 8, b.y + m + 8, str(p.badge, 14), { px: 10 }).els);
    const hs = 28;
    out.push(rect(b.x + b.w - m - hs - 6, b.y + m + 6, hs, hs, { fill: '#ffffff', round: true, stroke: th.border }), ...iconAt('heart', b.x + b.w - m - hs - 6 + 6, b.y + m + 12, 16, { color: th.danger }));
    let y = b.y + m + imgH + 10;
    const name = str(p.name || 'Nom du produit', 40), nPx = fitPx(name, b.w - 20, 15, 11);
    out.push(text(name, b.x + m, y, { px: nPx, bold: true })); y += nPx * 1.4 + 2;
    out.push(...stars(b.x + m, y, p.rating ?? 4, { px: 12 })); y += 18;
    const price = str(p.price || '29,90 €', 14);
    out.push(text(price, b.x + m, y, { px: 18, bold: true, color: th.primary }));
    if (p.oldPrice) { const ox = b.x + m + textW(price, 18) + 10, old = str(p.oldPrice, 14); out.push(text(old, ox, y + 3, { px: 13, color: th.muted }), line(ox, y + 11, ox + textW(old, 13), y + 11, { color: th.muted })); }
    const bh = clamp(b.h * 0.12, 28, 38);
    out.push(...button(b.x + m, b.y + b.h - m - bh, b.w - m * 2, bh, str(p.button || 'Ajouter au panier', 24), { variant: 'primary', r: 8 }));
    return out;
  };

  C.product_grid = (b, p) => {
    const products = arr(p.products, 12);
    const cols = clamp(Math.round(Number(p.cols) || Math.min(4, Math.max(2, products.length || 4))), 1, 6);
    const rows = clamp(Math.round(Number(p.rows) || Math.ceil((products.length || cols) / cols)), 1, 3);
    const gap = 18, cw = (b.w - gap * (cols - 1)) / cols, ch = (b.h - gap * (rows - 1)) / rows;
    const out = [];
    for (let i = 0; i < cols * rows; i++) {
      const pr = products[i] || { name: `Produit ${i + 1}`, price: `${19 + i * 10},90 €`, rating: 4 };
      out.push(...C.product_card({ x: b.x + (i % cols) * (cw + gap), y: b.y + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }, pr));
    }
    return out;
  };

  C.category_tiles = (b, p) => {
    const items = arr(p.items, 6).length ? arr(p.items, 6) : ['Femme', 'Homme', 'Enfant', 'Accessoires'];
    const gap = 16, w = (b.w - gap * (items.length - 1)) / items.length, out = [];
    items.forEach((it, i) => {
      const x = b.x + i * (w + gap);
      out.push(rect(x, b.y, w, b.h, { fill: th.surface, r: 14 }), ui('image', x + 10, b.y + 10, w - 20, b.h - 54, { color: th.muted }), textMid(str(it, 22), x + w / 2, b.y + b.h - 40, 34, { px: 14, bold: true, align: 'center' }));
    });
    return out;
  };

  C.feature_row = (b, p) => {
    const items = arr(p.items, 4).length ? arr(p.items, 4) : [{ icon: 'truck', title: 'Livraison offerte', text: 'Dès 50 € d\'achat' }, { icon: 'shield', title: 'Paiement sécurisé', text: '100 % protégé' }, { icon: 'package', title: 'Retours gratuits', text: 'Sous 30 jours' }];
    const w = b.w / items.length, out = [];
    items.forEach((it, i) => {
      const x = b.x + i * w, s = Math.min(40, b.h * 0.7);
      out.push(rect(x + 8, b.y + (b.h - s) / 2, s, s, { fill: th.surface, round: true }), ...iconAt(ICONS[it.icon] ? it.icon : 'star', x + 8 + s * 0.22, b.y + (b.h - s) / 2 + s * 0.22, s * 0.56, { color: th.primary }),
        text(str(it.title, 28), x + s + 20, b.y + b.h / 2 - 18, { px: 14, bold: true }), text(str(it.text, 40), x + s + 20, b.y + b.h / 2 + 2, { px: 12, color: th.muted }));
    });
    return out;
  };

  C.banner = (b, p) => {
    const bg = HEX.test(p.color || '') ? p.color : th.accent;
    const out = [rect(b.x, b.y, b.w, b.h, { fill: bg, r: 14 })];
    const title = str(p.title || 'Offre spéciale', 60);
    const room = b.w - 60 - (p.cta ? textW(p.cta, 14) + 70 : 0);                 // largeur dispo : on réserve la place du bouton
    const tPx = fitPx(title, room, clamp(b.h * 0.26, 16, 34), 11);
    out.push(text(title, b.x + 30, b.y + b.h * 0.22, { px: tPx, bold: true, color: th.dark }));
    if (p.subtitle) out.push(text(str(p.subtitle, 100), b.x + 30, b.y + b.h * 0.22 + tPx * 1.5, { px: fitPx(p.subtitle, room, 14, 10), color: th.dark }));
    if (p.cta) { const bw = textW(p.cta, 14) + 40; out.push(...button(b.x + b.w - bw - 30, b.y + (b.h - 42) / 2, bw, 42, str(p.cta, 24), { variant: 'dark' })); }
    return out;
  };

  C.footer = (b, p) => {
    const out = [rect(b.x, b.y, b.w, b.h, { fill: th.dark })];
    if (b.h < 150) {                                                  // version compacte : une seule ligne
      const pad = 40, ty = b.y + (b.h - 18) / 2, links = arr(p.links, 4).length ? arr(p.links, 4) : ['À propos', 'Aide', 'Contact', 'Mentions légales'];
      out.push(text(str(p.brand || 'Marque', 24), b.x + pad, b.y + (b.h - 26) / 2, { px: 20, bold: true, color: th.onDark }));
      let x = b.x + b.w * 0.34; links.forEach(l => { out.push(text(str(l, 22), x, ty, { px: 12, color: th.muted })); x += textW(l, 12) + 30; });
      const note = str(p.note || '© 2026 Marque', 40); out.push(text(note, b.x + b.w - pad - textW(note, 11), ty + 1, { px: 11, color: th.muted }));
      return out;
    }
    const cols = arr(p.columns, 4).length ? arr(p.columns, 4) : [{ title: 'Boutique', links: ['Nouveautés', 'Promotions', 'Cartes cadeaux'] }, { title: 'Aide', links: ['Livraison', 'Retours', 'Contact'] }, { title: 'Société', links: ['À propos', 'Carrières', 'Presse'] }];
    const pad = 40, brandW = b.w * 0.28;
    out.push(text(str(p.brand || 'Marque', 24), b.x + pad, b.y + 28, { px: 22, bold: true, color: th.onDark }), text(str(p.tagline || 'Votre boutique en ligne de confiance.', 60), b.x + pad, b.y + 62, { px: 12, color: th.muted }));
    const cw = (b.w - pad * 2 - brandW) / cols.length;
    cols.forEach((c, i) => {
      const x = b.x + pad + brandW + i * cw;
      out.push(text(str(c.title, 20), x, b.y + 28, { px: 13, bold: true, color: th.onDark }));
      arr(c.links, 5).forEach((l, j) => out.push(text(str(l, 24), x, b.y + 56 + j * 22, { px: 12, color: th.muted })));
    });
    out.push(line(b.x + pad, b.y + b.h - 38, b.x + b.w - pad, b.y + b.h - 38, { color: th.border }), text(str(p.note || '© 2026 Marque. Tous droits réservés.', 80), b.x + pad, b.y + b.h - 28, { px: 11, color: th.muted }));
    return out;
  };

  C.stat_card = (b, p) => {
    const delta = str(p.delta || '', 12), up = !/^-/.test(delta);
    return [
      rect(b.x, b.y, b.w, b.h, { fill: th.card, stroke: th.border, r: 12 }),
      text(str(p.label || 'Indicateur', 28), b.x + 16, b.y + 14, { px: 12, color: th.muted }),
      text(str(p.value || '1 280', 14), b.x + 16, b.y + b.h * 0.38, { px: clamp(b.h * 0.3, 18, 34), bold: true }),
      ...(delta ? [text(delta, b.x + 16, b.y + b.h - 26, { px: 12, bold: true, color: up ? th.success : th.danger })] : []),
    ];
  };

  C.chart_bars = (b, p) => {
    const vals = arr(p.values, 12).map(Number).filter(Number.isFinite); const data = vals.length ? vals : [40, 65, 52, 80, 70, 95, 60];
    const labels = arr(p.labels, 12), max = Math.max(...data, 1), out = [rect(b.x, b.y, b.w, b.h, { fill: th.card, stroke: th.border, r: 12 })];
    out.push(text(str(p.title || 'Évolution', 40), b.x + 16, b.y + 12, { px: 14, bold: true }));
    const top = b.y + 44, bottom = b.y + b.h - 28, bw = (b.w - 32) / data.length;
    for (let i = 0; i < 4; i++) out.push(line(b.x + 16, top + ((bottom - top) / 3) * i, b.x + b.w - 16, top + ((bottom - top) / 3) * i, { color: th.border, dash: 'dashed' }));
    data.forEach((v, i) => {
      const h = ((bottom - top) * v) / max;
      out.push(rect(b.x + 16 + i * bw + bw * 0.2, bottom - h, bw * 0.6, h, { fill: i === data.length - 1 ? th.primary : mix(th.primary, th.card, 0.5), r: 4 }));
      if (labels[i]) out.push(text(str(labels[i], 6), b.x + 16 + i * bw + bw / 2, bottom + 6, { px: 10, color: th.muted, align: 'center' }));
    });
    return out;
  };

  C.table_simple = (b, p) => {
    const headers = arr(p.headers, 6).length ? arr(p.headers, 6) : ['Nom', 'Statut', 'Date', 'Montant'];
    const rows = arr(p.rows, 8).length ? arr(p.rows, 8) : [['Commande #1042', 'Livrée', '12/10', '129,00 €'], ['Commande #1043', 'En cours', '13/10', '54,90 €'], ['Commande #1044', 'Payée', '14/10', '89,00 €']];
    const rh = clamp((b.h - 36) / (rows.length + 1), 28, 46), cw = b.w / headers.length, out = [rect(b.x, b.y, b.w, b.h, { fill: th.card, stroke: th.border, r: 12 }), rect(b.x, b.y, b.w, rh + 8, { fill: th.surface, r: 12 })];
    headers.forEach((h, i) => out.push(textMid(str(h, 18), b.x + 16 + i * cw, b.y + 4, rh, { px: 12, bold: true, color: th.muted })));
    rows.forEach((r, ri) => {
      const y = b.y + rh + 12 + ri * rh;
      out.push(line(b.x + 12, y, b.x + b.w - 12, y, { color: th.border }));
      arr(r, headers.length).forEach((cell, ci) => out.push(textMid(str(cell, 22), b.x + 16 + ci * cw, y, rh, { px: 13 })));
    });
    return out;
  };

  C.form = (b, p) => {
    const fields = arr(p.fields, 6).length ? arr(p.fields, 6) : [{ label: 'E-mail', placeholder: 'vous@exemple.com' }, { label: 'Mot de passe', placeholder: '••••••••' }];
    const out = [], fh = 44, gap = 22, label = 12;
    fields.forEach((f, i) => {
      const y = b.y + i * (fh + gap + label);
      out.push(text(str(f.label, 28), b.x, y, { px: label, bold: true }), rect(b.x, y + label + 6, b.w, fh, { fill: th.card, stroke: th.border, r: 10 }), textMid(str(f.placeholder || '', 40), b.x + 14, y + label + 6, fh, { px: 14, color: th.muted }));
    });
    out.push(...button(b.x, b.y + fields.length * (fh + gap + label), b.w, 46, str(p.submit || 'Valider', 30), { variant: 'primary' }));
    return out;
  };

  C.sidebar_menu = (b, p) => {
    const items = arr(p.items, 8).length ? arr(p.items, 8) : ['Tableau de bord', 'Commandes', 'Produits', 'Clients', 'Paramètres'];
    const icons = ['home', 'package', 'tag', 'user', 'settings', 'chart', 'mail', 'bell'];
    const out = [rect(b.x, b.y, b.w, b.h, { fill: th.dark }), text(str(p.brand || 'Marque', 20), b.x + 22, b.y + 24, { px: 20, bold: true, color: th.onDark })];
    const active = clamp(Number(p.active) || 0, 0, items.length - 1);
    items.forEach((it, i) => {
      const y = b.y + 80 + i * 46;
      if (i === active) out.push(rect(b.x + 10, y - 6, b.w - 20, 38, { fill: mix(th.primary, th.dark, 0.28), r: 8 }));
      out.push(...iconAt(icons[i % icons.length], b.x + 22, y + 2, 20, { color: i === active ? th.primary : th.muted }), textMid(str(it, 22), b.x + 54, y - 6, 38, { px: 14, bold: i === active, color: i === active ? th.onDark : th.muted }));
    });
    return out;
  };

  C.topbar = (b, p) => [
    rect(b.x, b.y, b.w, b.h, { fill: th.card }), line(b.x, b.y + b.h, b.x + b.w, b.y + b.h, { color: th.border }),
    textMid(str(p.title || 'Tableau de bord', 40), b.x + 24, b.y, b.h, { px: 20, bold: true }),
    ...C.searchbar({ x: b.x + b.w - 440, y: b.y + (b.h - 38) / 2, w: 300, h: 38 }, { placeholder: 'Rechercher…' }),
    ...iconAt('bell', b.x + b.w - 116, b.y + (b.h - 22) / 2, 22, { color: th.muted }),
    rect(b.x + b.w - 70, b.y + (b.h - 36) / 2, 36, 36, { fill: th.primary, round: true }), textMid('AB', b.x + b.w - 52, b.y + (b.h - 36) / 2, 36, { px: 13, bold: true, color: th.onPrimary, align: 'center' }),
  ];

  C.browser_frame = (b, p) => {
    const bar = 34, out = [rect(b.x, b.y, b.w, b.h, { fill: th.bg, stroke: th.border, r: 12, sw: 1.5 }), rect(b.x, b.y, b.w, bar, { fill: th.surface, stroke: th.border, r: 12 }), rect(b.x, b.y + 14, b.w, bar - 14, { fill: th.surface })];
    ['#f87171', '#f59e0b', '#22c55e'].forEach((c, i) => out.push(rect(b.x + 14 + i * 18, b.y + 11, 12, 12, { fill: c, round: true })));
    out.push(rect(b.x + 90, b.y + 7, Math.min(520, b.w - 130), 20, { fill: th.bg, stroke: th.border, r: 10 }), text(str(p.url || 'https://exemple.com', 50), b.x + 104, b.y + 11, { px: 11, color: th.muted }));
    return out;
  };


  C.phone_frame = (b, p) => {
    const out = [rect(b.x, b.y, b.w, b.h, { fill: th.bg, stroke: th.dark, r: Math.min(36, b.w * 0.12), sw: 4 })];
    out.push(rect(b.x + b.w / 2 - 38, b.y + 10, 76, 18, { fill: th.dark, r: 9 }));
    out.push(text(str(p.time || '9:41', 6), b.x + 26, b.y + 12, { px: 12, bold: true }));
    return out;
  };

  // Retour à la ligne simple (pixels)
  function wrap(t, maxW, px) {
    const words = String(t).split(/\s+/), lines = []; let cur = '';
    for (const w of words) {
      if (cur && textW(cur + ' ' + w, px) > maxW) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 4);
  }

  // ── Gabarits de pages ──────────────────────────────────────────────────────────────────────────────
  const T = {};
  const inner = (b) => { const bar = 34; return { x: b.x + 2, y: b.y + bar, w: b.w - 4, h: b.h - bar - 2 }; };
  const stack = (area, parts) => {                                       // parts : [[clé, poids], …] → boîtes empilées
    const total = parts.reduce((s, [, w]) => s + w, 0), out = {}; let y = area.y;
    for (const [k, w] of parts) { const h = (area.h * w) / total; out[k] = { x: area.x, y, w: area.w, h }; y += h; }
    return out;
  };
  const padBox = (b, px, py = px) => ({ x: b.x + px, y: b.y + py, w: b.w - px * 2, h: b.h - py * 2 });

  T.ecommerce_home = (b, p) => {
    const a = inner(b), compact = b.h < 520, out = [...C.browser_frame(b, { url: `https://www.${str(p.brand || 'boutique', 20).toLowerCase().replace(/[^a-z0-9]/g, '')}.com` })];
    out.push(rect(a.x, a.y, a.w, a.h, { fill: th.bg }));
    const parts = compact ? [['nav', 9], ['hero', 30], ['title', 7], ['grid', 40], ['footer', 14]] : [['nav', 8], ['hero', 25], ['feat', 7], ['title', 6], ['grid', 34], ['footer', 20]];
    const s = stack(a, parts), hero = p.hero || {};
    out.push(...C.navbar(s.nav, { brand: p.brand || 'Boutique', items: p.menu || ['Nouveautés', 'Femme', 'Homme', 'Promotions'], icons: ['search', 'user', 'heart', 'cart'] }));
    out.push(...C.hero(padBox(s.hero, 0), { title: hero.title || 'Collection automne : jusqu\'à -40 %', subtitle: hero.subtitle || 'Des pièces essentielles livrées chez vous en 48 h.', cta: hero.cta || 'Découvrir', secondary: hero.secondary, tone: 'light', src: hero.src }));
    if (s.feat) out.push(...C.feature_row(padBox(s.feat, 30, 4), {}));
    out.push(...C.section_title({ x: s.title.x + 30, y: s.title.y + 8, w: s.title.w - 60, h: s.title.h - 8 }, { title: p.productsTitle || 'Produits populaires' }));
    out.push(...C.product_grid(padBox(s.grid, 30, 6), { products: p.products, cols: p.cols || 4, rows: 1 }));
    out.push(...C.footer(s.footer, { brand: p.brand || 'Boutique' }));
    return out;
  };

  T.ecommerce_product = (b, p) => {
    const a = inner(b), out = [...C.browser_frame(b, { url: `https://www.${str(p.brand || 'boutique', 20).toLowerCase().replace(/[^a-z0-9]/g, '')}.com/produit` }), rect(a.x, a.y, a.w, a.h, { fill: th.bg })];
    const s = stack(a, [['nav', 9], ['crumb', 5], ['body', 76], ['foot', 10]]);
    out.push(...C.navbar(s.nav, { brand: p.brand || 'Boutique', items: p.menu || ['Nouveautés', 'Femme', 'Homme'], icons: ['search', 'user', 'cart'] }));
    out.push(...C.breadcrumb({ x: s.crumb.x + 30, y: s.crumb.y + 8, w: s.crumb.w, h: s.crumb.h }, { items: p.breadcrumb || ['Accueil', 'Catégorie', p.name || 'Produit'] }));
    const body = padBox(s.body, 30, 6), half = body.w * 0.48;
    out.push(ui('image', body.x, body.y, half, body.h * 0.72, { color: th.muted, props: p.src ? { src: p.src } : {} }));
    const tw = (half - 36) / 4;
    for (let i = 0; i < 4; i++) out.push(ui('image', body.x + i * (tw + 12), body.y + body.h * 0.76, tw, body.h * 0.17, { color: th.muted }));
    const rx = body.x + half + 44, rw = body.w - half - 44;
    let y = body.y;
    out.push(text(str(p.name || 'Nom du produit', 50), rx, y, { px: 28, bold: true })); y += 44;
    out.push(...stars(rx, y, p.rating ?? 4, { px: 16 }), text(`${p.reviews || '128'} avis`, rx + 110, y + 2, { px: 13, color: th.muted })); y += 34;
    out.push(text(str(p.price || '59,90 €', 14), rx, y, { px: 30, bold: true, color: th.primary }));
    if (p.oldPrice) out.push(text(str(p.oldPrice, 14), rx + textW(p.price || '59,90 €', 30) + 14, y + 8, { px: 16, color: th.muted }));
    y += 52;
    wrap(str(p.description || 'Une description claire du produit : matières, usages et points forts, rédigée en quelques lignes.', 260), rw, 14).forEach((l, i) => out.push(text(l, rx, y + i * 20, { px: 14, color: th.muted })));
    y += 90;
    out.push(text('Taille', rx, y, { px: 12, bold: true }));
    arr(p.sizes || ['S', 'M', 'L', 'XL'], 6).forEach((sz, i) => out.push(rect(rx + i * 54, y + 20, 44, 40, { fill: i === 1 ? th.primary : th.card, stroke: i === 1 ? th.primary : th.border, r: 8 }), textMid(str(sz, 4), rx + i * 54 + 22, y + 20, 40, { px: 13, bold: true, align: 'center', color: i === 1 ? th.onPrimary : th.text })));
    y += 84;
    out.push(rect(rx, y, 120, 48, { fill: th.card, stroke: th.border, r: 10 }), textMid('−', rx + 22, y, 48, { px: 18, bold: true, align: 'center' }), textMid('1', rx + 60, y, 48, { px: 15, bold: true, align: 'center' }), textMid('+', rx + 98, y, 48, { px: 18, bold: true, align: 'center' }));
    out.push(...button(rx + 136, y, Math.min(260, rw - 136), 48, 'Ajouter au panier', { variant: 'primary' }));
    out.push(...iconAt('truck', rx, y + 74, 22, { color: th.success }), text('Livraison offerte dès 50 € · Retours sous 30 jours', rx + 34, y + 77, { px: 13, color: th.muted }));
    y += 122;
    ['Description détaillée', 'Matières et entretien', 'Livraison et retours'].forEach((t, i) => {
      const ry = y + i * 44;
      if (ry + 44 > body.y + body.h) return;
      out.push(line(rx, ry, rx + rw, ry, { color: th.border }), textMid(t, rx, ry, 44, { px: 14, bold: true }), textMid('+', rx + rw - 14, ry, 44, { px: 18, color: th.muted, align: 'center' }));
    });
    out.push(...C.footer(s.foot, { brand: p.brand || 'Boutique' }));
    return out;
  };

  T.landing = (b, p) => {
    const a = inner(b), out = [...C.browser_frame(b, { url: `https://www.${str(p.brand || 'produit', 20).toLowerCase().replace(/[^a-z0-9]/g, '')}.com` }), rect(a.x, a.y, a.w, a.h, { fill: th.bg })];
    const s = stack(a, [['nav', 9], ['hero', 34], ['feat', 31], ['cta', 13], ['foot', 13]]), hero = p.hero || {};
    out.push(...C.navbar(s.nav, { brand: p.brand || 'Produit', items: p.menu || ['Fonctionnalités', 'Tarifs', 'Clients', 'Contact'], cta: p.cta || 'Essayer gratuitement' }));
    out.push(...C.hero(s.hero, { title: hero.title || 'Gagnez du temps chaque jour', subtitle: hero.subtitle || 'Une solution simple qui automatise vos tâches répétitives.', cta: hero.cta || 'Commencer', secondary: hero.secondary || 'Voir la démo', tone: 'dark', src: hero.src }));
    const feats = arr(p.features, 3).length ? arr(p.features, 3) : [{ icon: 'chart', title: 'Analyses claires', text: 'Suivez vos résultats en temps réel.' }, { icon: 'shield', title: 'Sécurité', text: 'Vos données restent protégées.' }, { icon: 'chat', title: 'Support humain', text: 'Une équipe réactive à vos côtés.' }];
    const fa = padBox(s.feat, 40, 16), fw = (fa.w - 40) / 3;
    out.push(...C.section_title({ x: fa.x, y: fa.y, w: fa.w, h: 40 }, { title: p.featuresTitle || 'Pourquoi nous choisir', align: 'center' }));
    feats.forEach((f, i) => {
      const x = fa.x + i * (fw + 20), y = fa.y + 70, h = fa.h - 70;
      out.push(rect(x, y, fw, h, { fill: th.card, stroke: th.border, r: 14 }), rect(x + 20, y + 18, 44, 44, { fill: mix(th.primary, th.card, 0.14), round: true }), ...iconAt(ICONS[f.icon] ? f.icon : 'star', x + 30, y + 28, 24, { color: th.primary }), text(str(f.title, 28), x + 20, y + 78, { px: 16, bold: true }), ...wrap(str(f.text, 90), fw - 40, 13).map((l, j) => text(l, x + 20, y + 106 + j * 18, { px: 13, color: th.muted })));
    });
    out.push(...C.banner(padBox(s.cta, 40, 10), { title: p.ctaTitle || 'Prêt à essayer ?', subtitle: 'Sans carte bancaire · Annulation à tout moment', cta: p.cta || 'Créer mon compte', color: th.accent }));
    out.push(...C.footer(s.foot, { brand: p.brand || 'Produit' }));
    return out;
  };

  T.dashboard = (b, p) => {
    const a = inner(b), out = [...C.browser_frame(b, { url: 'https://app.exemple.com/dashboard' }), rect(a.x, a.y, a.w, a.h, { fill: th.surface })];
    const sw = Math.min(230, a.w * 0.18), side = { x: a.x, y: a.y, w: sw, h: a.h }, main = { x: a.x + sw, y: a.y, w: a.w - sw, h: a.h };
    out.push(...C.sidebar_menu(side, { brand: p.brand || 'Marque', items: p.menu }));
    out.push(...C.topbar({ x: main.x, y: main.y, w: main.w, h: 60 }, { title: p.title || 'Tableau de bord' }));
    const body = { x: main.x + 24, y: main.y + 84, w: main.w - 48, h: main.h - 108 };
    const stats = arr(p.stats, 4).length ? arr(p.stats, 4) : [{ label: 'Chiffre d\'affaires', value: '48 250 €', delta: '+12 %' }, { label: 'Commandes', value: '1 284', delta: '+8 %' }, { label: 'Nouveaux clients', value: '326', delta: '+5 %' }, { label: 'Panier moyen', value: '37,60 €', delta: '-2 %' }];
    const sh = Math.min(110, body.h * 0.2), sg = 16, scw = (body.w - sg * (stats.length - 1)) / stats.length;
    stats.forEach((st, i) => out.push(...C.stat_card({ x: body.x + i * (scw + sg), y: body.y, w: scw, h: sh }, st)));
    const ly = body.y + sh + 20, lh = body.h - sh - 20, cw = body.w * 0.58;
    out.push(...C.chart_bars({ x: body.x, y: ly, w: cw, h: lh }, { title: 'Ventes par jour', labels: ['L', 'M', 'M', 'J', 'V', 'S', 'D'] }));
    out.push(...C.table_simple({ x: body.x + cw + 16, y: ly, w: body.w - cw - 16, h: lh }, { headers: ['Commande', 'Statut', 'Montant'], rows: p.rows || [['#1042', 'Livrée', '129,00 €'], ['#1043', 'En cours', '54,90 €'], ['#1044', 'Payée', '89,00 €'], ['#1045', 'Livrée', '212,40 €']] }));
    return out;
  };


  T.mobile_app = (b, p) => {
    const out = [...C.phone_frame(b, {})], x = b.x + 14, w = b.w - 28;
    let y = b.y + 44;
    out.push(text(str(p.brand || 'Boutique', 18), x, y, { px: 20, bold: true, color: th.primary }), ...iconAt('bag', b.x + b.w - 14 - 26, y - 2, 24, { color: th.text }));
    y += 40;
    out.push(...C.searchbar({ x, y, w, h: 38 }, { placeholder: 'Rechercher…' })); y += 54;
    out.push(...C.banner({ x, y, w, h: Math.min(110, b.h * 0.16) }, { title: p.promo || '-30 % cette semaine', subtitle: 'Sur toute la collection', color: th.accent })); y += Math.min(110, b.h * 0.16) + 16;
    const chips = arr(p.categories, 4).length ? arr(p.categories, 4) : ['Tout', 'Femme', 'Homme', 'Enfant'];
    let cx = x; chips.forEach((c, i) => { const pw = textW(c, 12) + 24; if (cx + pw > x + w) return; out.push(rect(cx, y, pw, 30, { fill: i === 0 ? th.primary : th.surface, r: 15 }), textMid(str(c, 12), cx + pw / 2, y, 30, { px: 12, bold: true, align: 'center', color: i === 0 ? th.onPrimary : th.text })); cx += pw + 8; });
    y += 46;
    const tabH = 56, gridH = b.y + b.h - tabH - 14 - y, cw = (w - 12) / 2;
    const prods = arr(p.products, 2);
    for (let i = 0; i < 2; i++) out.push(...C.product_card({ x: x + i * (cw + 12), y, w: cw, h: Math.max(150, gridH) }, prods[i] || { name: `Produit ${i + 1}`, price: `${24 + i * 15},90 €`, button: 'Ajouter' }));
    const ty = b.y + b.h - tabH - 10;
    out.push(rect(b.x + 8, ty, b.w - 16, tabH, { fill: th.card, stroke: th.border, r: 18 }));
    ['home', 'search', 'heart', 'cart', 'user'].forEach((n, i, all) => out.push(...iconAt(n, b.x + 8 + ((b.w - 16) / all.length) * (i + 0.5) - 11, ty + 17, 22, { color: i === 0 ? th.primary : th.muted })));
    return out;
  };

  T.login = (b, p) => {
    const a = inner(b), out = [...C.browser_frame(b, { url: 'https://app.exemple.com/connexion' }), rect(a.x, a.y, a.w, a.h, { fill: th.bg })];
    const half = a.w * 0.5;
    out.push(rect(a.x, a.y, half, a.h, { fill: th.primary }), text(str(p.brand || 'Marque', 20), a.x + 48, a.y + 44, { px: 26, bold: true, color: th.onPrimary }),
      ...wrap(str(p.tagline || 'Gérez votre activité simplement, où que vous soyez.', 120), half - 96, 28).map((l, i) => text(l, a.x + 48, a.y + a.h * 0.36 + i * 38, { px: 28, bold: true, color: th.onPrimary })),
      ui('image', a.x + 48, a.y + a.h * 0.7, half - 96, a.h * 0.2, { color: th.onPrimary }));
    const fx = a.x + half + Math.max(40, (a.w - half - 380) / 2), fw = Math.min(380, a.w - half - 80), fy = a.y + a.h * 0.2;
    out.push(text(str(p.title || 'Connexion', 30), fx, fy, { px: 30, bold: true }), text('Heureux de vous revoir !', fx, fy + 44, { px: 14, color: th.muted }));
    out.push(...C.form({ x: fx, y: fy + 84, w: fw, h: 260 }, { fields: [{ label: 'E-mail', placeholder: 'vous@exemple.com' }, { label: 'Mot de passe', placeholder: '••••••••' }], submit: 'Se connecter' }));
    out.push(text('Mot de passe oublié ?', fx, fy + 84 + 2 * 78 + 66, { px: 13, color: th.primary }));
    return out;
  };

  return { components: C, templates: T, theme: th, W, H };
}

const COMPONENT_NAMES = ['icon', 'button', 'badge', 'stars', 'searchbar', 'breadcrumb', 'section_title', 'navbar', 'hero', 'product_card', 'product_grid', 'category_tiles', 'feature_row', 'banner', 'footer', 'stat_card', 'chart_bars', 'table_simple', 'form', 'sidebar_menu', 'topbar', 'browser_frame', 'phone_frame'];
const TEMPLATE_NAMES = ['ecommerce_home', 'ecommerce_product', 'landing', 'dashboard', 'login', 'mobile_app'];

module.exports = { create, buildTheme, ICON_NAMES, COMPONENT_NAMES, TEMPLATE_NAMES, THEMES };
