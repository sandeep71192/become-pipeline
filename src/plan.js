// Product plan content shown on the Roadmap tab: the feedback cycle, roadmap,
// test scenarios and feedback lenses. Edit here; roadmap items are copied into the
// database on first run so their status can then be changed from the UI.

// The feedback cycle every tab feeds into. Rename stages here if the team uses other words.
export const CYCLE = [
  { key: 'ask',    label: 'Ask',    who: 'Everyone, any time',     text: 'Capture feedback the moment it happens with the Feedback button on any tab, and run the weekly test script.' },
  { key: 'decide', label: 'Decide', who: 'All three, Friday 30 min', text: 'Triage every new item: accept it onto the roadmap, park it, or decline it with a reason. Vote on what matters most.' },
  { key: 'launch', label: 'Launch', who: 'Builder, the next week',   text: 'Ship the smallest change that solves it, then post a one-line release note in #sales.' },
  { key: 'test',   label: 'Test',   who: 'The person who raised it', text: 'They confirm it now works in real use and close it, or send it back to Ask with what is still wrong.' },
];
export const STAGE_KEYS = new Set([...CYCLE.map((c) => c.key), 'done']);

export const FEEDBACK_TYPES = [
  { key: 'bug',      label: 'Broken',       hint: 'Something errors or gives a wrong result' },
  { key: 'friction', label: 'Slow / confusing', hint: 'It works, but takes too many steps or is unclear' },
  { key: 'data',     label: 'Wrong data',   hint: 'Parser misread a message, a duplicate was missed or a false alarm' },
  { key: 'gap',      label: 'Missing',      hint: 'I had to go back to Slack, HubSpot or a sheet to do this' },
  { key: 'idea',     label: 'Idea',         hint: 'Would make the team faster or the pipeline clearer' },
  { key: 'keep',     label: 'Keep this',    hint: 'This works well, so don\'t break it' },
];
export const IMPACTS = [
  { key: 'blocks', label: 'Blocks my work' },
  { key: 'slows',  label: 'Slows me down' },
  { key: 'nice',   label: 'Nice to have' },
];

export const HORIZONS = [
  { key: 'now',   label: 'Now',   when: 'Built, testing this cycle' },
  { key: 'next',  label: 'Next',  when: 'October' },
  { key: 'later', label: 'Later', when: 'November onwards' },
];
export const ROADMAP_STATUSES = [
  { key: 'testing',     label: 'In test' },
  { key: 'planned',     label: 'Planned' },
  { key: 'in_progress', label: 'Building' },
  { key: 'shipped',     label: 'Shipped' },
  { key: 'parked',      label: 'Parked' },
];

export const ROADMAP = [
  { slug: 'slack-capture', horizon: 'now', status: 'testing', title: 'Slack lead capture',
    why: 'Leads posted in #sales get lost in the scroll and nobody knows who owns them.',
    what: '"New Lead/ …" posts become deals automatically: company, contact, need, source, owner (the @-tagged person) and the next-step date.',
    metric: '95% of New Lead posts captured with no manual fixes' },
  { slug: 'board-list', horizon: 'now', status: 'testing', title: 'Board & list views with our stages',
    why: 'There is no single view of where every deal stands.',
    what: 'Sales and Projects pipelines, drag between stages, filters for owner and overdue follow-ups, and a deal panel with its history.',
    metric: 'Monday pipeline review runs from the board, not from Slack' },
  { slug: 'hubspot-import', horizon: 'now', status: 'testing', title: 'HubSpot export import',
    why: 'Our client history lives in HubSpot and must come across without retyping.',
    what: 'Upload .xlsx/.csv, check the column and stage mapping, review duplicates, then import. Safe to re-run.',
    metric: 'Full export imported with under 2% of rows needing a manual fix' },
  { slug: 'duplicates', horizon: 'now', status: 'testing', title: 'Duplicate checks & review',
    why: 'The same client gets logged twice and two people chase it.',
    what: 'Checks on every way in, a review queue, merges you can undo, and "not a duplicate" decisions that are remembered.',
    metric: 'Duplicate queue at zero every Friday; no client chased by two people' },

  { slug: 'go-live', horizon: 'next', status: 'planned', title: 'Go live for all three',
    why: 'The tool only helps once it holds the real pipeline and everyone can open it.',
    what: 'Host it at a shared URL, connect the Slack app to #sales, backfill past posts, import the HubSpot export.',
    metric: 'All three open it daily for two weeks straight' },
  { slug: 'reminders', horizon: 'next', status: 'planned', title: 'Follow-up reminders in Slack',
    why: 'Follow-ups slip because nothing nudges the owner on the day.',
    what: 'A 9:30 DM to each owner listing deals due today or overdue, with Done / Snooze 2 days / Move stage buttons.',
    metric: 'Overdue follow-ups down 50% within 3 weeks' },
  { slug: 'slack-updates', horizon: 'next', status: 'planned', title: 'Update deals from the Slack thread',
    why: 'Opening another tool after every call means updates don\'t happen.',
    what: 'Replies like "moved to Proposal 1" or "next step: call Fri" in the lead\'s thread update the deal.',
    metric: '80% of stage changes made without opening the web app' },
  { slug: 'payments', horizon: 'next', status: 'planned', title: 'Payment follow-ups',
    why: 'Invoices on completed projects get chased late.',
    what: 'Invoice amount and due date on project deals, overdue payment reminders, and a total outstanding.',
    metric: 'No invoice more than 7 days overdue without a chase' },

  { slug: 'dashboard', horizon: 'later', status: 'planned', title: 'Pipeline dashboard',
    why: 'We can\'t see conversion, stage ageing or which sources win.',
    what: 'Value by stage, win rate, time in each stage, and results by owner and by source/event (e.g. Auto Pilot).',
    metric: 'Weekly review takes 15 minutes' },
  { slug: 'my-deals', horizon: 'later', status: 'planned', title: 'Sign in with Slack & "My deals"',
    why: 'A shared password doesn\'t say who changed what.',
    what: 'Slack sign-in, every change attributed to a person, and a personal view with today\'s follow-ups.',
    metric: 'Every change in the log has a named person' },
  { slug: 'email-calendar', horizon: 'later', status: 'planned', title: 'Email & calendar logging',
    why: 'Calls and emails happen outside the tool, so the history is incomplete.',
    what: 'Meetings and emails with a deal\'s contact are added to its timeline automatically.',
    metric: 'Deal history complete without manual notes' },
  { slug: 'retire-hubspot', horizon: 'later', status: 'planned', title: 'Decide: retire HubSpot or sync both ways',
    why: 'Two systems of record means double entry.',
    what: 'Based on what the team still does in HubSpot after 6 weeks, either retire it or add a two-way sync.',
    metric: 'One system of record' },
];

// The weekly test script. `lens` says which perspective each scenario mainly exercises.
export const SCENARIOS = [
  { id: 'T1', lens: 'closer', area: 'Capture', title: 'Log a lead the way you post it in #sales',
    steps: ['Deals → "+ Add from Slack message"', 'Paste a real recent New Lead post, ending with @YourName', 'Create lead, then open the card'],
    expect: 'Card is in Deal generated; company, contact, role, need, source and owner are right; follow-up is the date "Next Step" means, at 10:00.' },
  { id: 'T2', lens: 'ops', area: 'Capture', title: 'A sloppy post: no owner, vague date',
    steps: ['Paste a post with no @mention and "Next Step: call sometime"', 'Open the new card'],
    expect: 'Owner shows "?" and the follow-up defaults to two working days later; both can be changed in the panel and are saved.' },
  { id: 'T3', lens: 'closer', area: 'Pipeline', title: 'Move a deal after a call',
    steps: ['Drag a deal to the next stage', 'Open it, change "Next step" and "Follow-up on", add a note'],
    expect: 'Stage change, edits and note all appear in Activity with the time. Took under 30 seconds.' },
  { id: 'T4', lens: 'lead', area: 'Pipeline', title: 'Run a 10-minute pipeline review',
    steps: ['Filter "Overdue", then each owner in turn', 'Switch to List, sort by Follow-up and by Value'],
    expect: 'You can say which deals are stuck and who owns them without leaving the tool.' },
  { id: 'T5', lens: 'ops', area: 'Duplicates', title: 'Duplicate caught at entry',
    steps: ['Paste "New Lead/ Skydo Pvt Ltd" with any details', 'Choose "Add message to this deal"'],
    expect: 'Warned before anything is created; the message is added to the existing Skydo deal\'s activity.' },
  { id: 'T6', lens: 'lead', area: 'Duplicates', title: 'Merge a duplicate, then undo it',
    steps: ['Duplicates tab → a pair with an owner conflict', 'Pick the deal and owner to keep, merge', 'Recent merges → Undo'],
    expect: 'After merge: one card, combined history, old link opens the survivor. After undo: both cards back as they were.' },
  { id: 'T7', lens: 'ops', area: 'Duplicates', title: 'A false alarm',
    steps: ['Duplicates tab → a pair that is really two clients or two separate deals', '"Not a duplicate" with the right reason'],
    expect: 'The pair disappears and does not come back after a refresh.' },
  { id: 'T8', lens: 'ops', area: 'Import', title: 'Import the real HubSpot export',
    steps: ['In HubSpot export Deals (all columns) as .xlsx', 'Import HubSpot export → check columns and stages → review duplicates → Import', 'Spot-check 5 deals against HubSpot'],
    expect: 'Counts add up; the 5 deals match on company, stage, owner, value and dates; importing again changes nothing.' },
  { id: 'T9', lens: 'lead', area: 'Pipeline', title: 'Won deal to project to payment',
    steps: ['Move a deal to Active project, then Payment follow-up', 'Switch the board to "Projects & payments"'],
    expect: 'It shows in the right column with its value; Sales pipeline totals no longer include it.' },
  { id: 'T10', lens: 'closer', area: 'Find', title: 'Find a client in 10 seconds',
    steps: ['Search a contact\'s first name', 'Search a need, e.g. "website"'],
    expect: 'The right deals appear instantly on both Board and List.' },
  { id: 'T11', lens: 'closer', area: 'Slack', title: 'Real post in #sales (once Slack is connected)', needsSlack: true,
    steps: ['Post a New Lead in #sales tagging the owner', 'Reply in its thread with an update'],
    expect: 'The bot confirms in the thread within seconds with a CRM link; the reply shows in the deal\'s Activity.' },
  { id: 'T12', lens: 'lead', area: 'Slack', title: 'Duplicate posted in Slack (once Slack is connected)', needsSlack: true,
    steps: ['Post a New Lead for a company already in the CRM under a different owner'],
    expect: 'The thread reply warns, names and tags both owners, and links to the Duplicates tab.' },
];

// Three people, three lenses: each person takes a primary lens per cycle and rotates.
export const LENSES = [
  { key: 'lead', label: 'Pipeline lead', focus: 'Is the board the truth, and can I run the week from it?',
    questions: ['Could you run Monday\'s review from the board alone?', 'Which deal surprised you, e.g. a wrong stage or a missing value?',
      'What number did you still work out by hand (total by stage, win rate, stuck deals)?', 'Any ownership conflicts the tool didn\'t surface?'],
    signals: 'Deals with no owner or no follow-up; overdue count by owner; duplicate queue size.' },
  { key: 'closer', label: 'Closer (daily driver)', focus: 'Is updating a deal faster than not updating it?',
    questions: ['How many clicks or seconds to log a call outcome?', 'Did you forget a follow-up this week? Would a reminder have caught it?',
      'What did you still do in Slack, HubSpot, email or a notebook instead?', 'What did you want to see on the card at a glance?'],
    signals: 'Share of deals with a next step; edits per deal per week; follow-ups moved vs missed.' },
  { key: 'ops', label: 'Data & ops', focus: 'Is the data clean enough to trust?',
    questions: ['Which posts did the parser misread, and what did you have to fix?', 'Duplicates: any missed? Any false alarms?',
      'Did the HubSpot import map anything wrongly?', 'Which fields are always blank and could be dropped?'],
    signals: 'Manual edits right after capture (parser misses); merges vs "not a duplicate" (false-alarm rate).' },
];

// People outside the three who will have opinions once it's live.
export const OTHER_VOICES = [
  { who: 'Delivery / project leads', ask: 'Is the Active project handoff clear: scope, value, contact, promised dates?' },
  { who: 'Finance', ask: 'Can you see what is invoiced, due and overdue without asking sales?' },
  { who: 'Founders / leadership', ask: 'Do you get the monthly pipeline and win numbers you need?' },
  { who: 'Referrers (e.g. Vishal) and events (e.g. Auto Pilot)', ask: 'Can we tell them which of their intros turned into work?' },
];

// Getting from "works on one laptop" to "the team's pipeline".
export const NEXT_STEPS = [
  { when: 'This week', step: 'Each of you runs the test script below on the demo data (about 30 minutes) and logs anything odd with the Feedback button.' },
  { when: 'This week', step: 'Friday: first 30-minute Decide session on this tab. Triage every item, then agree the Next column.' },
  { when: 'Week 2', step: 'Host it at a shared URL (e.g. Railway or Render with a persistent disk), turn on the shared password, clear the demo data.' },
  { when: 'Week 2', step: 'Connect the Slack app to #sales, backfill the last 6 months of New Lead posts, import the HubSpot export (T8).' },
  { when: 'Week 2', step: 'Run T11 and T12 on real Slack posts. From here, new leads go to #sales as usual and the board is the source of truth.' },
  { when: 'Week 3', step: 'Build follow-up reminders (top of Next), ship on Monday, re-test on Tuesday, review on Friday.' },
];

// After-action pulses: what to ask after each action. Level 1 = 👍/👎 on `ask`,
// level 2 = accuracy on `accuracy` (+ "what was off" chips), level 3 = how to improve.
export const PULSE_ACCURACY = ['Way off', 'Mostly wrong', 'Partly right', 'Mostly right', 'Spot on'];
export const PULSE_ACTIONS = {
  lead_create:    { label: 'Adding a lead', ask: 'Did the lead come out right?', accuracy: 'How accurately were the fields read?',
    issues: ['Company', 'Contact / role', 'Need', 'Owner', 'Follow-up date', 'Source'] },
  dup_warning:    { label: 'Duplicate warning', ask: 'Was that duplicate warning right?', accuracy: 'How close was the suggested match?',
    issues: ['Not a duplicate', 'Wrong deal suggested', 'Missed the real one', 'Should just merge'] },
  stage_move:     { label: 'Moving a stage', ask: 'Did moving the stage feel right?', accuracy: 'Does the pipeline now show the true picture?',
    issues: ['Hard to drag', 'Missing stage', 'Too many stages', 'Should tell Slack', 'Needs a reason'] },
  deal_edit:      { label: 'Editing a deal', ask: 'Did that save the way you expected?', accuracy: 'How well do these fields fit how you work?',
    issues: ['Missing field', 'Too many clicks', 'Date picker', 'Saved wrong value', 'Unclear label'] },
  note_add:       { label: 'Adding a note', ask: 'Was logging that note quick enough?', accuracy: 'How complete is this deal\'s history now?',
    issues: ['Too slow', 'Want templates', 'Should come from Slack', 'Need @mentions'] },
  dup_merge:      { label: 'Merging duplicates', ask: 'Did the merge turn out right?', accuracy: 'How right is the merged deal?',
    issues: ['Wrong deal kept', 'Wrong values kept', 'History missing', 'Too many choices'] },
  dup_dismiss:    { label: 'Marking not a duplicate', ask: 'Should we have flagged that pair at all?', accuracy: 'How similar did they really look?',
    issues: ['Obviously different', 'Same client, new deal', 'Name too generic'] },
  dup_undo:       { label: 'Undoing a merge', ask: 'Did undo put everything back?', accuracy: 'How fully was it restored?',
    issues: ['Fields not restored', 'History mixed up', 'Card missing'] },
  hubspot_import: { label: 'HubSpot import', ask: 'Did the import land correctly?', accuracy: 'How accurate is the imported data?',
    issues: ['Column mapping', 'Stages', 'Duplicates', 'Dates', 'Values', 'Owners'] },
};

// What's built so far: one title + a ~20-word description each. Shown at the top of the Roadmap tab.
export const BUILT = [
  { title: 'Slack lead capture', text: '"New Lead/" posts in #sales become deals automatically, reading company, contact, need, source, tagged owner and follow-up date, with a thread reply.' },
  { title: 'Board & list views', text: 'Kanban board and sortable list across our sales and project stages, with drag-to-move, owner and overdue filters, and search.' },
  { title: 'Deal panel & history', text: 'Every deal opens into editable fields, notes and a full timeline of stage changes, edits and Slack thread replies.' },
  { title: 'HubSpot import', text: 'Upload a HubSpot .xlsx or .csv export, check column and stage mapping, review duplicates, then import safely; re-running changes nothing.' },
  { title: 'Duplicate checks', text: 'Every new lead is matched against the pipeline; a review page lets us merge with undo, or mark pairs as different.' },
  { title: 'Roadmap & test script', text: 'One tab showing what is built, next and later, live health numbers, and a weekly test script each person marks.' },
  { title: 'Feedback loop', text: 'A Feedback button on every tab sends items through Ask, Decide, Launch and Test, with votes, decisions and full history.' },
  { title: 'Quick checks after actions', text: 'After key actions, a small card asks thumbs up or down, accuracy, and improvements; dismissable, mutable, and never naggy.' },
  { title: 'Become brand interface', text: 'Become\'s colours, type and pill shapes over Apple-style controls, with automatic light and dark mode and phone-friendly layouts.' },
];
