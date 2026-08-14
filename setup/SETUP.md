# Bob's 90th — bobs90th.com

**Everything below is live.** This file is the record of what was built and where it lives.

```
Guest opens bobs90th.com  →  GitHub Pages (static site)
        ↓ RSVP / photo
  Google Apps Script  →  ├→ Google Sheet   (the record)
                         ├→ email to you   (the backup)
                         └→ Drive folder   (their photos)
You open /admin.html  →  Apps Script  →  reads the Sheet  →  the list
```

## Where everything is

| | |
|---|---|
| **Guest link** | <https://bobs90th.com> — put this behind CLICK TO RSVP |
| **Your RSVP list** | <https://bobs90th.com/admin.html> |
| **Admin key** | `oreo` |
| **Spreadsheet** | [Bob's 90th RSVPs](https://docs.google.com/spreadsheets/d/1HuGBOcoVHWQNzgCX98umGW_d4UBkkMCmYcv7GaFWgRA/edit) — tabs: RSVPs, Invites, Log |
| **Photos** | [Bob's 90th — Guest Photos](https://drive.google.com/drive/folders/13iNnfaq5j3TxBaQNCZjtfGo4EljruY9Y) — every guest's photos in this one folder |
| **Email alerts** | Off. No mail is sent to you per RSVP (it would eat the daily quota) |
| **Site source** | <https://github.com/danny8500/bobs90th> |
| **Backend code** | [Apps Script project](https://script.google.com/home/projects/1LpajfZr2K9FkupXgUJHM_XhlweNLjRH3NZzjYcjJmD2odcIwFYOMG1Tf/edit) |

## Hosting, in plain terms

- **The website** is on **GitHub Pages** — free, no server, serves from GitHub's CDN.
  It is *not* on Google Cloud.
- **The data** is the Google half: Apps Script (the code that receives an RSVP),
  Google Sheets (the list), Google Drive (the photos), Gmail (the alerts).
- Nothing runs on your PC. If your computer is off, the site still works.

## DNS (GoDaddy)

Set 12 Aug 2026. The four A records are GitHub Pages' anycast IPs.

```
A      @      185.199.108.153
A      @      185.199.109.153
A      @      185.199.110.153
A      @      185.199.111.153
CNAME  www    danny8500.github.io
```

Untouched: the NS, SOA, `_domainconnect`, `pay` and `_dmarc` records. Email routing was
never modified.

## Changing the site

Edit files in `public/`, then:

```sh
cd C:\Users\danny\projects\bob-90
cp public/index.html public/admin.html site/
cd site && git add -A && git commit -m "..." && git push
```

GitHub Pages redeploys in about a minute.

## Changing the backend

Edit `Code.gs`, paste it into the Apps Script editor, save — **then**
**Deploy ▸ Manage deployments ▸ ✏️ ▸ Version: New version ▸ Deploy**.
Saving alone does *not* update the live URL. Currently on Version 15.

**If the version dropdown in "Manage deployments" refuses to open** (it does,
sometimes, and no amount of clicking helps): use **Deploy ▸ New deployment**
instead. That always works. It hands you a NEW /exec URL, so update `ENDPOINT`
at the top of `public/index.html` and `public/admin.html` to match, and push.
Nothing else breaks - guests only ever visit bobs90th.com, never the script URL.

**To test a change without deploying**, use the head URL, which always runs the
last *saved* code:

```
https://script.google.com/macros/s/AKfycbwxA86qp90Og4ZZ2zVfn1q6DTtMZOPqaGE4YEwX09Zg/dev
```

Save in the editor, hit that URL, see the result. Deploy only once it works.
The guest site and admin page always talk to the deployed `/exec` URL.

## Inviting people

The admin page's second tab is the invitation list. Paste names (`Name, email`,
one per line — join couples with `&` and both names are saved) or import a CSV,
press **Add to list**, then send:

- **Send to everyone not yet emailed** — the bulk send
- **Remind those who haven't replied** — chases the outstanding ones
- **Send / Resend** on any row — one person only, for when you just need to
  chase or re-send to a single guest

Each invitation carries its own link (`bobs90th.com/?i=TOKEN`), which is how the
list knows who opened it and who replied, and how a couple's names arrive
pre-filled so they don't retype them. Because the token is in the link, someone
who replies on their laptop and later opens the same email on their phone is
shown the reply they already sent, with a button to change it - the phone does
not need to have been used before.

The email *is* the invitation artwork — the whole picture is the RSVP link. The
script fetches it from `bobs90th.com/images/invitation.jpg` at send time, so
replacing that file changes what gets mailed. If it can't be fetched, the send
is refused with an error rather than mailing a picture-less invitation.

## The Log tab

Everything that happens is appended to it: each reply and change of reply, each
edit or deletion you make, who was invited, when an invitation was emailed, and
each photo. Nothing in the code ever edits or removes a line, so a row deleted
by accident can be read back out of the Log and retyped. It is yours to clear by
hand if it ever gets long.

A deletion records what the line said before it went — reply, party, names and
note — which is the difference between "we lost it" and "we can put it back".

## Several people on one invitation

An invitation naming more than one person (`Tom & Elaine Brady`, or three names
separated by commas) shows each of them their own **Coming / Can't**. The reply
records the headcount plus two lists: **Coming** and **Not coming**, so two out
of three is expressible. The party-size box follows the number coming and can
still be raised to bring someone additional, who gets a name box of their own.

A one-person invitation is unchanged: one answer, and a party size for a guest.

## Things worth knowing

- **Repeat replies don't duplicate.** The script matches on name, so a second reply
  *updates* that guest's row. The page also warns them first and offers to load their
  previous answer.
- **No email is collected**, so name is the only key. That is why the form requires a
  last name, and why two guests with the identical name would share one row — the page
  tells them to add a middle initial.
- **Photos are resized in the browser** to 1800px JPEG before upload (a 6 MB phone photo
  becomes ~300 KB), which also converts iPhone HEIC. Max 5 per guest.
- **Two copies of every RSVP** — Sheet and email. You would have to lose both to lose one.
- **The admin key isn't real security.** It keeps the list from being casually readable.
  Don't put it in the invitation.
- **Apps Script quotas** are far above what you need (~100 emails/day vs ~150 RSVPs over
  two months).

## If something breaks

| Symptom | Cause |
|---|---|
| Site shows a GoDaddy parking page | DNS reverted; re-add the four A records |
| Form says "not connected yet" | `ENDPOINT` in index.html lost its URL |
| Admin says "Invalid admin key" | Key doesn't match `ADMIN_KEY` in Code.gs |
| Backend edits do nothing | Saved but didn't **Deploy ▸ New version** |
| "Could not load the invitation artwork" | The site or that image is unreachable — check <https://bobs90th.com/images/invitation.jpg> loads |
| "You do not have permission to call UrlFetchApp" | The script lost the external-request scope; open the editor, Run any function and approve |
| HTTPS warning | Certificate reissuing; http still works |
