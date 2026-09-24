export default function Loading() {
  return (
    <div className="flex items-center gap-3 py-16 text-sm text-ink-2" role="status" aria-live="polite">
      <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--grid)" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="var(--series-1)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      Reading from Railway…
    </div>
  );
}
