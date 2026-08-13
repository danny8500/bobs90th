# Bob's 90th — RSVP site setup

Three steps, about 15 minutes, all clicking. Nothing to install, nothing to keep running.

```
Guest opens link  →  index.html (free host)  →  Apps Script  →  ├→ Google Sheet   (the record)
                                                                ├→ email to you   (the backup)
                                                                └→ Drive folder   (their photos)
You open /admin.html  →  Apps Script  →  reads the Sheet  →  the list
```

**Photos.** Guests can attach up to 5. Each one is resized to 1800px and re-encoded as
JPEG *in their browser* before upload — a 6 MB phone photo becomes ~300 KB, which keeps it
well inside Apps Script's limits and makes it quick on bad wifi. It also converts iPhone
HEIC to JPEG on the way, so you won't end up with files half the family can't open.
Each guest gets their own subfolder in Drive, named for them.

---

## 1. Make the Sheet

1. Go to <https://sheets.new> — a blank spreadsheet opens.
2. Name it **Bob's 90th RSVPs**.
3. Copy the **Sheet ID** out of the address bar — it's the long code between `/d/` and `/edit`:

   ```
   https://docs.google.com/spreadsheets/d/1AbC...XYZ/edit
                                          ^^^^^^^^^^  this part
   ```

Don't add any headers — the script writes them the first time it runs.

---

## 2. Make the backend

1. In that Sheet: **Extensions ▸ Apps Script**. A code editor opens in a new tab.
2. Delete whatever is in `Code.gs` and paste in the whole contents of **`Code.gs`** from this folder.
3. Fill in the three values at the top:

   ```js
   var SHEET_ID  = '1AbC...XYZ';                 // from step 1
   var ADMIN_KEY = 'choose-something-long-here'; // your password for /admin
   var NOTIFY_TO = 'arohrlich@gmail.com';        // where RSVP emails go
   var FOLDER_ID = '';                           // leave blank — setup() fills it in
   ```

   For `ADMIN_KEY` use something long and unguessable — e.g. `bob90-duffy-boat-8817-plaid`.
   You'll type it once into the admin page and your browser will remember it for the session.

4. Click **Save** (💾).
5. **Test it before deploying.** In the toolbar, pick the function **`setup`** from the
   dropdown and click **Run**. Google will ask you to authorize — click through
   *Review permissions ▸ your account ▸ Advanced ▸ Go to (project) ▸ Allow*. This is
   Google asking whether *your own* script may use *your own* Sheet and email; it's normal.

   You should now see a **Test Guest** row in the Sheet, an email in your inbox, and a new
   Drive folder called **Bob's 90th — Guest Photos**. The email contains that folder's ID —
   paste it into `FOLDER_ID` and save again (optional, but it pins the folder so it can
   never be recreated by accident). Delete the test row.

   If any of those three didn't happen, stop here — it's much easier to fix now than after
   the invitations go out.

6. Deploy: **Deploy ▸ New deployment**, then
   - click the gear next to "Select type" and choose **Web app**
   - *Description*: `RSVP`
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** ← required, or guests can't submit
   - **Deploy**

7. Copy the **Web app URL**. It ends in `/exec` and looks like:

   ```
   https://script.google.com/macros/s/AKfycb..../exec
   ```

> **When you change `Code.gs` later**, you must do **Deploy ▸ Manage deployments ▸ ✏️ ▸
> Version: New version ▸ Deploy**. Just saving does *not* update the live URL.

---

## 3. Put in the URL and publish the pages

1. Open **`public/index.html`** and **`public/admin.html`** in any text editor.
2. In each, find this line near the bottom and paste your `/exec` URL between the quotes:

   ```js
   var ENDPOINT = "PASTE_YOUR_APPS_SCRIPT_URL_HERE";
   ```

   Same URL in both files.

3. Publish the `public` folder. Easiest option, no account juggling:

   **Netlify Drop** — go to <https://app.netlify.com/drop> and drag the whole `public`
   folder onto the page. It uploads and gives you a live URL in about ten seconds.
   Free, no credit card, stays up indefinitely.

   Then **Site configuration ▸ Change site name** to get something you'd put on an
   invitation, e.g. `bobs-90th.netlify.app`.

   *(Vercel, Cloudflare Pages and GitHub Pages all work the same way if you prefer one.)*

---

## Done — what you now have

| | |
|---|---|
| **Guest link** | your live URL — put this behind CLICK TO RSVP |
| **Your admin list** | the same URL + `/admin.html` — enter the admin key |
| **Spreadsheet** | the Google Sheet, one row per guest |
| **Email** | one per RSVP, as it happens |
| **Photos** | a Drive folder, one subfolder per guest |

The admin page shows total **guests attending** (the sum of party sizes — the number
the country club actually needs), accepted, declined, and how many photos came in.
Filter or search, then **Export CSV** to hand off exactly the list you're looking at.
The photo count on each row links straight to that guest's Drive subfolder.

---

## Things worth knowing

- **Changed replies don't duplicate.** The script matches on email address, so if
  someone RSVPs twice their row is *updated*, not added again. Your headcount stays honest.
- **Two copies of everything.** Sheet + email. If the Sheet write fails, you still get an
  email; you'd have to lose both to lose an RSVP.
- **The admin key isn't real security.** It keeps the list from being casually readable —
  don't put it in the invitation, and don't email it around.
- **Test the whole path once** before you send the invitation: open the live URL on your
  phone, submit a real RSVP, confirm it lands in the Sheet, in your email, and on the
  admin page. Then delete that row.
- **Apps Script quotas** are far above what you need — consumer accounts get around
  100 emails/day, and you're expecting maybe 150 RSVPs over two months.

## If something breaks

| Symptom | Cause |
|---|---|
| Form says "not connected yet" | `ENDPOINT` still says `PASTE_...` in `index.html` |
| Admin says "Invalid admin key" | Key typed doesn't match `ADMIN_KEY` in `Code.gs` |
| Nothing arrives anywhere | *Who has access* wasn't set to **Anyone** |
| Edits to `Code.gs` do nothing | You saved but didn't **Deploy ▸ New version** |
| Admin loads but is empty | No RSVPs yet, or `SHEET_ID` points at the wrong Sheet |
