import { Lead } from '@/types';

export const EXISTING_CLIENTS_DUMMY: Lead[] = [
  {
    id: 'ec-1', name: 'Dangote Industries', address: 'Union Marble House, 1 Alfred Rewane Rd, Ikoyi, Lagos',
    website: 'https://www.dangote.com', emails: ['info@dangote.com', 'procurement@dangote.com'],
    phones: ['07011223344', '08099887766'], status: 'existing', mail_sent: true,
    place_id: 'ep1', category: 'Manufacturing Companies', location: 'Lagos', created_at: '2024-06-01T09:00:00Z',
  },
  {
    id: 'ec-2', name: 'Oando PLC', address: '2 Ajose Adeogun St, Victoria Island, Lagos',
    website: 'https://www.oandoplc.com', emails: ['info@oandoplc.com'],
    phones: ['07099887766'], status: 'existing', mail_sent: true,
    place_id: 'ep2', category: 'Oil & Gas Companies', location: 'Lagos', created_at: '2024-06-05T10:00:00Z',
  },
  {
    id: 'ec-3', name: 'Zenith Bank PLC', address: 'Plot 84, Ajose Adeogun St, Victoria Island, Lagos',
    website: 'https://www.zenithbank.com', emails: ['customerservice@zenithbank.com'],
    phones: ['07002900900'], status: 'existing', mail_sent: false,
    place_id: 'ep3', category: 'Microfinance Banks', location: 'Lagos', created_at: '2024-06-10T08:00:00Z',
  },
  {
    id: 'ec-4', name: 'BUA Cement', address: 'Plot 1, Dala Hills, Kano',
    website: 'https://www.buacement.com', emails: ['info@buacement.com', 'sales@buacement.com'],
    phones: ['07033221100'], status: 'existing', mail_sent: true,
    place_id: 'ep4', category: 'Manufacturing Companies', location: 'Kano', created_at: '2024-06-12T09:00:00Z',
  },
  {
    id: 'ec-5', name: 'Coscharis Group', address: '1 Coscharis St, Kirikiri, Rivers',
    website: 'https://www.coscharisgroup.net', emails: ['info@coscharisgroup.net'],
    phones: ['08044556677'], status: 'existing', mail_sent: false,
    place_id: 'ep5', category: 'Logistics & Courier', location: 'Rivers', created_at: '2024-06-15T11:00:00Z',
  },
  {
    id: 'ec-6', name: 'MTN Nigeria', address: 'MTN Plaza, 30 Afribank St, Victoria Island, Lagos',
    website: 'https://www.mtnonline.com', emails: ['customercare@mtn.com'],
    phones: ['08031234567'], status: 'existing', mail_sent: true,
    place_id: 'ep6', category: 'Technology Companies', location: 'Lagos', created_at: '2024-06-18T14:00:00Z',
  },
  {
    id: 'ec-7', name: 'Julius Berger Nigeria', address: 'Plot 756 Cadastral Zone, Mabushi, Abuja',
    website: 'https://www.julius-berger.com', emails: ['info@julius-berger.com'],
    phones: ['09012345678'], status: 'existing', mail_sent: false,
    place_id: 'ep7', category: 'Construction Companies', location: 'FCT - Abuja', created_at: '2024-06-20T10:00:00Z',
  },
  {
    id: 'ec-8', name: 'Flour Mills of Nigeria', address: '2 Old Dock Rd, Apapa, Lagos',
    website: 'https://www.fmnplc.com', emails: ['info@fmnplc.com', 'hr@fmnplc.com'],
    phones: ['08055443322'], status: 'existing', mail_sent: true,
    place_id: 'ep8', category: 'Food & Beverage', location: 'Lagos', created_at: '2024-06-22T09:00:00Z',
  },
  {
    id: 'ec-9', name: 'Stanbic IBTC Bank', address: 'Plot 1712, Idejo St, Victoria Island, Lagos',
    website: 'https://www.stanbicibtc.com', emails: ['contactcentre@stanbicibtc.com'],
    phones: ['07002000000'], status: 'existing', mail_sent: false,
    place_id: 'ep9', category: 'Microfinance Banks', location: 'Lagos', created_at: '2024-06-25T08:00:00Z',
  },
  {
    id: 'ec-10', name: 'Lafarge Africa PLC', address: '27B Gerrard Rd, Ikoyi, Lagos',
    website: 'https://www.lafarge.com.ng', emails: ['info@lafarge.com.ng'],
    phones: ['08077665544'], status: 'existing', mail_sent: true,
    place_id: 'ep10', category: 'Manufacturing Companies', location: 'Lagos', created_at: '2024-06-28T10:00:00Z',
  },
  {
    id: 'ec-11', name: 'Airtel Nigeria', address: 'Plot 1, Hakeem Balogun St, Ikeja, Lagos',
    website: 'https://www.ng.airtel.com', emails: ['customercare@ng.airtel.com'],
    phones: ['08020000000'], status: 'existing', mail_sent: false,
    place_id: 'ep11', category: 'Technology Companies', location: 'Lagos', created_at: '2024-07-01T09:00:00Z',
  },
  {
    id: 'ec-12', name: 'Kano State Investment Promotion Agency', address: 'Government House Rd, Kano',
    website: 'https://www.kanoinvest.gov.ng', emails: ['info@kanoinvest.gov.ng'],
    phones: ['08033445566'], status: 'existing', mail_sent: true,
    place_id: 'ep12', category: 'Consulting Firms', location: 'Kano', created_at: '2024-07-03T11:00:00Z',
  },
  {
    id: 'ec-13', name: 'Nigerian Breweries PLC', address: '1 Abebe Village Rd, Iganmu, Lagos',
    website: 'https://www.nbplc.com', emails: ['info@nbplc.com', 'sales@nbplc.com'],
    phones: ['08011223344'], status: 'existing', mail_sent: false,
    place_id: 'ep13', category: 'Food & Beverage', location: 'Lagos', created_at: '2024-07-05T08:00:00Z',
  },
  {
    id: 'ec-14', name: 'Transcorp Hotels PLC', address: 'Plot 1129, Aguiyi Ironsi St, Maitama, Abuja',
    website: 'https://www.transcorphotels.com', emails: ['reservations@transcorphotels.com'],
    phones: ['09087654321'], status: 'existing', mail_sent: true,
    place_id: 'ep14', category: 'Real Estate Firms', location: 'FCT - Abuja', created_at: '2024-07-08T12:00:00Z',
  },
  {
    id: 'ec-15', name: 'Seplat Energy PLC', address: '16A Temple Rd, Ikoyi, Lagos',
    website: 'https://www.seplatnigeria.com', emails: ['info@seplatnigeria.com'],
    phones: ['07066778899'], status: 'existing', mail_sent: false,
    place_id: 'ep15', category: 'Oil & Gas Companies', location: 'Lagos', created_at: '2024-07-10T09:00:00Z',
  },
];
