// Mini Icon component for custom SVG icons
// Follows Lucide style: fill="none", stroke="currentColor", strokeWidth={1.5}, viewBox="0 0 24 24"
// Usage: <Icon viewBox="0 0 24 24" size={16}><path d="..." /></Icon>

export default function Icon({ children, size = 16, viewBox = '0 0 24 24', className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}
