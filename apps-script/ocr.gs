/**
 * Read recipe text from screenshots / photos (when there is no link, or the link doesn't work).
 * Free: uses Google Drive's built-in text recognition (OCR), which handles Hebrew well.
 * The image is turned into a temporary Google Doc, its text is read, and the temp doc is deleted.
 * Used by the app's "📷 קריאת מתכון מצילומי מסך" button through the 'ocrImage' action.
 *
 * Setup: add this file to the Apps Script project, add this line inside doPost's switch, under the 'fetchLink' line:
 *   case 'ocrImage':      return json({ ok: true, text: ocrImage(req.data, req.type) });
 * run testOcr once to approve permissions, then Deploy → Manage deployments → Edit → New version.
 */
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

  const up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=he&fields=id', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: head.concat(bytes, tail),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (up.getResponseCode() >= 300) throw new Error('ocr_upload_failed: ' + up.getContentText().slice(0, 200));
  const id = JSON.parse(up.getContentText()).id;

  try {
    const ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
    });
    if (ex.getResponseCode() >= 300) throw new Error('ocr_read_failed');
    return ex.getContentText('UTF-8').replace(/^﻿/, '').replace(/\r/g, '').trim();
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
