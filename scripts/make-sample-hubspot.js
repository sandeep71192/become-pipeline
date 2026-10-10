// Writes samples/hubspot-deals-export.xlsx and samples/hubspot-contacts-export.csv
// shaped like real HubSpot exports, for trying the import: node scripts/make-sample-hubspot.js
import ExcelJS from 'exceljs';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('samples', { recursive: true });
const d = (s) => new Date(`${s}T10:00:00`);

const deals = [
  ['Record ID', 'Deal Name', 'Deal Stage', 'Pipeline', 'Amount', 'Close Date', 'Create Date', 'Deal owner', 'Associated Company', 'Associated Contact', 'Next Activity Date', 'Deal Type', 'Original Source Type'],
  ['18230011', 'Skydo - Website', 'Discovery call 2', 'Sales Pipeline', 350000, d('2026-11-15'), d('2026-09-27'), 'Arun', 'Skydo', 'Diya', d('2026-10-01'), 'New business', 'Referrals'],
  ['18230012', 'Meridian Travel - App redesign', 'Appointment Scheduled', 'Sales Pipeline', 900000, d('2026-12-01'), d('2026-09-10'), 'Priya', 'Meridian Travel', 'Kabir Shah', d('2026-09-30'), 'New business', 'Organic search'],
  ['18230013', 'Fable Books - Brand refresh', 'Presentation Scheduled', 'Sales Pipeline', 500000, d('2026-10-30'), d('2026-08-22'), 'Neha', 'Fable Books', 'Riya Menon', d('2026-09-26'), 'New business', 'Direct traffic'],
  ['18230014', 'Quanta Labs - Website', 'Contract Sent', 'Sales Pipeline', 1100000, d('2026-10-10'), d('2026-08-01'), 'Arun', 'Quanta Labs', 'Dev Patel', d('2026-10-03'), 'New business', 'Offline sources'],
  ['18230015', 'Sprout Kids - Shopify store', 'Closed won', 'Sales Pipeline', 750000, d('2026-08-20'), d('2026-06-12'), 'Priya', 'Sprout Kids', 'Anaya Gupta', null, 'New business', 'Referrals'],
  ['18230016', 'Nimbus HR - Landing page', 'Closed lost', 'Sales Pipeline', 150000, d('2026-09-01'), d('2026-07-15'), 'Neha', 'Nimbus HR', 'Varun Rao', null, 'New business', 'Paid social'],
  ['18230017', 'Atlas Freight - Dashboard', 'Payment pending', 'Delivery', 640000, d('2026-07-30'), d('2026-04-02'), 'Arun', 'Atlas Freight', 'Meher Kapoor', d('2026-09-25'), 'Existing business', 'Referrals'],
  ['18230018', 'Pebble Cafe - Menu site', 'On hold', 'Sales Pipeline', 90000, null, d('2026-08-05'), 'Priya', 'Pebble Cafe', 'Zoya Khan', null, 'New business', 'Direct traffic'],
  ['18230019', 'Untitled deal', 'Qualified To Buy', 'Sales Pipeline', null, null, d('2026-09-20'), '', '', '', null, '', ''],
];
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('All deals');
deals.forEach((r) => ws.addRow(r));
await wb.xlsx.writeFile('samples/hubspot-deals-export.xlsx');

const contacts = `Record ID,First Name,Last Name,Email,Phone Number,Job Title,Company Name,Contact owner,Lead Status,Lifecycle Stage,Create Date
551,Tara,Iyer,tara@lumenskin.in,+91 98450 11111,Founder,Lumen Skin,Neha,New,Lead,2026-09-18 11:04
552,Nikhil,Bose,nikhil@lumenskin.in,,Marketing lead,Lumen Skin,Neha,New,Lead,2026-09-19 09:30
553,Sara,D'Souza,sara@orchard.co,+91 90000 22222,"Head of Brand, APAC",Orchard Co,Arun,Connected,Sales Qualified Lead,19/09/2026 14:00
554,Kabir,Shah,kabir@meridian.travel,,Product head,Meridian Travel,Priya,In progress,Opportunity,2026-09-10 10:00
`;
writeFileSync('samples/hubspot-contacts-export.csv', contacts);
console.log('Wrote samples/hubspot-deals-export.xlsx and samples/hubspot-contacts-export.csv');
