// User avatar: the uploaded photo, or a default figure in the brand style.
export function Avatar({ updatedAt, size = 32, className = "" }: { updatedAt: Date | null; size?: number; className?: string }) {
  if (updatedAt) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/me/avatar?v=${updatedAt.getTime()}`}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ring-1 ring-line ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return <DefaultAvatar size={size} className={className} />;
}

export function DefaultAvatar({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={`shrink-0 rounded-full ring-1 ring-line ${className}`}>
      <rect width="64" height="64" fill="var(--surface-3)" />
      {/* A runner's silhouette with a pulse line — moving + vitals. */}
      <circle cx="38" cy="17" r="6" fill="var(--text)" />
      <path d="M34 25 24 33l4 4 6-4 2 9-8 10 4 3 9-11 6 6v10h5V51l-7-8-2-9 6 3 4-6-5-2-6-3Z" fill="var(--text)" />
      <path d="M6 46h9l3-6 4 11 3-5h6" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
