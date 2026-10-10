# Sales Pipeline: slice 1

A small HubSpot-style CRM fed by the Slack sales channel.

* A top-level message in #sales starting with `New Lead/ <Company>` becomes a deal in **Deal generated**.
* The bot replies in the thread with what it read and a link to the deal.
* The **owner** is the first person @-tagged in the message. If nobody is tagged, the bot asks in the thread. Tagging someone in a reply then assigns them.
* Thread replies are saved to the deal's activity log.
* **Board** and **List** views cover the Sales pipeline (Deal generated → SoW & MSA, On-hold, Closed/Lost) and the Projects pipeline (Active, On hold, Completed, Payment follow-up). Drag a card to change its stage. The change is also posted back to the Slack thread.

## Run it

```bash
npm install
cp .env.example .env
npm run seed      # optional demo data
npm start         # http://localhost:3000
npm test
```

Node 22.5+ is required, since it uses the built-in `node:sqlite`. The data lives in `data/crm.db`.

## Import from HubSpot

Click **Import HubSpot export** and choose an `.xlsx` or `.csv` file. It can be a HubSpot export of Deals, Companies or Contacts.

1. **Columns** are matched automatically from HubSpot's header names (Record ID, Associated Company, Deal Stage, Deal owner, Amount, Next Activity Date, First/Last Name, Email and so on). You can change any match.
2. **Stages**: each distinct HubSpot stage or lead status is shown with a suggested stage on your board. HubSpot's defaults are pre-mapped, e.g. Appointment Scheduled → Discovery call 1, Contract Sent → SoW & MSA, Closed won → Active project. Stages already named like yours ("Discovery call 2") map directly.
3. **Import.** A row matches an existing deal by HubSpot Record ID first, then by company name. You choose whether matches are updated or left alone. Blank cells never erase existing data. Re-importing the same file changes nothing.

For Contacts exports, several contacts from one company become one deal. The first contact is kept, and later rows only fill empty fields. Rows without a company are listed as not imported, with their row numbers.

Try it with the files in `samples/`. Regenerate them with `node scripts/make-sample-hubspot.js`.

## Duplicates: checks and balances

Every way a lead can get in is checked against the pipeline with the same matching rules ([src/dedupe.js](src/dedupe.js)):

| Confidence | When |
|---|---|
| **Exact** | Same HubSpot record, or same company name once "Pvt Ltd / Ltd / LLP / Inc / The…" are removed |
| **Likely** | Same core name ("Skydo" vs "Skydo Technologies"), same company email domain (gmail and other free providers ignored), same contact email, or same phone |
| **Possible** | Similar spelling ("Kitebord" vs "Kiteboard"), one name containing the other, the same full contact name at a similar company, the same main name with different descriptors ("Pixel Labs" vs "Pixel Studio"), or the same company under two different HubSpot deals |

**At entry**

* **Slack:** the lead is still created, so nothing is lost. The bot's thread reply warns who already owns the similar deal and tags both owners if they differ. If the old deal is Closed/Lost or Completed, it's shown as a possible returning client instead.
* **Paste box:** nothing is created until someone chooses **Add message to the existing deal** or **Create as a new deal anyway**.
* **HubSpot import:** a review step comes before anything is written.
  * Exact matches update automatically.
  * Likely matches default to updating the existing deal, and possible matches default to creating a new one that stays flagged. Each row can be switched to update, create or skip.
  * Rows that repeat inside the same file are combined.
  * Existing company names and HubSpot links are never overwritten by an import.

**After entry**

* **Duplicates page:** a count in the nav, and suspected pairs listed strongest first.
  * Pairs with different owners are marked **owner conflict**.
  * Each pair is compared side by side. Choose which deal to keep and which value wins per field. Blanks are filled from the other deal, and the activity from both is combined.
  * **Not a duplicate** (with a reason) is remembered, so the pair stops being flagged. It can be flagged again later.
* **Merges are undoable** from "Recent merges". The merged deal comes back, and fields the merge changed are restored unless someone edited them since. An un-merged pair isn't flagged again.
* **Old links and Slack threads keep working:** links to a merged-away deal open the surviving deal, and replies in its Slack thread are logged there.
* Cards on the board show **⚠ Possible duplicate**, and the deal panel lists the likely twins.

## Roadmap tab: the feedback loop

The **Roadmap** tab is where the team agrees what's built, what's next and what was learned. Its content (roadmap, test script, feedback lenses, next steps) lives in [src/plan.js](src/plan.js).

* **Overview:** the current weekly cycle, the Ask → Decide → Launch → Test loop with item counts, live health numbers (owners, follow-ups, overdue, parser fixes, duplicate queue, false alarms), test progress per person, and next steps.
* **Roadmap:** Now / Next / Later. Each item has why, what and a "done when" measure. Status and horizon are editable, and each item links to its feedback.
* **Test this week:** 12 scenarios, each tagged with a lens. Everyone marks pass, fail or skip. A fail asks what went wrong and files a "Broken" item in Ask.
* **Feedback loop:** a board with Ask, Decide, Launch, Test and Done. Rules:
  * Accepting needs a roadmap link, and parking or declining needs a reason.
  * Only the person who raised an item confirms the fix. "Still not right" sends it back to Ask.
  * Items can be +1'd, and the full history is kept.

The **💬 Feedback** button on every tab records the tab and any open deal. Set `TEAM=` in `.env` to your three names.

## Quick checks after actions

After key actions, a small dark card slides in at the bottom left and asks one level at a time. Actions covered: adding a lead, a duplicate warning, moving a stage, editing a deal, adding a note, merging, marking not a duplicate, undoing a merge, and a HubSpot import.

1. **👍 / 👎**: "Did the lead come out right?"
2. **Accuracy 1–5**. After a 👎 or a low score, it also shows "what was off" chips specific to the action.
3. **How could it be better?** (optional words)

Each level is saved the moment it's answered. A 👎 with a comment is filed in **Ask** automatically. Results are rolled up per action under Roadmap → Feedback loop → "Quick checks after actions", worst first. They're also counted in the "of actions rated 👍" tile on the Overview.

**Keeping it light** (per browser):
* One card at a time. It never covers an open dialog, and it waits until the dialog closes.
* It auto-hides after 12 seconds if untouched (paused while hovered or focused).
* There's a minimum gap between cards, a cooldown per action, and a daily cap.
* Sampling thins out once an action has been asked a few times. Ignoring an action three times backs it off further.
* **×** closes the card. **•••** has "Don't ask about this again" and "Pause for today". A shortcut appears once an action has been asked three times.
* Modes are set in the name dialog (click your name top right): **Early stage** (default, asks often), **Balanced**, or **Off**. Muted actions can be re-enabled there.

Questions and chips for each action live in `PULSE_ACTIONS` in [src/plan.js](src/plan.js).

## Look and feel

Three style layers are loaded in order: [styles.css](public/styles.css) (layout), [apple.css](public/apple.css) (Apple interaction patterns: segmented controls, sheets, switches, blur) and [become.css](public/become.css) (Become® brand from become.team).

The Become layer uses:
* Whitesmoke and near-black colours, with a periwinkle `#8b96f8` accent.
* Inter Tight headlines at regular weight (standing in for PolySans, which is a paid font), Inter body text and DM Mono labels.
* Pill buttons, a black top bar and the cube mark.

Delete a `<link>` in `index.html` to drop a layer.

## Deploy to Railway

1. Push this repo to GitHub (a company organisation is best, so it can move later).
2. In Railway: **New Project → Deploy from GitHub repo** and pick it. `railway.json` sets the start command, health check (`/healthz`) and **one** replica. Keep it at one, so only one copy talks to Slack.
3. **Add a Volume** to the service, mounted at `/data`.
4. **Variables:**
   * `DB_PATH=/data/crm.db`
   * `TZ=Asia/Kolkata` (reminders go out at 09:30 local)
   * `APP_URL=https://<your-app>.up.railway.app` (used in Slack links)
   * `APP_PASSWORD=<shared password>`
   * `TEAM=Arun,Harish,Juhi`
   * `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` and `SLACK_SALES_CHANNEL_ID`
5. **Stop any local copy** that uses the same Slack tokens, then deploy. `/healthz` should return `{"ok":true,"slack":true}`.
6. **Load data:** run `railway ssh`, then `npm run backfill -- 30`, then use **Import HubSpot export** in the app. Never run `npm run seed` there, because it deletes all deals.

## Connect Slack (about 5 minutes)

1. Go to https://api.slack.com/apps → **Create New App** → **From an app manifest**. Pick the workspace and paste `slack-manifest.yml`.
2. Under **Basic Information → App-Level Tokens**, generate a token with the `connections:write` scope. This is `SLACK_APP_TOKEN` (`xapp-…`).
3. Under **Install App**, install it to the workspace and copy the Bot token. This is `SLACK_BOT_TOKEN` (`xoxb-…`).
4. In Slack, open #sales → channel details → copy the Channel ID into `SLACK_SALES_CHANNEL_ID`. Then run `/invite @pipeline` in the channel.
5. Run `npm start`. The header should show "● Slack connected".
6. Import history with `npm run backfill -- 180` for the last 180 days. It's safe to re-run.

Socket Mode means no public URL or ngrok is needed. The app connects out to Slack.

## Message format

```
New Lead/ Skydo
Looking for a website. Speaking to Diya, Brand manager.
Source: Vishal, auto pilot
Next Step: Call on Monday
@Arun
```

| Line | Field |
|---|---|
| `New Lead/ X` (also `New Lead: X`, `*New Lead* - X`) | company |
| "Looking for / needs / wants …" | need |
| "Speaking to / spoke with / POC … , Role" | contact + role |
| `Source: Person, Event-or-company` | source person + source event |
| `Next Step: …` | next step + follow-up date ("Monday", "tomorrow", "in 3 days", "5 Oct", "05/10") |
| first @mention | owner |

Weekday names resolve to the next such day after the post date. Follow-ups default to 10:00.

Setting `ANTHROPIC_API_KEY` adds a Claude pass that reads free-text phrasing the rules miss. Any API failure falls back to the rule parser.

## Code map

| File | Purpose |
|---|---|
| `src/parser.js` | Rule-based message parser and date resolution |
| `src/extract.js` | Optional Claude refinement (structured output) |
| `src/ingest.js` | Message → lead (shared by Slack, backfill, paste, seed) |
| `src/slack.js` | Bolt bot: new leads, thread replies, owner assignment |
| `src/server.js` | REST API + static UI |
| `src/dedupe.js` | Name normalisation, similarity, confidence levels, blocking index |
| `src/duplicates.js` | Duplicate checks against the live pipeline |
| `src/hubspot.js` | HubSpot .xlsx/.csv reading, column + stage matching, upsert |
| `src/statuses.js` | Stage list; edit here to add or rename stages |
| `public/` | Board, list, deal drawer, Duplicates page, paste-import and HubSpot-import dialogs |

## Next slices

2. **Follow-up reminders.** A morning Slack DM to each owner listing due and overdue deals, with *Done / Snooze / Move stage* buttons.
3. **Payment follow-ups.** Invoice amount and due date on project deals, with reminders.
4. **Dashboard.** Pipeline value by stage, conversion and deals per owner.
5. **Sign-in with Slack** in place of the shared password, and hosting (Railway/Render/Fly with a volume, or Postgres).
