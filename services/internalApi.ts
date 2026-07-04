const _warned = { once: false };

export async function checkInternalDB(companyName: string): Promise<boolean> {
  const internalApiUrl = process.env.INTERNAL_COMPANY_API_URL;

  if (!internalApiUrl || internalApiUrl.includes('<')) {
    if (!_warned.once) {
      console.warn("⚠️ INTERNAL_COMPANY_API_URL not set — duplicate-company check skipped.");
      _warned.once = true;
    }
    return false;
  }

  try {
    // 2. Build the URL cleanly
    const url = `${internalApiUrl}?name=${encodeURIComponent(companyName)}`;
    
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return false;
    
    const data = await res.json();
    return data?.exists === true;
  } catch (error) {
    console.error("Failed to fetch internal DB:", error);
    return false;
  }
}
