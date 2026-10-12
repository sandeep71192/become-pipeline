import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_PATH = ':memory:';
const { toSheetRow } = await import('../src/sheets.js');

test('a deal becomes a row shaped like the HubSpot deals export', () => {
  const row = toSheetRow({
    id: 7, company: 'Numero AI', need: 'Brand identity', status: 'discovery_1', owner_name: 'Arun Sandeep',
    value: 450000, created_at: '2026-10-10 09:01:02', updated_at: '2026-10-11 10:00:00',
    contact_name: 'Anand Kumar', contact_role: 'Founder', next_step: 'Get the brief',
    next_follow_up_at: null, source_person: 'Rocketlane', slack_permalink: 'https://slack/p',
  }, 'https://app');
  assert.equal(row.record_id, 'BP-7');
  assert.equal(row.deal_name, 'Numero AI | Brand identity');
  assert.equal(row.deal_stage, 'Discovery Call 1');
  assert.equal(row.close_date, '');
  assert.equal(row.amount, 450000);
  assert.match(row.create_date, /^2026-10-10 \d\d:\d\d$/);
  assert.equal(row.contact, 'Anand Kumar, Founder');
  assert.equal(row.pipeline_link, 'https://app/#lead-7');
});

test('closed deals get a close date; HubSpot-imported deals keep their Record ID', () => {
  const row = toSheetRow({ id: 9, hubspot_id: '351141159621', company: 'X', status: 'closed_lost',
    created_at: '2026-09-29 02:41:00', updated_at: '2026-10-11 08:48:00' }, '');
  assert.equal(row.record_id, '351141159621');
  assert.equal(row.deal_name, 'X | TBD');
  assert.equal(row.deal_stage, 'Closed lost');
  assert.match(row.close_date, /^2026-10-11/);
});
