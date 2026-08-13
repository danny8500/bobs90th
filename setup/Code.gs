/**
 * Bob's 90th — RSVP + photo backend (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Paste into script.google.com, then Deploy ▸ Manage deployments ▸ New version.
 *
 * Two independent copies of every RSVP, on purpose:
 *   1. a row in the Google Sheet  (the record you read and export)
 *   2. an email to you            (the backup, and your notification)
 * Guest photos all go into ONE Drive folder, each filename prefixed with the
 * guest's name so they stay sorted together without a folder per person.
 */

// ===== CONFIG =============================================================
var SHEET_ID  = '1HuGBOcoVHWQNzgCX98umGW_d4UBkkMCmYcv7GaFWgRA';
var ADMIN_KEY = 'oreo';
var NOTIFY_TO = 'dannylewis@gmail.com';
var FOLDER_ID = '13iNnfaq5j3TxBaQNCZjtfGo4EljruY9Y';
// ==========================================================================

var HEADERS = ['Timestamp', 'Name', 'Attending', 'Party size', 'Photos', 'Toast'];

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);

    /* Anything that MUTATES someone else's row is admin-only. The guest paths
       (rsvp / photo) stay unauthenticated because a guest has no key. */
    if (p.type === 'admin-update' || p.type === 'admin-delete') {
      if (p.key !== ADMIN_KEY) return json({ error: 'Invalid admin key.' });
      return p.type === 'admin-delete' ? adminDelete(p) : adminUpdate(p);
    }
    return (p.type === 'photo') ? savePhoto(p) : saveRsvp(p);

  } catch (err) {
    try {
      MailApp.sendEmail(NOTIFY_TO, 'RSVP ERROR - Bob 90th',
        'An RSVP came in but could not be saved. Error: ' + err);
    } catch (e2) {}
    return json({ error: String(err) });
  }
}

function saveRsvp(p) {
  var name      = String(p.name || '').trim().slice(0, 120);
  var attending = p.attending === 'yes' ? 'yes' : 'no';
  var guests    = attending === 'yes' ? Math.max(1, Math.min(20, parseInt(p.guests, 10) || 1)) : 0;
  var photos    = Math.max(0, Math.min(20, parseInt(p.photoCount, 10) || 0));
  var toast     = String(p.toast || '').trim().slice(0, 1200);

  if (!name) return json({ error: 'A name is required.' });

  var sheet = getSheet();
  var row = findRowByName(sheet, name);

  /* A second reply from the same person UPDATES their line rather than adding
     one, or the headcount double-counts. Photos ADD rather than replace. */
  var existingPhotos = 0, existingToast = '';
  if (row > 0) {
    existingPhotos = parseInt(sheet.getRange(row, 5).getValue(), 10) || 0;
    existingToast  = sheet.getRange(row, 6).getValue() || '';
  }
  // An empty box on a re-reply means "no change", not "delete what I wrote".
  var values = [new Date(), name, attending, guests, existingPhotos + photos, toast || existingToast];
  if (row > 0) sheet.getRange(row, 1, 1, values.length).setValues([values]);
  else         sheet.appendRow(values);

  notify(name, attending, guests, photos, row > 0, toast);
  return json({ ok: true });
}

function savePhoto(p) {
  var name = String(p.name || 'Guest').trim().slice(0, 120);
  var data = String(p.dataUrl || '');

  var m = data.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!m) return json({ error: 'Unreadable image.' });

  // One shared folder. The guest's name leads the filename, so an alphabetical
  // listing groups each person's photos together anyway.
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], safeName(name, p.filename));
  var file = DriveApp.getFolderById(getFolderId()).createFile(blob);
  return json({ ok: true, file: file.getName() });
}

/** Admin: change a guest's reply. Renaming is allowed and moves their photos too. */
function adminUpdate(p) {
  var sheet = getSheet();
  var row = findRowByName(sheet, p.original || p.name);
  if (row < 0) return json({ error: 'Could not find that guest.' });

  var name      = String(p.name || '').trim().slice(0, 120);
  var attending = p.attending === 'yes' ? 'yes' : 'no';
  var guests    = attending === 'yes' ? Math.max(0, Math.min(20, parseInt(p.guests, 10) || 1)) : 0;
  if (!name) return json({ error: 'A name is required.' });

  // Renaming to a name that already exists would create two rows the lookup
  // cannot tell apart, so refuse rather than silently merge them.
  var clash = findRowByName(sheet, name);
  if (clash > 0 && clash !== row) return json({ error: 'Another guest is already called that.' });

  var oldName = sheet.getRange(row, 2).getValue();
  var photos  = parseInt(sheet.getRange(row, 5).getValue(), 10) || 0;
  var toast   = p.toast === undefined ? (sheet.getRange(row, 6).getValue() || '')
                                      : String(p.toast || '').trim().slice(0, 1200);
  sheet.getRange(row, 1, 1, 6).setValues([[new Date(), name, attending, guests, photos, toast]]);

  var renamed = 0;
  if (norm(oldName) !== norm(name)) renamed = renamePhotos(oldName, name);
  return json({ ok: true, renamedPhotos: renamed });
}

/** Admin: remove a guest entirely, and their photos with them. */
function adminDelete(p) {
  var sheet = getSheet();
  var row = findRowByName(sheet, p.name);
  if (row < 0) return json({ error: 'Could not find that guest.' });

  var trashed = trashPhotos(p.name);
  sheet.deleteRow(row);
  return json({ ok: true, trashedPhotos: trashed });
}

/** Files are named "<Guest> - <original> <stamp>.jpg", so match on that prefix. */
function eachPhotoOf(name, fn) {
  var prefix = norm(cleanName(name)) + ' - ';
  var files = DriveApp.getFolderById(getFolderId()).getFiles();
  var n = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (norm(f.getName()).indexOf(prefix) === 0) { fn(f); n++; }
  }
  return n;
}
function trashPhotos(name) {
  return eachPhotoOf(name, function (f) { f.setTrashed(true); });
}
function renamePhotos(oldName, newName) {
  var oldPrefix = cleanName(oldName) + ' - ';
  return eachPhotoOf(oldName, function (f) {
    f.setName(cleanName(newName) + ' - ' + f.getName().slice(oldPrefix.length));
  });
}

function getFolderId() {
  if (FOLDER_ID) return FOLDER_ID;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (!id) {
    id = DriveApp.createFolder('Bob 90th - Guest Photos').getId();
    props.setProperty('PHOTO_FOLDER_ID', id);
  }
  return id;
}

function cleanName(s) { return String(s || 'Guest').replace(/[^\w\- ]+/g, '').trim(); }

function safeName(guest, filename) {
  var ext = String(filename || '').match(/\.[a-z0-9]+$/i);
  var base = String(filename || 'photo').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').slice(0, 60);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  return cleanName(guest) + ' - ' + (base || 'photo') + ' ' + stamp + (ext ? ext[0] : '.jpg');
}

/** Case- and space-insensitive, so "jim  smith" matches "Jim Smith". */
function findRowByName(sheet, name) {
  if (!name) return -1;
  var key = norm(name);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (norm(data[i][1]) === key) return i + 1;
  }
  return -1;
}
function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/**
 * Admin page reads here: /exec?key=...
 * The guest page also calls /exec?lookup=<name> to ask "have I already replied?".
 * That one is unauthenticated by necessity, so it returns ONLY that person's own
 * reply on an exact full-name match, and never a list.
 */
function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};

  if (p.lookup) {
    var lsheet = getSheet();
    var lrow = findRowByName(lsheet, p.lookup);
    if (lrow < 0) return json({ found: false });
    var lv = lsheet.getRange(lrow, 1, 1, HEADERS.length).getValues()[0];
    return json({
      found: true,
      rsvp: { name: lv[1], attending: lv[2], guests: lv[3], photos: lv[4], toast: lv[5],
              when: lv[0] ? new Date(lv[0]).toISOString() : '' }
    });
  }

  if ((p.key || '') !== ADMIN_KEY) return json({ error: 'Invalid admin key.' });

  var data = getSheet().getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][1]) continue;
    rows.push({
      timestamp: data[i][0] ? new Date(data[i][0]).toISOString() : '',
      name:      data[i][1],
      attending: data[i][2],
      guests:    data[i][3],
      photos:    data[i][4],
      toast:     data[i][5]
    });
  }
  rows.sort(function (a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });

  var folderUrl = '';
  try { folderUrl = DriveApp.getFolderById(getFolderId()).getUrl(); } catch (err) {}
  return json({ ok: true, rows: rows, folderUrl: folderUrl });
}

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('RSVPs');
  if (!sheet) {
    sheet = ss.insertSheet('RSVPs');
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 220);
  } else if (sheet.getRange(1, 6).getValue() === 'Photo folder') {
    // Column 6 used to hold a per-guest Drive link; photos now live in one
    // folder, so the column was repurposed for the guest's toast.
    sheet.getRange(1, 6).setValue('Toast');
    sheet.setColumnWidth(6, 420);
  }
  return sheet;
}

function notify(name, attending, guests, photos, isUpdate, toast) {
  var yes = attending === 'yes';
  var subject = (isUpdate ? 'Updated RSVP' : 'RSVP') + ' - ' + name + ' ' +
                (yes ? 'is coming' + (guests > 1 ? ' (party of ' + guests + ')' : '') : 'cannot make it');
  var body =
    (isUpdate ? 'This guest changed an earlier reply.\n\n' : '') +
    'Name:      ' + name + '\n' +
    'Attending: ' + (yes ? 'Yes' : 'No') + '\n' +
    (yes ? 'Party of:  ' + guests + '\n' : '') +
    (photos ? 'Photos:    ' + photos + ' uploading\n' : '') +
    '\n- Bob 90th RSVP page';
  try { MailApp.sendEmail(NOTIFY_TO, subject, body); } catch (e) {}
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor before the first deploy. */
function setup() {
  var sheet = getSheet();
  var folder = DriveApp.getFolderById(getFolderId());
  MailApp.sendEmail(NOTIFY_TO, 'RSVP setup works - Bob 90th',
    'Sheet, Drive and email are all working.\n\nPhoto folder: ' + folder.getUrl());
  Logger.log('OK. Photo folder: ' + folder.getUrl());
}
