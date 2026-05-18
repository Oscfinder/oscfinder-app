export async function checkInternalDB(companyName: string): Promise<boolean> {
  const internalApiUrl = process.env.INTERNAL_COMPANY_API_URL;

  // 1. Guard check: Safe build if variable is missing or has template brackets
  if (!internalApiUrl || internalApiUrl.includes('<')) {
    console.warn("⚠️ INTERNAL_COMPANY_API_URL is missing or misconfigured.");
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
