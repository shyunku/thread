// Icons of the #102 main-screen mock (docs/designs/pc-main-redesign-mock.html, `I`), same paths.
// One set for the sidebar, the menus, the pickers and the dialogs. Every icon takes `size`, and
// other props go to the <svg>.
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

const Svg = ({ size = 16, box = 24, children, ...rest }) => (
  <svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} aria-hidden="true" focusable="false" {...line} {...rest}>
    {children}
  </svg>
);

export const CloseIcon = ({ size = 16, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
    <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
  </svg>
);
export const PrevIcon = (p) => <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>;
export const NextIcon = (p) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>;
// Check inside the small checkbox.
export const CheckIcon = (p) => <Svg size={12} strokeWidth={3.2} {...p}><path d="M5 12l5 5 9-10" /></Svg>;
// Standard check mark for chosen menu items.
export const TickIcon = (p) => <Svg strokeWidth={2} {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const PlusIcon = (p) => <Svg strokeWidth={2.2} {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const SearchIcon = (p) => <Svg size={14} {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
// Secret categories (user decision: the shield).
export const ShieldIcon = (p) => (
  <Svg {...p}><path d="M12 3l7 3v5.5c0 4.3-3 8-7 9.5-4-1.5-7-5.2-7-9.5V6z" /><path d="M9.2 12.2l2 2 3.8-4" /></Svg>
);
export const SunIcon = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
);
export const WeekIcon = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>;
export const CalendarIcon = (p) => <Svg size={13} {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>;
export const StarIcon = ({ filled = false, ...p }) => (
  <Svg fill={filled ? "currentColor" : "none"} {...p}><path d="M12 3.3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.6l-5.2 2.7 1-5.8L3.6 9.4l5.8-.8z" /></Svg>
);
// Sidebar.
export const AllIcon = (p) => <Svg {...p}><path d="M4 6h16M4 12h16M4 18h10" /></Svg>;
export const MenuIcon = (p) => <Svg size={18} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const GearIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);
// Menu icons (15px).
export const PencilIcon = (p) => <Svg size={15} {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /></Svg>;
export const OpenIcon = (p) => <Svg size={15} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const DayLaterIcon = (p) => <Svg size={15} {...p}><path d="M5 12h12M13 8l4 4-4 4" /><path d="M20 5v14" /></Svg>;
export const WeekLaterIcon = (p) => <Svg size={15} {...p}><path d="M4 12h12M12 8l4 4-4 4" /><path d="M19 5v14M22 5v14" /></Svg>;
export const ClearIcon = (p) => <Svg size={15} {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const TagIcon = (p) => <Svg size={15} {...p}><path d="M20 12l-8 8-9-9V3h8z" /><circle cx="7.5" cy="7.5" r="1.2" /></Svg>;
export const CopyIcon = (p) => (
  <Svg size={15} {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></Svg>
);
// 15px in menus, 26px in the delete confirm tile.
export const TrashIcon = (p) => <Svg size={15} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>;
// List rows (12px meta icons) and the list header (#102 mock I.repeat / sub / memo, vList / vCal /
// vTime, sliders, eye / eye-off, chev).
export const RepeatIcon = (p) => (
  <Svg size={12} {...p}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></Svg>
);
export const SubtaskIcon = (p) => <Svg size={12} {...p}><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></Svg>;
export const MemoIcon = (p) => <Svg size={12} {...p}><path d="M5 4h14v16H5zM9 9h6M9 13h6" /></Svg>;
export const SlidersIcon = (p) => (
  <Svg size={15} {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Svg>
);
export const ListViewIcon = (p) => (
  <Svg {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Svg>
);
export const CalendarViewIcon = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>;
export const TimelineViewIcon = (p) => (
  <Svg {...p}><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="16" rx="1.5" /><rect x="17" y="4" width="4" height="16" rx="1.5" /></Svg>
);
export const EyeIcon = (p) => <Svg {...p}><path d="M2.1 12a10 10 0 0 1 19.8 0 10 10 0 0 1-19.8 0z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const EyeOffIcon = (p) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10 10 0 0 1 21.9 12a10.4 10.4 0 0 1-2.6 3.8M6.6 6.6A10.4 10.4 0 0 0 2.1 12 10 10 0 0 0 12 19a9.8 9.8 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);
// Group fold arrow: down when open, right when folded.
export const ChevIcon = ({ open = true, style, ...p }) => (
  <Svg size={14} style={{ transform: `rotate(${open ? 0 : -90}deg)`, ...style }} {...p}><path d="M6 9l6 6 6-6" /></Svg>
);
