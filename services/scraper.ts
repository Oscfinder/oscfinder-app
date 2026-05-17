import axios from 'axios';
import * as cheerio from 'cheerio';
import { extractEmails, extractPhones } from './extractor';

async function fetchPage(url: string) {
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return cheerio.load(data);
  } catch {
    return null;
  }
}

export async function scrapeContactData(website: string) {
  const $ = await fetchPage(website);
  if (!$) return { emails: [], phones: [] };

  let text = $('body').text();

  // Try contact page
  const contactHref = $("a[href*='contact']").first().attr('href');
  if (contactHref) {
    const contactUrl = contactHref.startsWith('http')
      ? contactHref
      : new URL(contactHref, website).href;
    const $contact = await fetchPage(contactUrl);
    if ($contact) text += $contact('body').text();
  }

  return {
    emails: extractEmails(text),
    phones: extractPhones(text),
  };
}
