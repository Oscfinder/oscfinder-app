// Wraps a plain-text (or personalize()'d) email body in a lightweight, table-based
// HTML shell so outgoing mail doesn't render as one dense unstyled paragraph. Kept
// deliberately neutral (no per-company branding) since these are the client's own
// outreach emails to their own leads, sent under their own display name/reply-to —
// not OsCFinder-branded mail.
export function buildEmailHtml(bodyText: string, unsubscribeReplyTo: string): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p style="margin:0 0 16px 0;">${block.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#F3F4F6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr><td style="height:4px;background-color:#006285;line-height:4px;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:32px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <div style="font-size:14px;line-height:1.7;color:#1A3A5C;">
                  ${paragraphs}
                </div>
                <hr style="border:none;border-top:1px solid #E5E7EB;margin:28px 0 16px 0;">
                <p style="font-size:11px;color:#9CA3AF;margin:0;line-height:1.5;">
                  If you'd rather not receive these emails, reply with "unsubscribe" to
                  <a href="mailto:${unsubscribeReplyTo}" style="color:#9CA3AF;">${unsubscribeReplyTo}</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
