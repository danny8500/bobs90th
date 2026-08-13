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
| **Admin key** | `bob90-bruin-anchor-2941` |
| **Spreadsheet** | [Bob's 90th RSVPs](https://docs.google.com/spreadsheets/d/1HuGBOcoVHWQNzgCX98umGW_d4UBkkMCmYcv7GaFWgRA/edit) |
| **Photos** | [Bob's 90th — Guest Photos](https://drive.google.com/drive/folders/13iNnfaq5j3TxBaQNCZjtfGo4EljruY9Y) — one subfolder per guest |
| **Email alerts** | dannylewis@gmail.com, one per RSVP |
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
Saving alone does *not* update the live URL. Currently on Version 2.

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
| HTTPS warning | Certificate reissuing; http still works |
