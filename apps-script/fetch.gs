/**
 * Fetch a recipe post (Instagram / Facebook / any site) and return its caption + a photo.
 * Free: no outside service, it reads the post's public page directly.
 * Used by the app's "✨ משיכה מהקישור" button through the 'fetchLink' action.
 */

const FETCH_UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FETCH_UA_PREVIEW = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function fetchLink(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('bad_url');

  let found = null;
  const ig = url.match(/instagram\.com\/(?:[^\/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (ig) found = fetchInstagram_(ig[1]);
  if (!found || !found.caption) found = mergeFound_(found, fetchMeta_(url));
  if (!found || (!found.caption && !found.image)) return { caption: '', title: '', photoId: '' };

  let photoId = '';
  if (found.image) { try { photoId = savePhotoFromUrl_(found.image); } catch (e) {} }
  return { caption: found.caption || '', title: found.title || '', photoId: photoId };
}

/* Instagram: the public "embed" page includes the full caption and the post's image. */
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
    if (m) {
      caption = m[1].replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/, '');
      caption = htmlToText_(caption);
    }
    if (!caption) {                       // newer embeds keep the caption inside a JSON blob
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

/* Any page (Facebook, blogs, also an Instagram fallback): read the og: preview tags. */
function fetchMeta_(url) {
  const html = get_(url, FETCH_UA_PREVIEW) || get_(url, FETCH_UA_BROWSER);
  if (!html) return null;
  const meta = name => {
    const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + name + '["\']', 'i');
    const m = html.match(re1) || html.match(re2);
    return m ? decodeEntities_(m[1]) : '';
  };
  let caption = meta('og:description') || meta('description');
  // Instagram's preview text looks like: 123 likes, 4 comments - user on May 1, 2026: "the caption"
  const q = caption.match(/^[\s\S]{0,200}?:\s*["“]([\s\S]*)["”]\.?\s*$/);
  if (q && /instagram\.com/i.test(url)) caption = q[1];
  return { caption: caption.trim(), image: meta('og:image'), title: meta('og:title') };
}

function mergeFound_(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { caption: a.caption || b.caption, image: a.image || b.image, title: a.title || b.title };
}

function get_(url, ua) {
  try {
    const r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'User-Agent': ua, 'Accept-Language': 'he,en;q=0.8' }
    });
    if (r.getResponseCode() >= 400) return '';
    return r.getContentText();
  } catch (e) { return ''; }
}

function savePhotoFromUrl_(imgUrl) {
  const r = UrlFetchApp.fetch(imgUrl, { muteHttpExceptions: true, headers: { 'User-Agent': FETCH_UA_BROWSER } });
  if (r.getResponseCode() >= 400) return '';
  const blob = r.getBlob();
  let type = (blob.getContentType() || 'image/jpeg').split(';')[0];
  if (!/^image\//.test(type)) return '';
  if (blob.getBytes().length > 8e6) return '';
  return uploadPhoto(Utilities.base64Encode(blob.getBytes()), type);
}

function htmlToText_(h) {
  return decodeEntities_(h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, ''))
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

/* Test from the editor: choose testFetch and press Run, then look at the log. */
function testFetch() {
  Logger.log(JSON.stringify(fetchLink('https://www.instagram.com/p/PASTE_A_POST_CODE/'), null, 2));
}
