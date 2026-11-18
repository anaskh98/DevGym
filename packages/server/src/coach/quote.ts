// Checks that a quote the AI gives is really in the developer's answer, so a score cannot rest on made-up words.

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** True when the quote (at least 12 characters) is in the answer, ignoring case and spacing. */
export function quoteIn(answer: string, quote: string): boolean {
  const q = squeeze(quote);
  return q.length >= 12 && squeeze(answer).includes(q);
}
