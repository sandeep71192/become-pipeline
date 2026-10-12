/**
 * Become Pipeline → Google Sheet sync.
 * Paste into the sheet: Extensions → Apps Script. Then:
 *   1. Project Settings (gear) → Script properties → add SECRET = <same value as SHEETS_SECRET in Railway>
 *   2. Deploy → New deployment → type "Web app" → Execute as: Me · Who has access: Anyone → Deploy
 *   3. Copy the Web app URL into Railway as SHEETS_WEBHOOK_URL
 * Rows are matched on Record ID (column A): existing rows are updated, new ones appended.
 */

// The tab to write to (the number after "gid=" in the sheet URL).
const TAB_ID = 1939439655;

// Columns A–G are the HubSpot export's; H–M are added for context if missing.
const COLUMNS = [
  ['record_id', 'Record ID'], ['deal_name', 'Deal Name'], ['deal_stage', 'Deal Stage'], ['close_date', 'Close Date'],
  ['deal_owner', 'Deal owner'], ['amount', 'Amount'], ['create_date', 'Create Date'],
  ['contact', 'Contact'], ['next_step', 'Next step'], ['follow_up', 'Follow-up date'], ['source', 'Source'],
  ['slack_link', 'Slack post'], ['pipeline_link', 'Pipeline link'],
];

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: 'bad json' }); }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || body.secret !== secret) return reply({ ok: false, error: 'unauthorized' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);   // two leads at once must not write the same row
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets().find((s) => s.getSheetId() === TAB_ID);
    if (!sheet) return reply({ ok: false, error: 'tab not found' });
    ensureHeaders(sheet);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const lastRow = sheet.getLastRow();
    const ids = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map((r) => String(r[0])) : [];
    let updated = 0, added = 0;
    rows.forEach((row) => {
      const values = [COLUMNS.map(([key]) => row[key] ?? '')];
      const at = ids.indexOf(String(row.record_id));
      if (at >= 0) {
        sheet.getRange(at + 2, 1, 1, COLUMNS.length).setValues(values);
        updated++;
      } else {
        sheet.appendRow(values[0]);
        ids.push(String(row.record_id));
        added++;
      }
    });
    return reply({ ok: true, updated, added });
  } finally {
    lock.releaseLock();
  }
}

function ensureHeaders(sheet) {
  const header = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  COLUMNS.forEach(([, title], i) => {
    if (!header[i]) sheet.getRange(1, i + 1).setValue(title);
  });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
