const INTERNAL_API = process.env.INTERNAL_COMPANY_API_URL!;

export async function checkInternalDB(companyName: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${INTERNAL_API}?name=${encodeURIComponent(companyName)}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.exists === true;
  } catch {
    return false;
  }
}
