/**
 * The DevGym mark: code brackets with a dumbbell as the slash of </>, practice for developers.
 * The same drawing as src/favicon.svg and the plugin icon, without the tile behind it.
 */
export function Logo({ className = "logo" }: { className?: string }) {
  return (
    <svg className={className} viewBox="6 6 52 52" aria-hidden="true" focusable="false">
      <path
        d="M20 18 8 32l12 14M44 18l12 14-12 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g transform="translate(32 32) rotate(-60) scale(0.8) translate(-32 -32)" fill="var(--logo-accent, #8fd1ad)">
        <rect x="24" y="30" width="16" height="4" rx="2" />
        <rect x="19" y="23" width="5" height="18" rx="2.5" />
        <rect x="40" y="23" width="5" height="18" rx="2.5" />
        <rect x="15" y="26.5" width="4" height="11" rx="2" />
        <rect x="45" y="26.5" width="4" height="11" rx="2" />
      </g>
    </svg>
  );
}
