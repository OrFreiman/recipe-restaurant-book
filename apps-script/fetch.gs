/**
 * Fetch a recipe from a link (Instagram / Facebook / recipe websites) and return its text + a photo.
 * Free: no paid service. It reads the public page directly, and if the site blocks Google's
 * servers it tries the free Jina Reader (r.jina.ai) as a backup.
 * Used by the app's "✨ משיכת המתכון מהקישור" button through the 'fetchLink' action.
 */

const FETCH_UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FETCH_UA_PREVIEW = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
let FETCH_LOG = [];

function fetchLink(url) {
  FETCH_LOG = [];
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('bad_url');
  const isIg = /instagram\.com/i.test(url);

  let found = null;
  const ig = url.match(/instagram\.com\/(?:[^\/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (ig) found = fetchInstagram_(ig[1]);

  if (!found || !found.caption) {
    const html = get_(url, FETCH_UA_BROWSER) || get_(url, FETCH_UA_PREVIEW);
    if (html) found = mergeFound_(found, fromHtml_(html, url, isIg));
  }
  if (!found || !found.caption) found = mergeFound_(found, fromReader_(url, isIg));

  const debug = FETCH_LOG.join(' | ');
  if (!found || (!found.caption && !found.image)) return { caption: '', title: '', photoId: '', debug: debug };

  let photoId = '';
  if (found.image) { try { photoId = savePhotoFromUrl_(found.image); } catch (e) { FETCH_LOG.push('photo: ' + e); } }
  return { caption: (found.caption || '').trim(), title: found.title || '', photoId: photoId, debug: FETCH_LOG.join(' | ') };
}

/* ---------- Instagram: the public "embed" page has the full caption and the image ---------- */
function fetchInstagram_(code) {
  const tries = [
    'https://www.instagram.com/p/' + code + '/embed/captioned/',
    'https://www.instagram.com/reel/' + code + '/embed/captioned/'
  ];
  for (const u of tries) {
    const html = get_(u, FETCH_UA_BROWSER);
    if (!html) continue;
    let caption = '';
    const m = html.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/);
    if (m) caption = htmlToText_(m[1].replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/, ''));
    if (!caption) {
      const j = html.match(/\\"caption\\":\{[^}]*?\\"text\\":\\"((?:[^\\]|\\\\.)*?)\\"/) ||
                html.match(/"edge_media_to_caption":\{"edges":\[\{"node":\{"text":"((?:[^"\\]|\\.)*)"/);
      if (j) caption = decodeJsonString_(j[1]);
    }
    let image = '';
    const im = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) || html.match(/<img[^>]+src="(https:\/\/[^"]*(?:cdninstagram|fbcdn)[^"]+)"/);
    if (im) image = decodeEntities_(im[1]);
    if (caption || image) return { caption: caption.trim(), image: image, title: '' };
  }
  return null;
}

/* ---------- Any web page ---------- */
function fromHtml_(html, url, isIg) {
  const meta = name => {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const t of tags) {
      const key = attr_(t, 'property') || attr_(t, 'name');
      if (key && key.toLowerCase() === name) return decodeEntities_(attr_(t, 'content') || '');
    }
    return '';
  };
  const ogImage = meta('og:image');
  let ogTitle = meta('og:title').replace(/\s+[|\-–]\s+[^|\-–]{2,40}$/, '').trim();

  // 1) A structured recipe (most recipe sites include one)
  const ld = recipeFromJsonLd_(html);
  if (ld && ld.caption) return { caption: ld.caption, image: ld.image || ogImage, title: ld.title || ogTitle };

  // 2) The recipe written in the page text (look for "מצרכים" / "Ingredients")
  if (!isIg) {
    const text = pageText_(html);
    const part = recipePart_(text);
    if (part) {
      const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      return { caption: part, image: ogImage, title: (h1 ? htmlToText_(h1[1]).trim() : '') || ogTitle };
    }
  }

  // 3) The short preview text
  let caption = meta('og:description') || meta('description');
  if (isIg) {
    const q = caption.match(/^[\s\S]{0,200}?:\s*["“]([\s\S]*)["”]\.?\s*$/);
    if (q) caption = q[1];
    ogTitle = '';
  }
  return { caption: caption.trim(), image: ogImage, title: ogTitle };
}

function recipeFromJsonLd_(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim()); } catch (e) { continue; }
    const r = findRecipe_(data);
    if (!r) continue;
    const ing = [].concat(r.recipeIngredient || r.ingredients || []).map(x => decodeEntities_(String(x)).trim()).filter(Boolean);
    const steps = [];
    const walk = s => {
      if (!s) return;
      if (typeof s === 'string') { htmlToText_(s).split('\n').forEach(x => { if (x.trim()) steps.push(x.trim()); }); return; }
      if (Array.isArray(s)) { s.forEach(walk); return; }
      if (s.itemListElement) { if (s.name) steps.push(decodeEntities_(s.name) + ':'); walk(s.itemListElement); return; }
      if (s.text) walk(s.text); else if (s.name) walk(s.name);
    };
    walk(r.recipeInstructions);
    if (!ing.length && !steps.length) continue;
    let image = r.image;
    if (Array.isArray(image)) image = image[0];
    if (image && typeof image === 'object') image = image.url || image.contentUrl || '';
    const caption = (ing.length ? 'מצרכים:\n' + ing.join('\n') + '\n\n' : '') + (steps.length ? 'אופן הכנה:\n' + steps.join('\n') : '');
    return { caption: caption, image: image || '', title: decodeEntities_(r.name || '') };
  }
  return null;
}
function findRecipe_(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d)) { for (const x of d) { const r = findRecipe_(x); if (r) return r; } return null; }
  const t = [].concat(d['@type'] || []);
  if (t.some(x => String(x).toLowerCase() === 'recipe')) return d;
  if (d['@graph']) return findRecipe_(d['@graph']);
  return null;
}

function pageText_(html) {
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = h.match(/<(article|main)\b[\s\S]*?<\/\1>/i);
  if (main) h = main[0];
  h = h.replace(/<li\b[^>]*>/gi, '\n').replace(/<\/(h[1-6]|li|tr|ul|ol)>/gi, '\n').replace(/<h[1-6]\b[^>]*>/gi, '\n');
  return htmlToText_(h).split('\n').map(x => x.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n');
}
function recipePart_(text) {
  const startRe = /(^|\n)[^\n\S]*[*_#>\s]*(מצרכים|המצרכים|רכיבים|הרכיבים|חומרים|מה צריך|ingredients)(?=$|[\s:：\-–.!*])[^\n]{0,25}\n?/i;
  const m = text.match(startRe);
  if (!m) return '';
  let part = text.slice(m.index).slice(0, 6000);
  const endRe = /\n[*_#>\s]*(?:\d+\s*)?(לחץ להדפסה|הדפסת המתכון|shares|המתכונים הקודמים|המתכון הקודם|המתכון הבא|תגובות|כתיבת תגובה|מתכונים נוספים|מתכונים דומים|אולי יעניין|שתפו|שיתוף|הירשמו|תגיות|comments|related recipes|share this|you may also like)(?=$|[\s:：.!])/im;
  const e = part.search(endRe);
  if (e > 80) part = part.slice(0, e);
  part = part.replace(/[*_]{1,3}/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  return part.trim().length > 40 ? part.trim() : '';
}

/* ---------- Backup: free Jina Reader returns the page as plain text ---------- */
function fromReader_(url, isIg) {
  const r = get_('https://r.jina.ai/' + url, FETCH_UA_BROWSER, { 'X-Return-Format': 'markdown' });
  if (!r) return null;
  const title = (r.match(/^Title:\s*(.+)$/m) || [])[1] || '';
  const body = r.split(/^Markdown Content:\s*$/m).pop();
  const img = (body.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+\.(?:jpe?g|png|webp)[^)\s]*)\)/i) || [])[1] || '';
  const part = recipePart_(body);
  if (part) return { caption: part, image: img, title: isIg ? '' : title.replace(/\s+[|\-–]\s+[^|\-–]{2,40}$/, '').trim() };
  return null;
}

/* ---------- helpers ---------- */
function mergeFound_(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { caption: a.caption || b.caption, image: a.image || b.image, title: a.title || b.title };
}
function get_(url, ua, extra) {
  try {
    const r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: Object.assign({ 'User-Agent': ua, 'Accept-Language': 'he,en;q=0.8' }, extra || {})
    });
    const code = r.getResponseCode();
    FETCH_LOG.push(url.slice(0, 60) + ' → ' + code);
    if (code >= 400) return '';
    return r.getContentText();
  } catch (e) { FETCH_LOG.push(url.slice(0, 60) + ' → ' + e); return ''; }
}
function attr_(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
  return m ? (m[2] !== undefined ? m[2] : m[3]) : '';
}
function savePhotoFromUrl_(imgUrl) {
  const r = UrlFetchApp.fetch(imgUrl, { muteHttpExceptions: true, headers: { 'User-Agent': FETCH_UA_BROWSER } });
  if (r.getResponseCode() >= 400) return '';
  const blob = r.getBlob();
  const type = (blob.getContentType() || 'image/jpeg').split(';')[0];
  if (!/^image\//.test(type)) return '';
  if (blob.getBytes().length > 8e6) return '';
  return uploadPhoto(Utilities.base64Encode(blob.getBytes()), type);
}
function htmlToText_(h) {
  return decodeEntities_(String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n');
}
function decodeEntities_(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function decodeJsonString_(s) {
  let out = s;
  for (let i = 0; i < 2 && /\\/.test(out); i++) {
    try { out = JSON.parse('"' + out + '"'); } catch (e) { break; }
  }
  return out;
}

/* Test from the editor: choose testFetch and press Run, then look at the log at the bottom. */
function testFetch() {
  const r = fetchLink('https://www.krutit.co.il/%D7%9E%D7%A8%D7%A7-%D7%90%D7%A4%D7%95%D7%A0%D7%94-%D7%A2%D7%93%D7%99%D7%A0%D7%94-%D7%A9%D7%9C%D7%9E%D7%95%D7%AA-%D7%A9%D7%9E%D7%9B%D7%99%D7%A0%D7%99%D7%9D-%D7%91%D7%A6%D7%99%D7%A7/');
  Logger.log('debug: ' + r.debug);
  Logger.log('title: ' + r.title);
  Logger.log('photo: ' + r.photoId);
  Logger.log(r.caption);
}
