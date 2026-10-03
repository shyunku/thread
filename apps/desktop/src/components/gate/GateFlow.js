import "./GateFlow.scss";

// Building blocks for full-window flows inside ApplicationGate (device connection,
// recovery). They mirror the settings step dialogs: progress bar, body, footer.

export function GateStep({ kicker, title, step, total, label, children, footer }) {
  return (
    <section className="gate-step" aria-labelledby="gate-step-title">
      <header className="gate-step__head">
        {kicker && <div className="gate-step__kicker">{kicker}</div>}
        <h1 id="gate-step-title">{title}</h1>
        {total > 1 && (
          <ol className="gate-step__bar" aria-hidden="true">
            {Array.from({ length: total }, (_, index) => (
              <li key={index} className={index < step - 1 ? "done" : index === step - 1 ? "current" : ""} />
            ))}
          </ol>
        )}
        {label && <div className="gate-step__label">{total > 1 ? `${step}/${total} · ${label}` : label}</div>}
      </header>
      <div className="gate-step__body">{children}</div>
      {footer && <footer className="gate-step__foot">{footer}</footer>}
    </section>
  );
}

export function GateButton({ variant = "default", className = "", type = "button", ...props }) {
  return <button type={type} className={`gate-button gate-button--${variant} ${className}`} {...props} />;
}

export function GateLink({ className = "", ...props }) {
  return <button type="button" className={`gate-link ${className}`} {...props} />;
}

export function ChoiceCard({ icon, title, badge, description, onClick, disabled = false }) {
  return (
    <button type="button" className={`gate-choice${badge ? " gate-choice--recommended" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="gate-choice__icon" aria-hidden="true">{icon}</span>
      <span className="gate-choice__text">
        <b>{title}{badge && <span className="gate-badge">{badge}</span>}</b>
        <span>{description}</span>
      </span>
      <span className="gate-choice__chevron" aria-hidden="true">›</span>
    </button>
  );
}

export function OptionCard({ selected, onSelect, title, description, disabled = false }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`gate-option${selected ? " gate-option--selected" : ""}`}
      disabled={disabled} onClick={onSelect}>
      <span className="gate-option__radio" aria-hidden="true" />
      <span className="gate-option__text"><b>{title}</b><span>{description}</span></span>
    </button>
  );
}

export function CheckRow({ checked, onChange, disabled = false, children }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={`gate-check${checked ? " gate-check--on" : ""}`}
      disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="gate-check__box" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

export function Waiting({ children }) {
  return <div className="gate-waiting" role="status"><span className="gate-waiting__spinner" aria-hidden="true" />{children}</div>;
}

export function SasCode({ code, small = false }) {
  const text = code ? `${code.slice(0, 3)} ${code.slice(3)}` : "··· ···";
  return <div className={`gate-sas${small ? " gate-sas--small" : ""}`} aria-label={code ? `확인 숫자 ${code.split("").join(" ")}` : undefined}>{text}</div>;
}

export function GateCallout({ tone = "info", children }) {
  return <div className={`gate-callout gate-callout--${tone}`} role={tone === "danger" ? "alert" : undefined}>{children}</div>;
}
