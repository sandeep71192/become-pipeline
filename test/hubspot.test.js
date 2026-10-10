import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DB_PATH = ':memory:';
const { readSheet, suggestMapping, suggestStage, stageValues, importRows, toDate, FIRST_LAST } = await import('../src/hubspot.js');
const { insertLead, listLeads, getLead } = await import('../src/db.js');

const deals = await readSheet(readFileSync('samples/hubspot-deals-export.xlsx'), 'hubspot-deals-export.xlsx');
const contacts = await readSheet(readFileSync('samples/hubspot-contacts-export.csv'), 'hubspot-contacts-export.csv');

test('reads a HubSpot deals .xlsx and maps its columns', () => {
  assert.equal(deals.rows.length, 9);
  const { kind, mapping } = suggestMapping(deals.headers);
  assert.equal(kind, 'deals');
  assert.equal(mapping.hubspot_id, 'Record ID');
  assert.equal(mapping.company, 'Associated Company');
  assert.equal(mapping.need, 'Deal Name');
  assert.equal(mapping.status, 'Deal Stage');
  assert.equal(mapping.owner_name, 'Deal owner');
  assert.equal(mapping.value, 'Amount');
  assert.equal(mapping.next_follow_up_at, 'Next Activity Date');
  assert.equal(mapping.created_at, 'Create Date');
});

test('reads a HubSpot contacts .csv (quoted commas, first + last name)', () => {
  const { kind, mapping } = suggestMapping(contacts.headers);
  assert.equal(kind, 'contacts');
  assert.equal(mapping.hubspot_id, null);
  assert.equal(mapping.company, 'Company Name');
  assert.equal(mapping.contact_name, FIRST_LAST);
  assert.equal(mapping.status, 'Lead Status');
  assert.equal(contacts.rows[2]['Job Title'], 'Head of Brand, APAC');
  assert.equal(contacts.rows[2]['Last Name'], "D'Souza");
});

test('stage suggestions', () => {
  assert.equal(suggestStage('Appointment Scheduled'), 'discovery_1');
  assert.equal(suggestStage('Discovery call 2'), 'discovery_2');
  assert.equal(suggestStage('Follow up 3'), 'follow_up_3');
  assert.equal(suggestStage('Contract Sent'), 'sow_msa');
  assert.equal(suggestStage('Closed won'), 'active_project');
  assert.equal(suggestStage('Closed lost'), 'closed_lost');
  assert.equal(suggestStage('Payment pending'), 'payment_follow_up');
  assert.equal(suggestStage('On hold'), 'on_hold');
  assert.equal(suggestStage('Unqualified'), 'closed_lost');
  assert.equal(suggestStage(''), 'deal_generated');
  assert.equal(stageValues(deals.rows, 'Deal Stage').length, 9);
});

test('dates', () => {
  assert.equal(toDate('19/09/2026 14:00').getMonth(), 8);
  assert.equal(toDate('09/19/2026').getDate(), 19);      // month-first detected
  assert.equal(toDate('03/04/2026').getMonth(), 3);      // ambiguous -> day-first
  assert.equal(toDate('03/04/2026', 'mdy').getMonth(), 2);
  assert.equal(toDate('2026-09-18 11:04').getHours(), 11);
  assert.equal(toDate('not a date'), null);
});

test('imports deals, updates an existing lead, reports bad rows, and is idempotent', () => {
  insertLead({ company: 'Skydo', contact_name: 'Diya', owner_name: 'Arun', status: 'deal_generated' });
  const { mapping } = suggestMapping(deals.headers);
  const stageMap = Object.fromEntries(stageValues(deals.rows, mapping.status).map((s) => [s.value, s.suggested]));

  const first = importRows(deals.rows, { mapping, stageMap, filename: 'deals.xlsx' });
  assert.deepEqual({ ...first, errors: first.errors.length }, { created: 7, updated: 1, unchanged: 0, skipped: 0, flagged: 0, errors: 1 });
  assert.equal(first.errors[0].row, 10);

  const skydo = listLeads().find((l) => l.company === 'Skydo');
  assert.equal(skydo.hubspot_id, '18230011');
  assert.equal(skydo.status, 'discovery_2');
  assert.equal(skydo.value, 350000);
  assert.ok(getLead(skydo.id).activities.some((a) => a.type === 'status_change'));

  const atlas = listLeads().find((l) => l.company === 'Atlas Freight');
  assert.equal(atlas.status, 'payment_follow_up');
  assert.equal(atlas.need, 'Atlas Freight - Dashboard');
  assert.equal(atlas.created_at.slice(0, 10), '2026-04-02');

  const again = importRows(deals.rows, { mapping, stageMap, filename: 'deals.xlsx' });
  assert.equal(again.created, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.unchanged, 8);
});

test('contacts: one lead per company, extra contacts only fill blanks', () => {
  const { mapping } = suggestMapping(contacts.headers);
  const r = importRows(contacts.rows, { mapping, mode: 'skip', filename: 'contacts.csv' });
  assert.equal(r.created, 2);   // Lumen Skin, Orchard Co
  assert.equal(r.skipped, 1);   // Meridian Travel already exists from the deals import
  const lumen = listLeads().find((l) => l.company === 'Lumen Skin');
  assert.equal(lumen.contact_name, 'Tara Iyer');
  assert.equal(lumen.contact_email, 'tara@lumenskin.in');
  const orchard = listLeads().find((l) => l.company === 'Orchard Co');
  assert.equal(orchard.status, 'discovery_1');
  assert.equal(orchard.contact_role, 'Head of Brand, APAC');
});
