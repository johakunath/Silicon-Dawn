# Cloud save: Google Sheet + Apps Script

The game can keep one save in your own Google Sheet, so you can play on the desktop and continue on the tablet. Everything stays in your Google account. The game sends no personal data: a save is found only by a random **sync code** that the game makes up (for example `K7QP-M2XD-9FRA`).

You do this once. It takes about 10 minutes. Without it the game works as before, with local saves only.

## 1. Create the Sheet
1. Open https://sheets.google.com and sign in.
2. Click **Blank spreadsheet** (the big plus).
3. Click the title "Untitled spreadsheet" at the top left and type `Silicon Dawn saves`. Press Enter.

## 2. Paste the script
1. In the Sheet menu, click **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
2. Open https://github.com/johakunath/Silicon-Dawn/blob/master/tools/apps-script/Code.gs in another tab. Click the **Copy raw file** button (two overlapping squares, top right of the code).
3. Back in the Apps Script tab, click into the code, select everything (Ctrl+A), and paste (Ctrl+V). The old `function myFunction` text must be gone.
4. Click the **Save** icon (floppy disk). At the top, rename "Untitled project" to `Silicon Dawn backend`.

## 3. Deploy it as a web app
1. Click the blue **Deploy** button (top right) → **New deployment**.
2. Next to "Select type", click the gear icon → **Web app**.
3. Fill in:
   - Description: `cloud save`
   - Execute as: **Me**
   - Who has access: **Anyone** (the game has no Google login; the sync code is the key)
4. Click **Deploy**.
5. Google asks for access: click **Authorize access**, pick your account. If you see "Google hasn't verified this app", click **Advanced** → **Go to Silicon Dawn backend (unsafe)** → **Allow**. This warning appears for every private script; it only gets access to this one Sheet.
6. Copy the **Web app URL** (it ends in `/exec`). Click **Done**.
7. Optional check: paste the URL into a new browser tab. You should see "Silicon Dawn cloud save is running".

## 4. Send the URL to Claude
Paste the Web app URL into the next Claude session (or a GitHub issue) and say "build in the cloud save URL". Claude puts it into the game (`DEFAULT_CLOUD_URL` in `src/ui/cloudsave.ts`), so you and your friends never paste it, only a sync code. Until then, paste it yourself as in step 5.

## 5. Connect each device
1. Open the game: https://johakunath.github.io/Silicon-Dawn/
2. Start or continue a game, then click **☰ (Menu) → SAVE / LOAD**.
3. Under **☁ Cloud save**, the **Script URL** is already filled in once step 4 is done; otherwise paste the Web app URL there.
4. First device: keep the **Sync code** the game shows and write it down. Second device: replace the code with the one from your first device.
5. Click **CONNECT**. You see "Cloud save connected".
6. On the first device click **UPLOAD NOW**. On the second device click **LOAD FROM CLOUD**.

Auto upload is on by default: every 5 minutes of play and when you switch away from the game. It never overwrites a game that is further along or a different game; for that, use UPLOAD NOW (the game asks first).

## Updating the script later
When a new version of `Code.gs` arrives (version 2 adds anonymous telemetry and the friends score sheet; check the first lines of the file for `var VERSION = 2`):
1. Open the Sheet → **Extensions → Apps Script**, replace all code with the new file, click **Save**.
2. Click **Deploy → Manage deployments**, select the deployment, click the **pencil** (Edit).
3. Under Version choose **New version**, click **Deploy**. The URL stays the same, so nothing changes in the game.
4. Check: open the Web app URL in a browser tab. It should say "version 2". After the first game with sharing on, the Sheet gets two new tabs, `telemetry` (one row per run) and `scores` (one row per submitted campaign).

## Telemetry and the score sheet
- Players are asked once before their first game whether to share anonymous run summaries. Only "yes" sends anything; the choice can be changed in Menu → Anonymous run data. A copy of the last 5 runs always stays on the device (Menu → Run log).
- What is sent: a random player id, a random run id, game version, mode, difficulty, seed, era, minutes, era grades and times, money totals, breakdowns, models shipped, a sample every minute (credits, revenue, compute, buildings, problems) and events (era, objective, breakdowns, grants, events, finish, leaving the tab). No name, email, sync code or save data.
- The score sheet needs no consent: the player types a name on the final screen and presses Submit. Anyone can read the top 20 per difficulty; player ids are never sent back.
- To reset: delete the rows (or the whole tab) in the Sheet.

## How it works (for developers)
- `POST` with a JSON body sent as `text/plain` (a "simple" request, so the browser sends no CORS preflight, which Apps Script cannot answer). Apps Script answers with a redirect to `script.googleusercontent.com`, which `fetch` follows.
- Ops: `ping`, `save`, `load`, `info` (saves by sync code), `telemetry` (upsert one row per player and run), `score` and `scores` (submit and read the score sheet). New ops are a handler in `ROUTES` plus a tab name in `TABS`. Text cells lose leading `= + - @`, so nothing is read as a formula.
- The game gzips the save and sends it as base64 (`enc: "gz64"`); browsers without `CompressionStream` send raw JSON. The script splits the string into 40,000-character rows (a Sheets cell holds at most 50,000) in the `saves` tab: `code | slot | part | parts | savedAt | meta | enc | data`. Cells are plain text, so nothing is read as a formula.
- `tests/appsscript.test.ts` runs this script against a fake Sheet.
