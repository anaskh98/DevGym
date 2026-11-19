/** A few hand-drawn 24px line icons. Decorative: always hidden from screen readers. */
const PATHS = {
  fork: "M6 3v6a6 6 0 0 0 6 6m6-12v6a6 6 0 0 1-6 6m0 0v6",
  trail: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  grow: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5 0 8-8m-3 0h3v3",
  eval: "M4 19a8 8 0 1 1 16 0M12 19l4-6",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  shield: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  arrow: "M7 17 17 7M9 7h8v8",
  inbox: "M4 13h4l1.5 3h5L16 13h4M5 5h14l1 8v6H4v-6l1-8Z",
  alert: "M12 8v5m0 3.5h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  // A speech bubble with a question mark: Clarify is about asking before coding.
  clarify: "M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm5.2 4.6a1.9 1.9 0 1 1 2.9 1.6c-.8.5-1.1.9-1.1 1.8m0 2.2h.01",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  check: "M5 12.5 10 17.5 19 7.5",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  chevron: "m6 9 6 6 6-6",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
