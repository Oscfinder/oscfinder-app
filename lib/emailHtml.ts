import { getEmailDesign } from '@/lib/emailDesigns';

// Converts a plain-text (or personalize()'d) email body into paragraph/line-break
// HTML, then hands it to the selected design's shell (lib/emailDesigns.ts) so
// outgoing mail doesn't render as one dense unstyled paragraph. Kept deliberately
// neutral (no per-company branding) since these are the client's own outreach
// emails to their own leads, sent under their own display name/reply-to — not
// OsCFinder-branded mail.
export function buildEmailHtml(
  bodyText: string,
  replyTo: string,
  designId?: string | null,
  senderName?: string | null
): string {
  const bodyHtml = bodyText
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p style="margin:0 0 16px 0;">${block.replace(/\n/g, '<br>')}</p>`)
    .join('');

  const design = getEmailDesign(designId);
  return design.render(bodyHtml, senderName ?? '', replyTo);
}
