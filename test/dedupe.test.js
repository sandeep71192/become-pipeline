import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { compare, keys, Matcher } = await import('../src/dedupe.js');
const db = await import('../src/db.js');
const { scanDuplicates, findDuplicates } = await import('../src/duplicates.js');
const { importRows, checkRows } = await import('../src/hubspot.js');

const lvl = (a, b) => compare(a, b)?.confidence ?? null;

test('company name normalisation', () => {
  assert.equal(keys({ company: 'Skydo Technologies Pvt. Ltd.' }).core, 'skydo');
  assert.equal(keys({ company: 'The Brew House & Co' }).full, 'brew house and');
  assert.equal(keys({ company: 'Loop Health', contact_email: 'a@gmail.com' }).domain, null);
  assert.equal(keys({ company: 'x', contact_phone: '+91 98450-11111' }).phone, '9845011111');
});

test('confidence levels', () => {
  assert.equal(lvl({ company: 'Skydo' }, { company: 'skydo' }), 'exact');
  assert.equal(lvl({ company: 'Skydo Pvt Ltd' }, { company: 'Skydo' }), 'exact');
  assert.equal(lvl({ company: 'Skydo Technologies' }, { company: 'Skydo' }), 'likely');
  assert.equal(lvl({ company: 'Sky Do' }, { company: 'Skydo' }), 'likely');
  assert.equal(lvl({ company: 'Acme', contact_email: 'a@loophealth.in' }, { company: 'Loop', contact_email: 'b@loophealth.in' }), 'likely');
  assert.equal(lvl({ company: 'A1', contact_phone: '9845011111' }, { company: 'B2', contact_phone: '+91 98450 11111' }), 'likely');
  assert.equal(lvl({ company: 'Skydoo' }, { company: 'Skydo' }), 'possible');
  assert.equal(lvl({ company: 'Northwind' }, { company: 'Northwind Foods Retail' }), 'possible');
  assert.equal(lvl({ company: 'Skydo', hubspot_id: '1' }, { company: 'Skydo', hubspot_id: '2' }), 'possible');
  assert.equal(lvl({ company: 'Loop Health' }, { company: 'Halo Fintech' }), null);
  assert.equal(lvl({ company: 'Pixel Labs' }, { company: 'Pixel Studio' }), 'possible');  // different descriptors
  assert.equal(lvl({ company: 'Pixel Labs' }, { company: 'Quanta Labs' }), null);          // shared descriptor only
  assert.equal(lvl({ company: 'Acme', contact_email: 'x@gmail.com' }, { company: 'Zeta', contact_email: 'y@gmail.com' }), null);
});

test('matcher only compares blocked candidates but finds them', () => {
  const m = new Matcher([{ id: 1, company: 'Skydo' }, { id: 2, company: 'Loop Health' }, { id: 3, company: 'Skydoo Pvt Ltd' }]);
  assert.deepEqual(m.find({ id: 9, company: 'Skydo Technologies' }).map((x) => x.lead.id), [1, 3]);
  assert.equal(m.pairs().length, 1);
});

test('merge, dismiss and undo', () => {
  const a = db.insertLead({ company: 'Skydo', contact_name: 'Diya', owner_name: 'Arun', status: 'discovery_1', slack_ts: '111.1' });
  const b = db.insertLead({ company: 'Skydo Technologies', contact_email: 'diya@skydo.com', owner_name: 'Priya', value: 300000, hubspot_id: 'HS1' });
  const c = db.insertLead({ company: 'Skydoo' });
  db.addActivity(b.id, 'note', 'Note on the duplicate');

  const pairs = scanDuplicates();
  assert.equal(pairs.length, 3);
  const ab = pairs.find((p) => [p.a.id, p.b.id].sort().join() === [a.id, b.id].join());
  assert.equal(ab.confidence, 'likely');
  assert.equal(ab.ownerConflict, true);

  db.dismissPair(a.id, c.id, 'Different company');
  db.dismissPair(b.id, c.id, 'Different company');
  assert.equal(scanDuplicates().length, 1);

  const { mergeId, lead } = db.mergeLeads(a.id, b.id, { owner_name: 'secondary' }, 'Tester');
  assert.equal(lead.owner_name, 'Priya');               // chosen from secondary
  assert.equal(lead.contact_name, 'Diya');              // primary kept
  assert.equal(lead.contact_email, 'diya@skydo.com');   // blank filled from secondary
  assert.equal(lead.hubspot_id, 'HS1');
  assert.ok(lead.activities.some((x) => x.body === 'Note on the duplicate'));
  assert.equal(db.listLeads().length, 2);
  assert.equal(db.getLeadBySlackTs('111.1').id, a.id);
  assert.equal(scanDuplicates().length, 0);
  assert.throws(() => db.mergeLeads(a.id, b.id), /already merged/);

  db.updateLead(a.id, { contact_email: 'edited@skydo.com' });   // edited after merge
  const undo = db.undoMerge(mergeId, 'Tester');
  assert.equal(undo.primary.owner_name, 'Arun');                 // restored
  assert.equal(undo.primary.value, null);
  assert.equal(undo.primary.contact_email, 'edited@skydo.com');  // later edit kept
  assert.deepEqual(undo.kept, ['email']);
  assert.equal(db.listLeads().length, 3);
  assert.equal(scanDuplicates().length, 0);                      // un-merged pair isn't re-flagged
  assert.throws(() => db.undoMerge(mergeId), /already undone/);
});

test('entry check finds matches for an unsaved lead', () => {
  const hits = findDuplicates({ company: 'SKYDO Pvt Ltd' });
  assert.equal(hits[0].confidence, 'exact');
  assert.equal(hits[0].lead.company, 'Skydo');
});

test('HubSpot import: exact updates, likely asks, possible creates flagged, decisions override', () => {
  db.insertLead({ company: 'Orbit Mobility', owner_name: 'Arun' });
  db.insertLead({ company: 'Tandem Payments', contact_email: 'rohit@tandempay.in' });
  const mapping = { company: 'Company', contact_email: 'Email', owner_name: 'Owner' };
  const rows = [
    { Company: 'Orbit Mobility Pvt Ltd', Email: null, Owner: 'Arun' },     // exact
    { Company: 'Tandem Pay', Email: 'ops@tandempay.in', Owner: 'Neha' },    // likely (domain)
    { Company: 'Orbitt Mobility', Email: null, Owner: 'Neha' },             // possible (typo)
    { Company: 'Brand New Co', Email: null, Owner: 'Neha' },
    { Company: 'Brand New Co.', Email: null, Owner: 'Neha' },               // same as row above
  ];
  const check = checkRows(rows, { mapping });
  assert.equal(check.review.length, 2);
  assert.deepEqual(check.review.map((r) => [r.row, r.confidence, r.suggested]), [[3, 'likely', 'update'], [4, 'possible', 'new']]);
  assert.deepEqual(check.inFile.map((r) => [r.row, r.sameAsRow]), [[6, 5]]);

  const result = importRows(rows, { mapping, decisions: { 1: 'new' }, filename: 't.csv' });
  assert.equal(result.created, 3);    // Tandem Pay (forced new), Orbitt, Brand New Co
  assert.equal(result.updated, 0);    // Orbit exact match: nothing new to write
  assert.equal(result.unchanged, 2);  // Orbit + second Brand New row
  assert.equal(result.flagged, 2);
});

test('learned corrections apply to the next similar post', async () => {
  const { ingestMessage } = await import('../src/ingest.js');
  const first = await ingestMessage({ text: 'New Lead/ Zoom Cars\nLooking for an app.\nNext Step: Call tomorrow' });
  db.learnCorrection('company', first.lead.company, 'Zoomcar India');
  const second = await ingestMessage({ text: 'New Lead/ Zoom Cars\nNeeds a dashboard.\nNext Step: Call Friday', force: true });
  assert.equal(second.lead.company, 'Zoomcar India');
  assert.ok(db.getLead(second.lead.id).activities.some((a) => a.body.startsWith('Applied earlier corrections')));
});
