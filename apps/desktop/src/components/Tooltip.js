import "./Tooltip.scss";

export default function Tooltip({ label, children }) {
  return <span className="thread-tooltip">{children}<span className="thread-tooltip__content" role="tooltip">{label}</span></span>;
}
