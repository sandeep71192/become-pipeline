import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadMessage, parseRelativeDate, isNewLeadMessage } from '../src/parser.js';

// Sunday 27 Sep 2026, 15:00 local
const POSTED = new Date(2026, 8, 27, 15, 0);

const SKYDO = `New Lead/ Skydo

Looking for a website. Speaking to Diya, Brand manager.

Source: Vishal, auto pilot
Next Step: Call on Monday
<@U07OWNER1>`;

test('parses the Skydo example message', () => {
  const lead = parseLeadMessage(SKYDO, POSTED);
  assert.equal(lead.company, 'Skydo');
  assert.equal(lead.need, 'Website');
  assert.equal(lead.contact_name, 'Diya');
  assert.equal(lead.contact_role, 'Brand manager');
  assert.equal(lead.source_person, 'Vishal');
  assert.equal(lead.source_event, 'Auto Pilot');
  assert.equal(lead.next_step, 'Call on Monday');
  assert.deepEqual(lead.owner_slack_ids, ['U07OWNER1']);
  const due = new Date(lead.next_follow_up_at);
  assert.equal(due.getDay(), 1);          // Monday
  assert.equal(due.getDate(), 28);        // the day after posting
  assert.equal(due.getHours(), 10);
});

test('ignores messages that are not new leads', () => {
  assert.equal(isNewLeadMessage('Anyone up for lunch?'), false);
  assert.equal(parseLeadMessage('Lead update: Skydo call done'), null);
});

test('accepts header variants', () => {
  for (const h of ['New Lead/ Acme', '*New Lead* / Acme', 'new lead: Acme', 'NEW LEAD - Acme']) {
    assert.equal(parseLeadMessage(h, POSTED)?.company, 'Acme', h);
  }
});

test('relative dates', () => {
  const d = (s) => parseRelativeDate(s, POSTED);
  assert.equal(d('tomorrow').getDate(), 28);
  assert.equal(d('Friday').getDate(), 2);          // 2 Oct
  assert.equal(d('Sunday').getDate(), 4);          // next Sunday, not today
  assert.equal(d('next week').getDate(), 28);      // coming Monday
  assert.equal(d('in 3 days').getDate(), 30);
  assert.equal(d('5 Oct').getMonth(), 9);
  assert.equal(d('05/10').getDate(), 5);
  assert.equal(d('someday'), null);
});

test('plain @name owner when pasted outside Slack', () => {
  const lead = parseLeadMessage('New Lead/ Acme\nNeeds an app\nNext step: demo tomorrow\n@Arun', POSTED);
  assert.equal(lead.owner_plain, 'Arun');
  assert.equal(lead.need, 'App');
});

test('real #sales post: Slack links, LinkedIn header, phone, email, lakh value, owner mention', () => {
  const msg = `*New Lead/* <https://www.linkedin.com/in/someone/?x=1|Dayanand Bhat>
‪+91 99999 00003‬
<mailto:d@example.com|d@example.com>

Context: Looking for freelance work.

*Requirement:* Madras Music Academy is considering revamping their website.
*Next Step:* Meet them in person <@U05UDFQ1Z7A|Arun Sandeep>. Value anchored at 7L.
*Source:* Dayanand met Sharan at an event in Music Academy, who referred us.`;
  const lead = parseLeadMessage(msg, POSTED);
  assert.equal(lead.company, 'Madras Music Academy');   // found in the text, not the LinkedIn header
  assert.equal(lead.contact_name, 'Dayanand Bhat');
  assert.equal(lead.contact_phone, '+91 99999 00003');
  assert.equal(lead.contact_email, 'd@example.com');
  assert.equal(lead.value, 700000);
  assert.deepEqual(lead.owner_slack_ids, ['U05UDFQ1Z7A']);
  assert.equal(lead.need, 'Website revamp');
  assert.ok(lead.notes.some((n) => n.startsWith('Requirement: Madras Music Academy')));
  assert.equal(lead.source_person, null);
  assert.match(lead.source_event, /^Dayanand met Sharan/);
});

test('engine: finds the client, labels the need, defaults the date', async () => {
  const { findOrganisation, classifyNeed, defaultFollowUp } = await import('../src/engine.js');
  assert.equal(findOrganisation('Madras Music Academy wants a site. Madras Music Academy sells via Zoho.', ['Dayanand Bhat']), 'Madras Music Academy');
  assert.equal(findOrganisation('Spoke to Riya Sharma about it.', ['Riya Sharma']), null);
  assert.equal(classifyNeed('considering revamping their website'), 'Website revamp');
  assert.equal(classifyNeed('needs a Shopify build'), 'E-commerce site');
  assert.equal(classifyNeed('just saying hello'), null);
  const fri = new Date(2026, 9, 9, 15);             // Friday -> Tuesday
  assert.equal(defaultFollowUp(fri).getDay(), 2);
});
