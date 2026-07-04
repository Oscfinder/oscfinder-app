import { Lead } from '@/types';

const base = (overrides: Partial<Lead> & Pick<Lead, 'id' | 'name' | 'address' | 'website' | 'emails' | 'phones' | 'category' | 'state' | 'place_id' | 'created_at'>): Lead => ({
  company_id:  '',
  job_id:      undefined,
  local_govt:  '',
  linkedin_url: '',
  source:      'manual',
  lead_score:  0,
  enriched_at: null,
  status:      'new',
  mail_sent:   false,
  ...overrides,
});

export const ALL_COMPANIES_DUMMY: Lead[] = [
  base({ id: 'ac-1',  name: 'Interswitch Group',    address: '1648A Oko-Awo Close, Victoria Island, Lagos',      website: 'https://www.interswitchgroup.com',  emails: ['info@interswitchgroup.com', 'support@interswitchgroup.com'], phones: ['08001234567'], category: 'Technology Companies',    state: 'Lagos',    place_id: 'p1',  created_at: '2025-01-10T09:00:00Z', mail_sent: true }),
  base({ id: 'ac-2',  name: 'Flutterwave Inc.',      address: '3 Olu Holloway Rd, Ikoyi, Lagos',                 website: 'https://www.flutterwave.com',        emails: ['hello@flutterwave.com'],                                   phones: ['09087654321'], category: 'Technology Companies',    state: 'Lagos',    place_id: 'p2',  created_at: '2025-01-11T10:00:00Z' }),
  base({ id: 'ac-3',  name: 'Dangote Industries',    address: 'Union Marble House, 1 Alfred Rewane Rd, Ikoyi',   website: 'https://www.dangote.com',            emails: ['info@dangote.com'],                                        phones: ['07011223344'], category: 'Manufacturing Companies', state: 'Lagos',    place_id: 'p3',  created_at: '2025-01-12T08:00:00Z', mail_sent: true, status: 'contacted' }),
  base({ id: 'ac-4',  name: 'Eko Hospital',          address: '31 Mobolaji Bank Anthony Way, Ikeja, Lagos',       website: 'https://www.ekohospital.com',        emails: ['contact@ekohospital.com'],                                 phones: ['08033445566'], category: 'Private Hospitals',       state: 'Lagos',    local_govt: 'Ikeja', place_id: 'p4', created_at: '2025-01-13T11:00:00Z' }),
  base({ id: 'ac-5',  name: 'Oando PLC',             address: '2 Ajose Adeogun St, Victoria Island, Lagos',       website: 'https://www.oandoplc.com',           emails: ['info@oandoplc.com', 'pr@oandoplc.com'],                    phones: ['07099887766'], category: 'Oil & Gas Companies',     state: 'Lagos',    place_id: 'p5',  created_at: '2025-01-14T09:30:00Z', mail_sent: true, status: 'qualified' }),
  base({ id: 'ac-6',  name: 'Zenith Bank PLC',       address: 'Plot 84, Ajose Adeogun St, Victoria Island, Lagos', website: 'https://www.zenithbank.com',        emails: ['customerservice@zenithbank.com'],                          phones: ['07002900900'], category: 'Commercial Banks',        state: 'Lagos',    place_id: 'p6',  created_at: '2025-01-15T14:00:00Z' }),
  base({ id: 'ac-7',  name: 'Julius Berger Nigeria', address: 'Plot 756 Cadastral Zone, Mabushi, Abuja',          website: 'https://www.julius-berger.com',      emails: ['info@julius-berger.com'],                                  phones: ['09012345678'], category: 'Construction Companies',  state: 'FCT — Abuja', place_id: 'p7', created_at: '2025-01-16T10:00:00Z' }),
  base({ id: 'ac-8',  name: 'Chicken Republic',      address: '14 Aminu Kano Crescent, Wuse 2, Abuja',            website: 'https://www.chickenrepublic.com',    emails: ['info@chickenrepublic.com'],                                phones: ['08055667788'], category: 'Restaurants & Eateries', state: 'FCT — Abuja', local_govt: 'Wuse', place_id: 'p8', created_at: '2025-01-17T12:00:00Z', mail_sent: true }),
  base({ id: 'ac-9',  name: 'Kano Pillars FC',       address: 'Sani Abacha Stadium, Kano',                        website: 'https://www.kanopillars.com',        emails: ['admin@kanopillars.com'],                                   phones: ['08077889900'], category: 'Media & Advertising',    state: 'Kano',     place_id: 'p9',  created_at: '2025-01-18T09:00:00Z' }),
  base({ id: 'ac-10', name: 'BUA Cement',            address: 'Plot 1, Dala Hills, Kano',                         website: 'https://www.buacement.com',          emails: ['info@buacement.com', 'sales@buacement.com'],               phones: ['07033221100'], category: 'Manufacturing Companies', state: 'Kano',     place_id: 'p10', created_at: '2025-01-19T08:00:00Z', mail_sent: true, status: 'contacted' }),
  base({ id: 'ac-11', name: 'Andela Nigeria',        address: '12 Kofo Abayomi St, Victoria Island, Lagos',       website: 'https://www.andela.com',             emails: ['nigeria@andela.com'],                                      phones: ['08123456789'], category: 'Technology Companies',    state: 'Lagos',    place_id: 'p11', created_at: '2025-01-20T10:00:00Z' }),
  base({ id: 'ac-12', name: 'Coscharis Group',       address: '1 Coscharis St, Kirikiri, Rivers',                 website: 'https://www.coscharisgroup.net',     emails: ['info@coscharisgroup.net'],                                 phones: ['08044556677'], category: 'Logistics & Courier',    state: 'Rivers',   place_id: 'p12', created_at: '2025-01-21T11:00:00Z' }),
];
