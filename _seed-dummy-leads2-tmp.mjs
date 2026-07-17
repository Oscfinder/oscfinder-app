import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const COMPANY_ID = '1f7583d8-4b4e-4b5a-ada4-c9fabc608533'; // AnchorHMO

const leadsToSeed = [
  { name: 'Anthony Ouzere Chambers',   emails: ['anthonyouzere@nigerianbar.ng'], category: 'Law Firms',           state: 'Rivers' },
  { name: 'Anthony Ouzere Consult',    emails: ['anthonyouzere@gmail.com'],      category: 'Consulting Firms',    state: 'Kano' },
  { name: 'Dantown Test Ventures',     emails: ['testdantown@gmail.com'],        category: 'Retail & Supermarkets', state: 'Kwara' },
  { name: 'Osime Simon Enterprises',   emails: ['osimesimon@gmail.com'],         category: 'Technology Companies', state: 'Lagos' },
  { name: 'Simon Python Tech',         emails: ['simonpython100@gmail.com'],     category: 'Technology Companies', state: 'Nasarawa' },
  { name: 'Jadeh Global',              emails: ['jadeh.be@gmail.com'],           category: 'Media & Advertising',  state: 'Niger' },
  { name: 'Alhassan Hadiza Ventures',  emails: ['alhassanhadiza20@gmail.com'],   category: 'Healthcare & Hospitals', state: 'Ogun' },
  { name: 'Estty Young Consult',       emails: ['esttyoung23@gmail.com'],        category: 'Consulting Firms',     state: 'Ondo' },
];

for (const lead of leadsToSeed) {
  const { data: nameDupes } = await supabase
    .from('leads').select('id').eq('company_id', COMPANY_ID).ilike('name', lead.name).limit(1);
  if (nameDupes && nameDupes.length > 0) {
    console.log(`SKIP (name exists): ${lead.name}`);
    continue;
  }

  const { data: emailDupes } = await supabase
    .from('leads').select('id').eq('company_id', COMPANY_ID).overlaps('emails', lead.emails).limit(1);
  if (emailDupes && emailDupes.length > 0) {
    console.log(`SKIP (email exists): ${lead.name} — ${lead.emails.join(', ')}`);
    continue;
  }

  const { error } = await supabase.from('leads').insert({
    company_id: COMPANY_ID,
    place_id:   `manual-${crypto.randomUUID()}`,
    name:       lead.name,
    address:    '',
    website:    '',
    emails:     lead.emails,
    phones:     [],
    category:   lead.category,
    state:      lead.state,
    local_govt: '',
    city:       null,
    area:       null,
    status:     'new',
    source:     'manual',
    lead_score: 0,
    mail_sent:  false,
  });

  if (error) console.error(`FAILED: ${lead.name}`, error.message);
  else console.log(`INSERTED: ${lead.name} (${lead.category}, ${lead.state}) — ${lead.emails.join(', ')}`);
}
