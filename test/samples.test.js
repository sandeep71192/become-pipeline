// Real #sales-test posts (contact details replaced). Each one is a shape the engine must handle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadMessage, isNewLeadMessage } from '../src/parser.js';

const POSTED = new Date(2026, 9, 10, 14, 30);   // Sat 10 Oct 2026
const day = (iso) => new Date(iso).toDateString();

test('LinkedIn name + phone in header, Company: line, one-word requirement', () => {
  const l = parseLeadMessage(`*New Lead/* <https://www.linkedin.com/in/x/|Anand Kumar Sengottayan>, ‪+91 99999 00001‬
Company: <https://numero.io/?utm_source=linkedin|Numero AI>
Source: Rocketlane

Requirement: Rebranding

Next Step: Reachout & get the brief.`, POSTED);
  assert.equal(l.company, 'Numero AI');
  assert.equal(l.contact_name, 'Anand Kumar Sengottayan');
  assert.equal(l.contact_phone, '+91 99999 00001');
  assert.equal(l.need, 'Brand identity');
  assert.equal(l.source_person, 'Rocketlane');
  assert.equal(l.next_step, 'Reachout & get the brief');
});

test('"Lead/" short form, existing-client upsell, value and tomorrow in prose', () => {
  const l = parseLeadMessage(`Lead/ TNQ.



Editorial Central. We've a soft approach for 2.5L for the current work we're doing w: them, <@U05F5TWC59B|Juhi>. Will send proposal tmrw & get it approved.`, POSTED);
  assert.equal(l.company, 'TNQ');
  assert.equal(l.value, 250000);
  assert.deepEqual(l.owner_slack_ids, ['U05F5TWC59B']);
  assert.match(l.next_step, /^Will send proposal tmrw/);
  assert.equal(day(l.next_follow_up_at), day(new Date(2026, 9, 11)));
  assert.equal(l.follow_up_defaulted, undefined);
});

test('pasted prospect message under our instruction', () => {
  const text = `Send the consultation link. He will book, and we will schedule a call after 22nd.

> _Honestly thought most of the clientele was d2c brands ._
> _Was into B2B Fintech sales for about 8 years and now I have started on my own._
> _Have registered a company and started off with GTM Consulting for few startups purely in B2B Fintech / BFSI space._
> _I want to bounce off ideas with someone good in marketing space ( and came across you ) to finalise_
> _Positioning_
> _What can go in the website_
> _Brand guidelines_`;
  assert.equal(isNewLeadMessage(text), true);
  const l = parseLeadMessage(text, POSTED);
  assert.equal(l.company_missing, true);
  assert.equal(l.need, 'Brand identity');
  assert.match(l.next_step, /^Send the consultation link/);
  assert.equal(new Date(l.next_follow_up_at).getDate(), 22);
});

test('"Name, Role, Company" header with tel: and mailto: links', () => {
  const l = parseLeadMessage(`*New Lead/* Bharat Lulla, Director, Sales, HireMee
<tel:+919999900002|+91 99999 00002>
<mailto:someone@hiremee.co.in|someone@hiremee.co.in>

We have already explored doing it. Hire me after that, they ghosted.
*Current Requirement:* they have launched a new SaaS platform for Grade 9 to 12 career assessment. They are looking at someone who can help them do B2C campaigns

<https://hiremee.co.in/assessments|hiremee.co.in/assessments>`, POSTED);
  assert.equal(l.company, 'HireMee');
  assert.equal(l.contact_name, 'Bharat Lulla');
  assert.equal(l.contact_role, 'Director, Sales');
  assert.equal(l.contact_phone, '+91 99999 00002');
  assert.equal(l.contact_email, 'someone@hiremee.co.in');
  assert.equal(l.need, 'Marketing campaigns');
});

test('ordinary chat is not a lead', () => {
  for (const t of ['Anyone free for lunch?', 'Lead update: Skydo call done', 'Thanks, will check and revert.']) {
    assert.equal(isNewLeadMessage(t), false, t);
  }
});

test('screenshot: LinkedIn-style message read by OCR', async () => {
  const { parseScreenshotLead } = await import('../src/parser.js');
  const ocr = `Rhea Kapoor
Head of Marketing at Lumen Skin Labs
Hi Arun, we are relaunching Lumen Skin Labs next quarter
and need a complete rebrand plus a new Shopify store.
Budget is around 12L. Can we talk on Thursday?
rhea@example.in +91 99999 00004`;
  const l = parseScreenshotLead({ note: '<@U05UDFQ1Z7A|Arun Sandeep> can you take this?', ocr, postedAt: POSTED });
  assert.equal(l.company, 'Lumen Skin Labs');
  assert.equal(l.contact_name, 'Rhea Kapoor');
  assert.equal(l.contact_role, 'Head of Marketing');
  assert.equal(l.contact_email, 'rhea@example.in');
  assert.equal(l.contact_phone, '+91 99999 00004');
  assert.equal(l.value, 1200000);
  assert.deepEqual(l.owner_slack_ids, ['U05UDFQ1Z7A']);
  assert.equal(new Date(l.next_follow_up_at).getDay(), 4);   // Thursday
  assert.equal(l.from_screenshot, true);
});

test('screenshot with a typed template on top: template wins, screenshot fills gaps', async () => {
  const { parseScreenshotLead } = await import('../src/parser.js');
  const l = parseScreenshotLead({
    note: 'New Lead/ Lumen Skin\nRequirement: Rebrand\nNext Step: Call on Friday <@U1|Juhi>',
    ocr: 'Rhea Kapoor\nHead of Marketing at Lumen Skin Labs\nrhea@example.in',
    postedAt: POSTED,
  });
  assert.equal(l.company, 'Lumen Skin');                 // typed
  assert.equal(l.need, 'Brand identity');               // typed
  assert.equal(l.contact_name, 'Rhea Kapoor');          // from screenshot
  assert.equal(l.contact_email, 'rhea@example.in');     // from screenshot
  assert.equal(new Date(l.next_follow_up_at).getDay(), 5);
});

test('OCR reads a real image (set OCR_TEST=1; downloads the model once)', { skip: !process.env.OCR_TEST }, async () => {
  const { readFileSync } = await import('node:fs');
  const { imageToText, stopOcr } = await import('../src/ocr.js');
  const text = await imageToText(readFileSync('test/fixtures/linkedin-message.png'));
  await stopOcr();
  assert.match(text, /Lumen Skin Labs/);
  assert.match(text, /rhea@lumenskinlabs\.in/);
});
