const API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const BASE = 'https://maps.googleapis.com/maps/api/place';

export async function getCompanies(category: string, location: string) {
  const query = `${category} in ${location}`;
  const res = await fetch(
    `${BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`
  );
  const data = await res.json();
  console.log('data', data)
  return (data.results ?? []).map((p: any) => ({
    name: p.name,
    address: p.formatted_address,
    placeId: p.place_id,
  }));
}

export async function getPlaceDetails(placeId: string) {
  const res = await fetch(
    `${BASE}/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number&key=${API_KEY}`
  );
  const data = await res.json();
  return data.result ?? null;
}
