import { IoCheckmark } from "react-icons/io5";
import "./SettingsUI.scss";

// Shared building blocks for every settings page (#70 design).
export function SettingsPage({ title, description, action, children }) {
  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="settings-page__action">{action}</div>}
      </header>
      {children}
    </div>
  );
}

export function SettingsSection({ title, action, children }) {
  return (
    <section className="settings-section">
      {(title || action) && (
        <div className="settings-section__head">
          {title && <h3>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsCard({ className = "", children }) {
  return <div className={"settings-card " + className}>{children}</div>;
}

export function SettingsRow({ icon, label, description, children, className = "" }) {
  return (
    <div className={"settings-row " + className}>
      {icon && <div className="settings-row__icon" aria-hidden="true">{icon}</div>}
      <div className="settings-row__text">
        {label && <div className="settings-row__label">{label}</div>}
        {description && <div className="settings-row__desc">{description}</div>}
      </div>
      {children && <div className="settings-row__control">{children}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled}
      className={"settings-toggle" + (checked ? " settings-toggle--on" : "")}
      onClick={() => onChange?.(!checked)} />
  );
}

export function Segmented({ value, options, onChange, label, disabled = false }) {
  return (
    <div className="settings-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
          disabled={disabled || option.disabled}
          className={value === option.value ? "settings-segmented__on" : ""}
          onClick={() => onChange?.(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ tone = "neutral", children }) {
  return <span className={"settings-badge settings-badge--" + tone}>{children}</span>;
}

export function Soon() {
  return <span className="settings-soon">준비 중</span>;
}

export function SettingsButton({ variant = "default", className = "", ...props }) {
  return <button type="button" className={"settings-button settings-button--" + variant + " " + className} {...props} />;
}

// Confirmation checkbox styled as a selectable card (replaces bare HTML checkboxes).
export function CheckCard({ checked, onChange, disabled = false, children }) {
  return (
    <label className={"settings-check" + (checked ? " settings-check--on" : "") + (disabled ? " settings-check--disabled" : "")}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(event) => onChange?.(event.target.checked)} />
      <span className="settings-check__box" aria-hidden="true">{checked && <IoCheckmark />}</span>
      <span className="settings-check__text">{children}</span>
    </label>
  );
}

// Placeholder bar while a value loads.
export function Skeleton({ width = "60%", height = 14 }) {
  return <span className="settings-skeleton" style={{ width, height }} aria-hidden="true" />;
}
