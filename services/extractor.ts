export function extractEmails(text: string): string[] {
  return [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];
}

export function extractPhones(text: string): string[] {
  return [...new Set(text.match(/(\+234|0)[0-9]{10}/g) ?? [])];
}
