const API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const BASE    = 'https://maps.googleapis.com/maps/api/place';

export async function getCompanies(category: string, location: string) {
  const query = `${category} in ${location}`;
  const res   = await fetch(
    `${BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`
  );
  const data = await res.json();
  console.log('data', data);
  return (data.results ?? []).map((p: any) => ({
    name:    p.name,
    address: p.formatted_address,
    placeId: p.place_id,
  }));
}

export async function getPlaceDetails(placeId: string) {
  // address_components added so we can extract real state + LGA
  const res  = await fetch(
    `${BASE}/details/json?place_id=${placeId}&fields=name,website,formatted_phone_number,address_components&key=${API_KEY}`
  );
  const data = await res.json();
  return data.result ?? null;
}

// ── Parse state and LGA from Google Places address_components ─────
export interface ParsedAddress {
  state:      string | null;
  local_govt: string | null;
}

export function parseAddressComponents(
  components: Array<{ long_name: string; types: string[] }> | undefined
): ParsedAddress {
  if (!components?.length) return { state: null, local_govt: null };

  let state:      string | null = null;
  let local_govt: string | null = null;

  for (const comp of components) {
    if (comp.types.includes('administrative_area_level_1')) {
      // Strip " State" suffix if present (e.g. "Lagos State" → "Lagos")
      state = comp.long_name.replace(/\s+State$/i, '').trim();
    }
    if (comp.types.includes('locality') && !local_govt) {
      local_govt = comp.long_name;
    }
    if (comp.types.includes('administrative_area_level_2') && !local_govt) {
      local_govt = comp.long_name;
    }
    if (comp.types.includes('sublocality_level_1') && !local_govt) {
      local_govt = comp.long_name;
    }
  }

  return { state, local_govt };
}
