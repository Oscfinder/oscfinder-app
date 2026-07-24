import { Lead } from '@/types';

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT - Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

export const COMPANY_CATEGORIES = [
  'Technology Companies',
  'Manufacturing Companies',
  'Law Firms',
  'Logistics & Courier',
  'Microfinance Banks',
  'Private Schools',
  'Construction Companies',
  'Healthcare & Hospitals',
  'Oil & Gas Companies',
  'Real Estate Firms',
  'Food & Beverage',
  'Retail & Supermarkets',
  'Insurance Companies',
  'Consulting Firms',
  'Media & Advertising',
  'Agriculture & Agribusiness',
  'Baby & Childcare Products',
];

const base = (overrides: Partial<Lead> & Pick<Lead, 'id' | 'name' | 'address' | 'website' | 'emails' | 'phones' | 'category' | 'state' | 'place_id'>): Lead => ({
  company_id:   '',
  job_id:       undefined,
  local_govt:   '',
  linkedin_url: '',
  source:       'google_places',
  lead_score:   0,
  enriched_at:  null,
  status:       'new',
  mail_sent:    false,
  created_at:   new Date().toISOString(),
  ...overrides,
});

export const DUMMY_SCRAPED_COMPANIES: Lead[] = [
  base({ id: 'dummy-1', name: 'Interswitch Group',     address: '1648A Oko-Awo Close, Victoria Island, Lagos', website: 'https://www.interswitchgroup.com', emails: ['info@interswitchgroup.com', 'support@interswitchgroup.com'], phones: ['08001234567', '07012345678'], category: 'Technology Companies', state: 'Lagos', place_id: 'place_dummy_1' }),
  base({ id: 'dummy-2', name: 'Flutterwave Inc.',       address: '3 Olu Holloway Rd, Ikoyi, Lagos',            website: 'https://www.flutterwave.com',      emails: ['hello@flutterwave.com'],                                   phones: ['09087654321'],               category: 'Technology Companies', state: 'Lagos', place_id: 'place_dummy_2' }),
  base({ id: 'dummy-3', name: 'Andela Nigeria',         address: '12 Kofo Abayomi St, Victoria Island, Lagos', website: 'https://www.andela.com',            emails: ['nigeria@andela.com'],                                      phones: ['08123456789'],               category: 'Technology Companies', state: 'Lagos', place_id: 'place_dummy_3' }),
  base({ id: 'dummy-4', name: 'Paystack',               address: '126A Joel Ogunnaike St, Ikeja GRA, Lagos',   website: 'https://www.paystack.com',          emails: ['support@paystack.com', 'business@paystack.com'],           phones: ['07098765432'],               category: 'Technology Companies', state: 'Lagos', local_govt: 'Ikeja', place_id: 'place_dummy_4' }),
  base({ id: 'dummy-5', name: 'Konga Online Shopping',  address: '4 Remi Olowude St, Lekki Phase 1, Lagos',   website: 'https://www.konga.com',             emails: ['info@konga.com'],                                          phones: ['08034567890'],               category: 'Technology Companies', state: 'Lagos', local_govt: 'Lekki', place_id: 'place_dummy_5' }),

  // Agriculture & Agribusiness
  base({ id: 'dummy-6',  name: 'Olam Agri Nigeria',            address: 'Apapa Wharf Rd, Apapa, Lagos',                     website: 'https://www.olamagri.com',            emails: ['info@olamagri.com'],            phones: ['08056781234'],               category: 'Agriculture & Agribusiness', state: 'Lagos', local_govt: 'Apapa', place_id: 'place_dummy_6' }),
  base({ id: 'dummy-7',  name: 'Presco Plc',                   address: 'Sapele Rd, Obaretin, Edo',                         website: 'https://www.presco-plc.com',          emails: ['info@presco-plc.com'],          phones: ['08167891234'],               category: 'Agriculture & Agribusiness', state: 'Edo',   place_id: 'place_dummy_7' }),
  base({ id: 'dummy-8',  name: 'Okomu Oil Palm Company',       address: 'Okomu, Ovia South-West, Edo',                      website: 'https://www.okomunigeria.com',        emails: ['info@okomunigeria.com'],        phones: ['08023456781'],               category: 'Agriculture & Agribusiness', state: 'Edo',   place_id: 'place_dummy_8' }),
  base({ id: 'dummy-9',  name: 'Notore Chemical Industries',   address: 'Onne Industrial Layout, Onne, Rivers',             website: 'https://www.notore.com',              emails: ['info@notore.com'],              phones: ['08034512367'],               category: 'Agriculture & Agribusiness', state: 'Rivers', place_id: 'place_dummy_9' }),
  base({ id: 'dummy-10', name: 'Babban Gona Farmer Services',  address: '15 Bekaji Rd, Yola, Adamawa',                      website: 'https://www.babbangona.com',          emails: ['info@babbangona.com'],          phones: ['08098765123'],               category: 'Agriculture & Agribusiness', state: 'Adamawa', place_id: 'place_dummy_10' }),

  // Baby & Childcare Products
  base({ id: 'dummy-11', name: 'PZ Cussons Nigeria Plc',       address: '45/47 Town Planning Way, Ilupeju, Lagos',          website: 'https://www.pzcussons.com',           emails: ['info@pzcussons.com'],           phones: ['08045671230'],               category: 'Baby & Childcare Products', state: 'Lagos', local_govt: 'Ilupeju', place_id: 'place_dummy_11' }),
  base({ id: 'dummy-12', name: 'FrieslandCampina WAMCO Nigeria', address: '2 Industrial Ave, Ilupeju, Lagos',               website: 'https://www.frieslandcampina.com',    emails: ['info@frieslandcampina.com'],    phones: ['08076541239'],               category: 'Baby & Childcare Products', state: 'Lagos', local_govt: 'Ilupeju', place_id: 'place_dummy_12' }),
  base({ id: 'dummy-13', name: 'Nestle Nigeria Plc',           address: '22/24 Industrial Ave, Ilupeju, Lagos',             website: 'https://www.nestle-cwa.com',          emails: ['consumer.services@ng.nestle.com'], phones: ['08012349876'],            category: 'Baby & Childcare Products', state: 'Lagos', local_govt: 'Ilupeju', place_id: 'place_dummy_13' }),
  base({ id: 'dummy-14', name: 'Hayat Kimya Nigeria (Molfix)', address: 'Agbara Industrial Estate, Agbara, Ogun',           website: 'https://www.hayatkimya.com',          emails: ['info@hayatkimya.com'],          phones: ['08167893456'],               category: 'Baby & Childcare Products', state: 'Ogun',  place_id: 'place_dummy_14' }),
  base({ id: 'dummy-15', name: 'DUKE Diapers Nigeria',         address: '18 Oregun Rd, Ikeja, Lagos',                       website: 'https://www.dukediapers.com',         emails: ['info@dukediapers.com'],         phones: ['08023458901'],               category: 'Baby & Childcare Products', state: 'Lagos', local_govt: 'Ikeja', place_id: 'place_dummy_15' }),
];
