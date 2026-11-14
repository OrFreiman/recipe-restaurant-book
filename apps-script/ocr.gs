/**
 * Read recipe text from screenshots / photos (when there is no link, or the link doesn't work).
 * Free: uses Google Drive's built-in text recognition (OCR), which handles Hebrew well.
 *
 * This file also holds the app's doPost (with the new 'ocrImage' action), so nothing needs to be
 * changed in the other files. Because it is the last file in the project, this doPost is the one used.
 * Setup: paste this whole file as a new script file named "ocr", run testOcr once,
 * then Deploy → Manage deployments → Edit → New version.
 */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad_request' }); }
  if (String(req.pw || '') !== PASSWORD) return json({ ok: false, error: 'bad_password' });
  try {
    switch (req.action) {
      case 'check':         return json({ ok: true });
      case 'list':          return json({ ok: true, data: listAll() });
      case 'save':          return json({ ok: true, item: withLock(() => saveItem(req.table, req.item)) });
      case 'delete':        withLock(() => deleteItem(req.table, req.id)); return json({ ok: true });
      case 'setCategories': withLock(() => setSetting('categories', JSON.stringify(req.list || []))); return json({ ok: true });
      case 'upload':        return json({ ok: true, id: uploadPhoto(req.data, req.type) });
      case 'deletePhotos':  trashPhotos(req.ids); return json({ ok: true });
      case 'fetchLink':     return json({ ok: true, data: fetchLink(req.url) });
      case 'ocrImage':      return json({ ok: true, text: ocrImage(req.data, req.type) });
      default:              return json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function ocrImage(base64, type) {
  if (!base64) throw new Error('no_image');
  type = String(type || 'image/jpeg').split(';')[0];
  if (!/^image\//.test(type)) throw new Error('unsupported_type');
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > 10e6) throw new Error('too_large');

  const token = ScriptApp.getOAuthToken();
  const boundary = 'ocr' + Utilities.getUuid().replace(/-/g, '');
  const meta = JSON.stringify({ name: 'ocr-temp-' + Date.now(), mimeType: 'application/vnd.google-apps.document' });
  const head = Utilities.newBlob(
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n' +
    '--' + boundary + '\r\nContent-Type: ' + type + '\r\n\r\n').getBytes();
  const tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();

  // Hebrew hint first ('iw' is Google's code for Hebrew); if Drive rejects it, let it detect the language itself
  let up = null;
  for (const lang of ['iw', 'he', '']) {
    up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id' + (lang ? '&ocrLanguage=' + lang : ''), {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: head.concat(bytes, tail),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (up.getResponseCode() < 300 || up.getResponseCode() !== 400) break;
  }
  if (up.getResponseCode() >= 300) throw new Error('ocr_upload_failed: ' + up.getContentText().replace(/\s+/g, ' ').slice(0, 400));
  const id = JSON.parse(up.getContentText()).id;

  try {
    const ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
    });
    if (ex.getResponseCode() >= 300) throw new Error('ocr_read_failed');
    return ex.getContentText('UTF-8').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, {
      method: 'delete', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
    });
  }
}

/* Run once from the editor (choose testOcr and press Run) to approve permissions. */
function testOcr() {
  DriveApp.getRootFolder();
  const img = UrlFetchApp.fetch('https://dummyimage.com/600x200/fff/000.png&text=Recipe+test').getBlob();
  Logger.log(ocrImage(Utilities.base64Encode(img.getBytes()), 'image/png'));
}
