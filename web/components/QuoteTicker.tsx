/**
 * The ledger ticker: the design docs' one-liners scrolling like a tape.
 * Two identical halves make the -50% translate loop seamless; pauses on hover
 * and freezes entirely under reduced motion.
 */
const QUOTES = [
  "Keep what you did, not what you saw.",
  "No number, no launch.",
  "Nobody has touched the exponent.",
  "Memory that might be wrong is worse than no memory.",
  "Recall is not replay.",
  "The report is the demo.",
  "Append, and hope — is not a policy.",
  "Everyone lowers the constant; we attack the exponent.",
];

function Half() {
  return (
    <>
      {QUOTES.map((q) => (
        <span
          key={q}
          className="flex items-center gap-10 mr-10 whitespace-nowrap"
        >
          <span className="font-display italic text-lg text-ink-2">{q}</span>
          <span className="text-copper text-xs" aria-hidden>
            ●
          </span>
        </span>
      ))}
    </>
  );
}

export function QuoteTicker() {
  return (
    <div
      className="border-b hairline overflow-hidden py-4 bg-surface/30"
      role="marquee"
      aria-label="Quotes from the Rote design docs"
    >
      <div className="ticker-track">
        <Half />
        <span aria-hidden className="contents">
          <Half />
        </span>
      </div>
    </div>
  );
}
