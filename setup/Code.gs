/**
 * Bob's 90th — RSVP + photos + invitations (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Two tabs in the Sheet:
 *   RSVPs   — one row per reply.  Timestamp | Name | Attending | Party size |
 *             Photos | Notes | Guest names | Invite
 *   Invites — one row per person you invited, and the tracking that goes with
 *             it. Token | Name | Email | Sent | Opened | Replied
 *
 * The invite token is what links the two: every invitation email carries
 * bobs90th.com/?i=TOKEN, so an RSVP arriving with that token is attributable to
 * a specific invitation. Without it the reply still works — it just lands as an
 * untracked walk-in, which is what you want for a link someone forwards.
 */

// ===== CONFIG =============================================================
var SHEET_ID  = '1HuGBOcoVHWQNzgCX98umGW_d4UBkkMCmYcv7GaFWgRA';
var ADMIN_KEY = 'oreo';
var NOTIFY_TO = 'dannylewis@gmail.com';
var FOLDER_ID = '13iNnfaq5j3TxBaQNCZjtfGo4EljruY9Y';
var SITE_URL  = 'https://bobs90th.com/';
var SEND_RSVP_ALERTS = false;   // per-RSVP emails to you; off to save the daily mail quota
// ==========================================================================

/* 'Coming' lists everyone attending on this invitation by name (the contact
   included), and 'Not coming' the ones who declined - an invitation to three
   people where one cannot make it is the normal case, and a party-size number
   on its own cannot say which of them it is. */
var HEADERS  = ['Timestamp', 'Name', 'Attending', 'Party size', 'Photos', 'Notes', 'Coming', 'Invite', 'Not coming'];
var IHEADERS = ['Token', 'Invited', 'Email', 'Seats', 'Sent', 'Opened', 'Replied'];

// ============================== ROUTING ===================================

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);

    // Anything that mutates other people's data, or sends mail, is admin-only.
    if (String(p.type || '').indexOf('admin-') === 0) {
      if (p.key !== ADMIN_KEY) return json({ error: 'Invalid admin key.' });
      if (p.type === 'admin-delete')      return adminDelete(p);
      if (p.type === 'admin-update')      return adminUpdate(p);
      if (p.type === 'admin-add-invites') return addInvites(p);
      if (p.type === 'admin-send')        return sendInvites(p);
      if (p.type === 'admin-send-one')    return sendOne(p);
      if (p.type === 'admin-del-invite')  return deleteInvite(p);
      return json({ error: 'Unknown admin action.' });
    }
    if (p.type === 'photo')  return savePhoto(p);
    if (p.type === 'opened') return markOpened(p);
    return saveRsvp(p);

  } catch (err) {
    try {
      MailApp.sendEmail(NOTIFY_TO, 'RSVP ERROR - Bob 90th',
        'An RSVP came in but could not be saved. Error: ' + err);
    } catch (e2) {}
    return json({ error: String(err) });
  }
}

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};

  // A guest arriving from an invitation link asks who they are.
  if (p.invite) {
    var irow = findInvite(p.invite);
    if (irow < 0) return json({ found: false });
    var iv = invitesSheet().getRange(irow, 1, 1, IHEADERS.length).getValues()[0];
    var everyone = String(iv[1] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    /* If this invitation has already been answered, hand the reply back with
       it. The token is in the link, so a guest opening the email on a second
       device is recognised there too - browser memory alone cannot do that. */
    var reply = null;
    var rrow = findRowByInvite(iv[0]);
    if (rrow < 0 && everyone[0]) rrow = findRowByName(rsvpSheet(), everyone[0]);
    if (rrow > 0) {
      var rv = rsvpSheet().getRange(rrow, 1, 1, HEADERS.length).getValues()[0];
      reply = { name: rv[1], attending: rv[2], guests: rv[3], photos: rv[4],
                toast: rv[5], guestNames: rv[6], notComing: rv[8] || '',
                when: rv[0] ? new Date(rv[0]).toISOString() : '' };
    }

    return json({ found: true, reply: reply, invite: {
      token: iv[0],
      name:  everyone[0] || '',        // the person the form is filled in as
      names: everyone,                 // everyone on this invitation
      seats: parseInt(iv[3], 10) || everyone.length || 1
    }});
  }

  // "Have I already replied?" — unauthenticated by necessity, so it answers
  // only about the one exact name asked for, never a list.
  if (p.lookup) {
    var lrow = findRowByName(rsvpSheet(), p.lookup);
    if (lrow < 0) return json({ found: false });
    var lv = rsvpSheet().getRange(lrow, 1, 1, HEADERS.length).getValues()[0];
    return json({
      found: true,
      rsvp: { name: lv[1], attending: lv[2], guests: lv[3], photos: lv[4],
              toast: lv[5], guestNames: lv[6], notComing: lv[8] || '',
              when: lv[0] ? new Date(lv[0]).toISOString() : '' }
    });
  }

  if ((p.key || '') !== ADMIN_KEY) return json({ error: 'Invalid admin key.' });

  var data = rsvpSheet().getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][1]) continue;
    rows.push({
      timestamp:  data[i][0] ? new Date(data[i][0]).toISOString() : '',
      name:       data[i][1],
      attending:  data[i][2],
      guests:     data[i][3],
      photos:     data[i][4],
      toast:      data[i][5],
      guestNames: data[i][6],
      invite:     data[i][7],
      notComing:  data[i][8] || ''
    });
  }
  rows.sort(function (a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });

  /* Who has actually replied, according to the RSVP rows themselves. The
     Replied stamp alone is not enough: deleting a reply straight out of the
     Sheet leaves the stamp behind, and that guest would then be quietly
     skipped by "remind those who haven't replied" - never chased, never
     noticed. So the stamp only counts if the reply is really still there. */
  var repliedTokens = {}, repliedNames = {};
  for (var t = 0; t < rows.length; t++) {
    if (rows[t].invite) repliedTokens[String(rows[t].invite).trim()] = true;
    repliedNames[norm(rows[t].name)] = true;
  }

  var idata = invitesSheet().getDataRange().getValues();
  var invites = [];
  for (var j = 1; j < idata.length; j++) {
    if (!idata[j][0]) continue;
    var first = String(idata[j][1] || '').split(',')[0].trim();
    var reallyReplied = repliedTokens[String(idata[j][0]).trim()] ||
                        (first && repliedNames[norm(first)]);
    invites.push({
      token:   idata[j][0],
      name:    idata[j][1],
      email:   idata[j][2],
      seats:   idata[j][3] || 1,
      sent:    idata[j][4] ? new Date(idata[j][4]).toISOString() : '',
      opened:  idata[j][5] ? new Date(idata[j][5]).toISOString() : '',
      replied: (reallyReplied && idata[j][6]) ? new Date(idata[j][6]).toISOString()
             : (reallyReplied ? new Date().toISOString() : '')
    });
  }

  var folderUrl = '';
  try { folderUrl = DriveApp.getFolderById(getFolderId()).getUrl(); } catch (err) {}
  return json({ ok: true, rows: rows, invites: invites, folderUrl: folderUrl, siteUrl: SITE_URL });
}

// ============================== GUEST SIDE =================================

function saveRsvp(p) {
  var name      = String(p.name || '').trim().slice(0, 120);
  var attending = p.attending === 'yes' ? 'yes' : 'no';
  var guests    = attending === 'yes' ? Math.max(1, Math.min(20, parseInt(p.guests, 10) || 1)) : 0;
  var photos    = Math.max(0, Math.min(20, parseInt(p.photoCount, 10) || 0));
  var note      = String(p.toast || '').trim().slice(0, 1200);
  var names     = String(p.guestNames || '').trim().slice(0, 600);
  var declined  = String(p.notComing  || '').trim().slice(0, 600);
  var token     = String(p.invite || '').trim().slice(0, 24);

  if (!name) return json({ error: 'A name is required.' });

  var sheet = rsvpSheet();
  var row = findRowByName(sheet, name);

  /* A second reply from the same person UPDATES their line rather than adding
     one, or the headcount double-counts. Photos ADD rather than replace. */
  var oldPhotos = 0, oldNote = '', oldToken = '';
  if (row > 0) {
    oldPhotos = parseInt(sheet.getRange(row, 5).getValue(), 10) || 0;
    oldNote   = sheet.getRange(row, 6).getValue() || '';
    oldToken  = sheet.getRange(row, 8).getValue() || '';
  }

  var values = [new Date(), name, attending, guests, oldPhotos + photos,
                note || oldNote, names, token || oldToken, declined];
  if (row > 0) sheet.getRange(row, 1, 1, values.length).setValues([values]);
  else         sheet.appendRow(values);

  if (token) stampInvite(token, 7);   // column 7 = Replied
  logEvent(row > 0 ? 'Reply changed' : 'Reply', name,
           (attending === 'yes' ? 'Coming, party of ' + guests : 'Not coming') +
           (names ? ' - ' + names : '') +
           (declined ? ' | not coming: ' + declined : '') +
           (photos ? ' | ' + photos + ' photo(s)' : '') +
           (note ? ' | note: ' + String(note).slice(0, 160) : ''), 'guest');
  notify(name, attending, guests, photos, row > 0, note, names);
  return json({ ok: true });
}

function savePhoto(p) {
  var name = String(p.name || 'Guest').trim().slice(0, 120);
  var data = String(p.dataUrl || '');
  var m = data.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (!m) return json({ error: 'Unreadable image.' });

  // One shared folder; the guest's name leads the filename so an alphabetical
  // listing still groups each person's photos together.
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], safeName(name, p.filename));
  var file = DriveApp.getFolderById(getFolderId()).createFile(blob);
  logEvent('Photo', name, file.getName(), 'guest');
  return json({ ok: true, file: file.getName() });
}

/** Fired once when an invitation link is opened. */
function markOpened(p) {
  var t = String(p.invite || '').trim();
  if (t) stampInvite(t, 6);           // column 6 = Opened
  return json({ ok: true });
}

// ============================== ADMIN SIDE =================================

function adminUpdate(p) {
  var sheet = rsvpSheet();
  var row = findRowByName(sheet, p.original || p.name);
  if (row < 0) return json({ error: 'Could not find that guest.' });

  var name      = String(p.name || '').trim().slice(0, 120);
  var attending = p.attending === 'yes' ? 'yes' : 'no';
  var guests    = attending === 'yes' ? Math.max(0, Math.min(20, parseInt(p.guests, 10) || 1)) : 0;
  if (!name) return json({ error: 'A name is required.' });

  // Two rows with the same name would be indistinguishable to the lookup.
  var clash = findRowByName(sheet, name);
  if (clash > 0 && clash !== row) return json({ error: 'Another guest is already called that.' });

  var oldName = sheet.getRange(row, 2).getValue();
  var photos  = parseInt(sheet.getRange(row, 5).getValue(), 10) || 0;
  var note    = p.toast === undefined ? (sheet.getRange(row, 6).getValue() || '')
                                      : String(p.toast || '').trim().slice(0, 1200);
  var names   = p.guestNames === undefined ? (sheet.getRange(row, 7).getValue() || '')
                                           : String(p.guestNames || '').trim().slice(0, 600);
  var token   = sheet.getRange(row, 8).getValue() || '';
  var declined = p.notComing === undefined ? (sheet.getRange(row, 9).getValue() || '')
                                           : String(p.notComing || '').trim().slice(0, 600);

  sheet.getRange(row, 1, 1, HEADERS.length)
       .setValues([[new Date(), name, attending, guests, photos, note, names, token, declined]]);

  logEvent('Edited', name,
           (oldName && oldName !== name ? 'was "' + oldName + '" | ' : '') +
           (attending === 'yes' ? 'Coming, party of ' + guests : 'Not coming') +
           (names ? ' - ' + names : '') +
           (declined ? ' | not coming: ' + declined : ''), 'you');

  var renamed = 0;
  if (norm(oldName) !== norm(name)) renamed = renamePhotos(oldName, name);
  return json({ ok: true, renamedPhotos: renamed });
}

function adminDelete(p) {
  var sheet = rsvpSheet();
  var row = findRowByName(sheet, p.name);
  if (row < 0) return json({ error: 'Could not find that guest.' });
  /* Read the line before it goes, so the log can hold everything it said -
     that is the whole point of a record you cannot delete by accident. */
  var gone = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  var trashed = trashPhotos(p.name);
  sheet.deleteRow(row);
  logEvent('DELETED', gone[1],
           'was: ' + (gone[2] === 'yes' ? 'coming, party of ' + gone[3] : 'not coming') +
           (gone[6] ? ' - ' + gone[6] : '') +
           (gone[8] ? ' | not coming: ' + gone[8] : '') +
           (gone[5] ? ' | note: ' + String(gone[5]).slice(0, 200) : '') +
           (trashed ? ' | ' + trashed + ' photo(s) to Drive bin' : ''), 'you');
  return json({ ok: true, trashedPhotos: trashed });
}

/** Add people to the invite list. Existing emails are updated, not duplicated. */
function addInvites(p) {
  var sheet = invitesSheet();
  var list = p.people || [];
  var added = 0, updated = 0;
  for (var i = 0; i < list.length; i++) {
    var nm = String(list[i].name || '').trim().slice(0, 120);
    var em = String(list[i].email || '').trim().slice(0, 160);
    var howMany = String(nm).split(',').filter(function (x) { return x.trim(); }).length || 1;
    var seats = Math.max(1, Math.min(20, parseInt(list[i].seats, 10) || howMany));
    if (!nm || !em) continue;
    var row = findInviteByEmail(em);
    if (row > 0) {
      sheet.getRange(row, 2, 1, 3).setValues([[nm, em, seats]]); updated++;
      logEvent('Invite updated', nm, em + ' | ' + seats + ' seat(s)', 'you');
    } else {
      sheet.appendRow([newToken(), nm, em, seats, '', '', '']); added++;
      logEvent('Invited', nm, em + ' | ' + seats + ' seat(s)', 'you');
    }
  }
  return json({ ok: true, added: added, updated: updated });
}

/**
 * Send (or resend) invitations.
 * The only= parameter is 'unsent' | 'noreply' | 'all'. Consumer Gmail allows roughly 100
 * emails a day, so the count actually sent is reported back and the rest can
 * go tomorrow rather than failing silently.
 */
function sendInvites(p) {
  var sheet = invitesSheet();
  var data = sheet.getDataRange().getValues();
  var only = p.only || 'unsent';
  var sent = 0, skipped = 0, failed = 0, quota = 0;

  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = 0; }

  /* The email links the artwork rather than attaching it, so this fetch is the
     proof that the picture will actually load for the recipient. If the site
     cannot serve it, refuse to send rather than mail a broken image - that is
     how a broken certificate once sent a test invitation with no picture. */
  var art = inviteImage();
  if (!art) return json({ error: 'Could not load the invitation artwork from the site - nothing was sent. Try again in a minute.' });

  for (var i = 1; i < data.length; i++) {
    var token = data[i][0], nm = data[i][1], em = data[i][2];
    var wasSent = data[i][4], replied = data[i][6];
    if (!token || !em) continue;

    if (only === 'unsent'  && wasSent) { skipped++; continue; }
    if (only === 'noreply' && replied) { skipped++; continue; }
    if (sent >= quota) { skipped++; continue; }

    var link = SITE_URL + '?i=' + encodeURIComponent(token);
    var first = String(nm).split(/\s+/)[0];
    try {
      var msg = {
        to: em,
        subject: "You're invited - Bob's 90th Birthday",
        htmlBody: inviteHtml(first, link, !!art),
        body: inviteText(first, link),
        name: "Bob's 90th Birthday"
      };
      MailApp.sendEmail(msg);
      sheet.getRange(i + 1, 5).setValue(new Date());
      logEvent(wasSent ? 'Invitation resent' : 'Invitation sent', nm, em, 'you');
      sent++;
    } catch (err) { failed++; }
  }
  return json({ ok: true, sent: sent, skipped: skipped, failed: failed, quotaLeft: Math.max(0, quota - sent) });
}

/**
 * Send to exactly one person, by token - for chasing a single guest without
 * touching everyone else on the list. Resending simply refreshes the Sent stamp.
 */
function sendOne(p) {
  var row = findInvite(p.token);
  if (row < 0) return json({ error: 'Could not find that invitation.' });

  var art = inviteImage();
  if (!art) return json({ error: 'Could not load the invitation artwork from the site - nothing was sent. Try again in a minute.' });

  var iv = invitesSheet().getRange(row, 1, 1, IHEADERS.length).getValues()[0];
  var em = iv[2];
  if (!em) return json({ error: 'That invitation has no email address.' });

  var link = SITE_URL + '?i=' + encodeURIComponent(iv[0]);
  var first = String(iv[1]).split(',')[0].split(/\s+/)[0];
  MailApp.sendEmail({
    to: em,
    subject: "You're invited - Bob's 90th Birthday",
    htmlBody: inviteHtml(first, link, true),
    body: inviteText(first, link),
    name: "Bob's 90th Birthday"
  });
  invitesSheet().getRange(row, 5).setValue(new Date());
  logEvent(iv[4] ? 'Invitation resent' : 'Invitation sent', iv[1], em, 'you');
  return json({ ok: true, sent: 1, to: em });
}

function deleteInvite(p) {
  var sheet = invitesSheet();
  var row = findInvite(p.token);
  if (row < 0) return json({ error: 'Could not find that invitation.' });
  var gone = sheet.getRange(row, 1, 1, IHEADERS.length).getValues()[0];
  sheet.deleteRow(row);
  logEvent('Invite removed', gone[1], gone[2] + ' | token ' + gone[0], 'you');
  return json({ ok: true });
}

// ============================== EMAIL ======================================

function inviteText(first, link) {
  return 'Dear ' + first + ',' + '\n\n' +
    'Please join us in celebrating Bob\'s 90th Birthday.' + '\n\n' +
    'Saturday, October 17, 2026' + '\n' +
    'Virginia Country Club, Long Beach' + '\n' +
    'Cocktails 5:00 PM - Dinner 6:30 PM' + '\n' +
    'Cocktail attire' + '\n\n' +
    'Kindly reply by October 1st:' + '\n' + link + '\n\n' +
    'Ninety years well played.';
}

/**
 * The invitation artwork itself, inlined.
 * Fetched from the site once per send batch and attached with a content ID
 * rather than linked: most mail clients block remote images by default, and an
 * invitation that arrives as an empty box is worse than no image at all.
 * Cached in script properties so 100 emails do not mean 100 downloads.
 */
/**
 * Fetch the invitation artwork from the live site.
 *
 * Two bugs were paid for here, so both checks stay:
 *   1. It once trusted muteHttpExceptions and cached whatever came back, so with a
 *      broken certificate it stored a 404 page as "the artwork" and mailed that.
 *      Hence the status check and the JPEG magic-number check.
 *   2. It cached the base64 in CacheService - but that caps a value at 100KB and the
 *      artwork is ~148KB encoded, so put() threw and the whole thing fell into the
 *      catch and returned null. No cache now: one fetch per send batch is cheap.
 */
function inviteImage() {
  try {
    var res = UrlFetchApp.fetch(SITE_URL + 'images/invitation.jpg', {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) return null;

    var bytes = res.getBlob().getBytes();
    if (!bytes || bytes.length < 10000) return null;        // an error page is tiny
    if (bytes[0] !== -1 || bytes[1] !== -40) return null;   // JPEG magic FF D8

    return Utilities.newBlob(bytes, 'image/jpeg', 'invitation.jpg');
  } catch (err) {
    return null;
  }
}

function inviteHtml(first, link, hasImage) {
  /* The invitation artwork IS the interface: the whole image is the link, so
     tapping anywhere - including the printed CLICK TO RSVP - opens the site.

     The image is LINKED from the site, not attached. Measured in Gmail: an
     attached (cid:) copy costs ~790ms every single open because Gmail re-serves
     it from the message each time, while the linked one is ~410ms cold and
     ~55ms once cached. The trade is that a client set to block external images
     shows the alt text instead - which is why the plain link below the picture
     stays, so an RSVP is always one tap away either way.

     height is stated so the layout reserves the space and nothing jumps. */
  var art = '<a href="' + link + '" style="display:block;text-decoration:none">' +
      '<img src="' + SITE_URL + 'images/invitation.jpg" ' +
      'alt="You are invited to Bob 90th Birthday - tap to RSVP" width="600" height="849" ' +
      'style="display:block;width:100%;max-width:600px;height:auto;border:0;margin:0 auto">' +
    '</a>';
  return '<div style="background:#F6F1E3;padding:26px 14px;font-family:Georgia,serif;color:#1B3A63">' +
    '<div style="max-width:600px;margin:0 auto">' + art +
      '<div style="text-align:center;padding:16px 10px 6px">' +
        '<div style="font-size:12.5px;color:#71809A;font-style:italic">Tap the invitation to reply, or use this link:</div>' +
        '<div style="font-size:11.5px;margin-top:6px;word-break:break-all">' +
          '<a href="' + link + '" style="color:#1B3A63">' + link + '</a></div>' +
      '</div>' +
    '</div></div>';
}


function notify(name, attending, guests, photos, isUpdate, note, names) {
  if (!SEND_RSVP_ALERTS) return;
  var yes = attending === 'yes';
  var subject = (isUpdate ? 'Updated RSVP' : 'RSVP') + ' - ' + name + ' ' +
                (yes ? 'is coming' + (guests > 1 ? ' (party of ' + guests + ')' : '') : 'cannot make it');
  var body =
    (isUpdate ? 'This guest changed an earlier reply.' + '\n\n' : '') +
    'Name:      ' + name + '\n' +
    'Attending: ' + (yes ? 'Yes' : 'No') + '\n' +
    (yes ? 'Party of:  ' + guests + '\n' : '') +
    (names ? 'Bringing:  ' + names + '\n' : '') +
    (photos ? 'Photos:    ' + photos + ' uploading\n' : '') +
    (note ? '\nThey added:\n' + note + '\n' : '') +
    '\n- Bob 90th RSVP page';
  try { MailApp.sendEmail(NOTIFY_TO, subject, body); } catch (e) {}
}

// ============================== SHEETS =====================================

function rsvpSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('RSVPs');
  if (!sheet) {
    sheet = ss.insertSheet('RSVPs');
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // Columns are addressed by position, so widen the table in place rather than
  // ever inserting one in the middle.
  if (sheet.getRange(1, 6).getValue() === 'Photo folder') sheet.getRange(1, 6).setValue('Notes');
  if (sheet.getRange(1, 7).getValue() === 'Guest names') sheet.getRange(1, 7).setValue('Coming');
  if (sheet.getRange(1, 7).getValue() !== 'Coming') {
    sheet.getRange(1, 7, 1, 2).setValues([['Coming', 'Invite']]).setFontWeight('bold');
    sheet.setColumnWidth(6, 340);
    sheet.setColumnWidth(7, 300);
  }
  if (sheet.getRange(1, 9).getValue() !== 'Not coming') {
    sheet.getRange(1, 9).setValue('Not coming').setFontWeight('bold');
    sheet.setColumnWidth(9, 240);
  }
  return sheet;
}

/* ---------------------------------------------------------------------------
 * The log
 * A plain history of everything that has happened: every reply, every edit,
 * every deletion, who was invited and when they were emailed. Nothing in this
 * file ever writes over a line or removes one - it is only ever appended to,
 * so a row deleted by mistake can still be read back and retyped. It is yours
 * to clear by hand if it ever gets too long.
 * ------------------------------------------------------------------------- */
var LHEADERS = ['When', 'What', 'Who', 'Details', 'By'];

function logSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Log');
  if (!sheet) {
    sheet = ss.insertSheet('Log');
    sheet.appendRow(LHEADERS);
    sheet.getRange(1, 1, 1, LHEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 210);
    sheet.setColumnWidth(4, 520);
    sheet.setColumnWidth(5, 90);
  }
  return sheet;
}

/** Append one line. Never throws into the caller - a failed log must not cost
 *  someone their RSVP. */
function logEvent(what, who, details, by) {
  try {
    logSheet().appendRow([new Date(), what, who || '', details || '', by || 'guest']);
  } catch (err) { /* the reply matters more than the record of it */ }
}

function invitesSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Invites');
  if (!sheet) {
    sheet = ss.insertSheet('Invites');
    sheet.appendRow(IHEADERS);
    sheet.getRange(1, 1, 1, IHEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 200);
    sheet.setColumnWidth(3, 240);
  }
  return sheet;
}

/** Write a timestamp once — the FIRST open is the interesting one, not the last. */
function stampInvite(token, col) {
  var row = findInvite(token);
  if (row < 0) return;
  var cell = invitesSheet().getRange(row, col);
  if (!cell.getValue()) cell.setValue(new Date());
}

/** The RSVP row that came from a given invitation, or -1. */
function findRowByInvite(token) {
  if (!token) return -1;
  var sh = rsvpSheet();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][7] || '').trim() === String(token).trim()) return i + 1;
  }
  return -1;
}

function findInvite(token) {
  if (!token) return -1;
  var key = String(token).trim().toLowerCase();
  var data = invitesSheet().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === key) return i + 1;
  }
  return -1;
}
function findInviteByEmail(email) {
  var key = String(email).trim().toLowerCase();
  var data = invitesSheet().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim().toLowerCase() === key) return i + 1;
  }
  return -1;
}
function newToken() {
  var a = 'abcdefghjkmnpqrstuvwxyz23456789';   // no look-alike characters
  var s = '';
  for (var i = 0; i < 7; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  return s;
}

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

// ============================== PHOTOS =====================================

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
function trashPhotos(name) { return eachPhotoOf(name, function (f) { f.setTrashed(true); }); }
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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function setup() {
  rsvpSheet(); invitesSheet();
  Logger.log('OK. Mail quota left today: ' + MailApp.getRemainingDailyQuota());
}
