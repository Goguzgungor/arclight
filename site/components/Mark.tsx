export default function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="22" fill="none" stroke="#2E3D5C" strokeWidth={6} />
      <path
        d="M32 10 A22 22 0 0 1 51 21"
        fill="none"
        stroke="#5FA5EF"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <circle cx="51" cy="21" r="5" fill="#EAF2FF" />
    </svg>
  );
}
