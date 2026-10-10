// Demo data so the board isn't empty before Slack is connected: npm run seed
// Every lead goes through the same parser as real Slack messages.
import 'dotenv/config';
import { ingestMessage } from '../src/ingest.js';
import { updateLead, addActivity, db } from '../src/db.js';

process.env.USE_LLM = 'false';
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const samples = [
  { status: 'deal_generated', at: daysAgo(1), text: `New Lead/ Skydo\n\nLooking for a website. Speaking to Diya, Brand manager.\n\nSource: Vishal, auto pilot\nNext Step: Call on Monday\n@Arun` },
  { status: 'discovery_1', at: daysAgo(4), value: 450000, text: `New Lead/ Northwind Foods\nNeeds a D2C storefront revamp. Speaking to Karan, Head of Growth.\nSource: Meera, SaaSBoomi meetup\nNext Step: Discovery call tomorrow\n@Priya` },
  { status: 'discovery_2', at: daysAgo(9), value: 300000, text: `New Lead/ Loop Health\nLooking for a mobile app redesign. Speaking to Aditi, Product lead.\nSource: Rahul, inbound\nNext Step: Second call on Thursday\n@Arun` },
  { status: 'proposal_1', at: daysAgo(12), value: 800000, text: `New Lead/ Brewhouse Co\nLooking for a brand identity and website. Speaking to Sam, Founder.\nSource: Vishal, referral\nNext Step: Send proposal by 2 Oct\n@Neha` },
  { status: 'follow_up_1', at: daysAgo(16), value: 250000, text: `New Lead/ Tandem Pay\nLooking for a landing page. Speaking to Rohit, Marketing manager.\nSource: Meera, auto pilot\nNext Step: Follow up on 25 Sep\n@Priya` },
  { status: 'finalising_terms', at: daysAgo(21), value: 1200000, text: `New Lead/ Orbit Mobility\nNeeds a fleet dashboard. Speaking to Farah, CTO.\nSource: Rahul, LinkedIn\nNext Step: Terms call on Wednesday\n@Arun` },
  { status: 'sow_msa', at: daysAgo(25), value: 950000, text: `New Lead/ Greenleaf Organics\nLooking for a Shopify build. Speaking to Tanvi, Ecommerce head.\nSource: Vishal, inbound\nNext Step: Share SoW tomorrow\n@Neha` },
  { status: 'on_hold', at: daysAgo(30), value: 400000, text: `New Lead/ Kiteboard\nLooking for a website. Speaking to Jay, COO.\nSource: Meera, auto pilot\nNext Step: Check back in 14 days\n@Priya` },
  { status: 'active_project', at: daysAgo(60), value: 1500000, text: `New Lead/ Halo Fintech\nNeeds an onboarding flow redesign. Speaking to Ishaan, VP Product.\nSource: Rahul, referral\nNext Step: Weekly sync on Friday\n@Arun` },
  { status: 'payment_follow_up', at: daysAgo(90), value: 600000, text: `New Lead/ Crumb Bakery\nLooking for a website. Speaking to Leela, Owner.\nSource: Vishal, walk-in\nNext Step: Chase final invoice on 20 Sep\n@Neha` },
  // Duplicates the team would realistically create:
  { status: 'deal_generated', at: daysAgo(0), text: `New Lead/ Skydo Technologies Pvt Ltd\nLooking for a website revamp. Speaking to Diya, Brand manager.\nSource: Meera, inbound\nNext Step: Call tomorrow\n@Priya` },
  { status: 'discovery_1', at: daysAgo(2), text: `New Lead/ Loop Health Pvt. Ltd.\nNeeds an app redesign. Speaking to Aditi, Product lead.\nSource: Vishal, auto pilot\nNext Step: Call on Friday\n@Arun` },
  { status: 'deal_generated', at: daysAgo(3), text: `New Lead/ Brew House\nLooking for packaging design. Speaking to Sam, Founder.\nSource: Rahul, Instagram\nNext Step: Call on Thursday\n@Priya` },
  { status: 'deal_generated', at: daysAgo(0), text: `New Lead/ Pixel Labs\nLooking for a design system. Speaking to Omar, Design lead.\nSource: Meera, Dribbble\nNext Step: Intro call today` },
];

db.exec('DELETE FROM activities; DELETE FROM merges; DELETE FROM dup_dismissals; DELETE FROM leads;');
for (const s of samples) {
  const { lead } = await ingestMessage({ text: s.text, postedAt: s.at, postedBy: 'Seed data' });
  updateLead(lead.id, { status: s.status, value: s.value ?? null });
  addActivity(lead.id, 'note', 'Demo lead created by seed script', 'Seed data');
}
console.log(`Seeded ${samples.length} demo leads.`);
