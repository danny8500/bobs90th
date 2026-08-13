/**
 * Bob's 90th — RSVP + photo backend (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Paste into script.google.com, fill in CONFIG, deploy as a Web app.
 * See SETUP.md for the click-by-click.
 *
 * Two independent copies of every RSVP, on purpose:
 *   1. a row in the Google Sheet  (the record you read and export)
 *   2. an email to you            (the backup, and your notification)
 * Guest photos go to a Drive folder, one subfolder per guest.
 */

// ===== CONFIG — fill these in =============================================
var SHEET_ID  = 'PASTE_YOUR_SHEET_ID_HERE';   // from the Sheet's URL
var ADMIN_KEY = 'PASTE_A_LONG_RANDOM_KEY';    // your password for the admin page
var NOTIFY_TO = 'arohrlich@gmail.com';        // where notifications land
var FOLDER_ID = '';                           // leave blank — setup() fills it in
// ==========================================================================

var HEADERS = ['Timestamp', 'Name', 'Email', 'Attending', 'Party size', 'Photos', 'Photo folder'];

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    return (p.type === 'photo') ? savePhoto(p) : saveRsvp(p);
  } catch (err) {
    // Last-ditch: if the Sheet is unreachable, still get the RSVP to a human.
    try {
      MailApp.sendEmail(NOTIFY_TO, 'RSVP ERROR — Bob’s 90th',
        'An RSVP came in but could not be saved.\n\nError: ' + err +
        '\n\n(Payload omitted — it may contain a large photo.)');
    } catch (e2) {}
    return json({ error: String(err) });
  }
}

function saveRsvp(p) {
  var name      = String(p.name  || '').trim().slice(0, 120);
  var email     = String(p.email || '').trim().slice(0, 160);
  var attending = p.attending === 'yes' ? 'yes' : 'no';
  var guests    = attending === 'yes' ? Math.max(1, Math.min(20, parseInt(p.guests, 10) || 1)) : 0;
  var photos    = Math.max(0, Math.min(20, parseInt(p.photoCount, 10) || 0));

  if (!name || !email) return json({ error: 'Name and email are required.' });

  var sheet = getSheet();
  var row = findRowByEmail(sheet, email);

  /* Someone changing their mind should update their line, not add a second one
     — otherwise the headcount double-counts and you cannot tell which reply is
     current. Match on email, newest wins. Photos ADD rather than replace: a
     guest who comes back to send two more should end up with all of them. */
  var existingPhotos = 0, folderUrl = '';
  if (row > 0) {
    existingPhotos = parseInt(sheet.getRange(row, 6).getValue(), 10) || 0;
    folderUrl = sheet.getRange(row, 7).getValue() || '';
  }

  var values = [new Date(), name, email, attending, guests, existingPhotos + photos, folderUrl];
  if (row > 0) sheet.getRange(row, 1, 1, values.length).setValues([values]);
  else         sheet.appendRow(values);

  notify(name, email, attending, guests, photos, row > 0);
  return json({ ok: true });
}

function savePhoto(p) {
  var name  = String(p.name  || 'Guest').trim().slice(0, 120);
  var email = String(p.email || '').trim().slice(0, 160);
  var data  = String(p.dataUrl || '');

  var m = data.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!m) return json({ error: 'Unreadable image.' });

  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], safeName(name, p.filename));
  var folder = guestFolder(name, email);
  var file = folder.createFile(blob);

  /* Record the folder link on the guest's row the first time they send one, so
     the admin page can link straight to their photos. */
  var sheet = getSheet();
  var row = findRowByEmail(sheet, email);
  if (row > 0 && !sheet.getRange(row, 7).getValue()) {
    sheet.getRange(row, 7).setValue(folder.getUrl());
  }
  return json({ ok: true, file: file.getName() });
}

/** One subfolder per guest, so 40 people's photos don't become one heap. */
function guestFolder(name, email) {
  var root = DriveApp.getFolderById(getFolderId());
  var label = (name || 'Guest') + (email ? ' (' + email + ')' : '');
  var found = root.getFoldersByName(label);
  return found.hasNext() ? found.next() : root.createFolder(label);
}

function getFolderId() {
  if (FOLDER_ID) return FOLDER_ID;
  // Fall back to a property so photos still land somewhere if CONFIG wasn't updated.
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (!id) {
    id = DriveApp.createFolder('Bob’s 90th — Guest Photos').getId();
    props.setProperty('PHOTO_FOLDER_ID', id);
  }
  return id;
}

function safeName(guest, filename) {
  var ext = String(filename || '').match(/\.[a-z0-9]+$/i);
  var base = String(filename || 'photo').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').slice(0, 60);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  return guest.replace(/[^\w\- ]+/g, '') + ' — ' + (base || 'photo') + ' ' + stamp + (ext ? ext[0] : '.jpg');
}

function findRowByEmail(sheet, email) {
  if (!email) return -1;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim().toLowerCase() === email.toLowerCase()) return i + 1;
  }
  return -1;
}

/** Admin page reads here: /exec?key=... */
function doGet(e) {
  var key = e && e.parameter ? e.parameter.key : '';
  if (key !== ADMIN_KEY) return json({ error: 'Invalid admin key.' });

  var data = getSheet().getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][1] && !data[i][2]) continue;             // skip blank rows
    rows.push({
      timestamp:   data[i][0] ? new Date(data[i][0]).toISOString() : '',
      name:        data[i][1],
      email:       data[i][2],
      attending:   data[i][3],
      guests:      data[i][4],
      photos:      data[i][5],
      photoFolder: data[i][6]
    });
  }
  rows.sort(function (a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });

  var folderUrl = '';
  try { folderUrl = DriveApp.getFolderById(getFolderId()).getUrl(); } catch (err) {}
  return json({ ok: true, rows: rows, folderUrl: folderUrl });
}

/** Creates the tab and header row on first use, so there is nothing to set up by hand. */
function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('RSVPs');
  if (!sheet) {
    sheet = ss.insertSheet('RSVPs');
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 190);
    sheet.setColumnWidth(3, 230);
    sheet.setColumnWidth(7, 300);
  }
  return sheet;
}

function notify(name, email, attending, guests, photos, isUpdate) {
  var yes = attending === 'yes';
  var subject = (isUpdate ? 'Updated RSVP' : 'RSVP') + ' — ' + name + ' ' +
                (yes ? 'is coming' + (guests > 1 ? ' (party of ' + guests + ')' : '') : 'cannot make it');
  var body =
    (isUpdate ? 'This guest changed an earlier reply.\n\n' : '') +
    'Name:      ' + name + '\n' +
    'Email:     ' + email + '\n' +
    'Attending: ' + (yes ? 'Yes' : 'No') + '\n' +
    (yes ? 'Party of:  ' + guests + '\n' : '') +
    (photos ? 'Photos:    ' + photos + ' uploading\n' : '') +
    '\n— Bob’s 90th RSVP page';
  try { MailApp.sendEmail(NOTIFY_TO, subject, body); } catch (e) {}
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this ONCE from the editor (Run ▸ setup) before deploying. It creates the
 * tab and the photo folder, writes a test row, and emails you — so you know the
 * Sheet, Drive and email all work before a real guest tries.
 */
function setup() {
  var sheet = getSheet();
  var folder = DriveApp.getFolderById(getFolderId());
  sheet.appendRow([new Date(), 'Test Guest', 'test@example.com', 'yes', 2, 0, '']);
  MailApp.sendEmail(NOTIFY_TO, 'RSVP setup works — Bob’s 90th',
    'Sheet, Drive and email are all working.\n\n' +
    'Photo folder: ' + folder.getUrl() + '\n' +
    'Folder ID:    ' + folder.getId() + '\n\n' +
    'Paste that Folder ID into FOLDER_ID at the top of Code.gs (optional but tidy),\n' +
    'delete the "Test Guest" row from the Sheet, and you are ready to deploy.');
  Logger.log('OK. Photo folder: ' + folder.getUrl() + '  (id ' + folder.getId() + ')');
}
