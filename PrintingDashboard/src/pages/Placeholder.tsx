interface Props {
  title: string;
  sub: string;
  icon: string;
  phase: string;
}

/** Stand-in for screens arriving in later phases. */
export default function Placeholder({ title, sub, icon, phase }: Props) {
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{title}</div>
          <div className="page-sub">{sub}</div>
        </div>
      </div>
      <div className="placeholder">
        <i className={`ti ${icon}`} aria-hidden="true" />
        <h2>Coming in {phase}</h2>
        <p>This screen is scaffolded and ready to build out next.</p>
      </div>
    </>
  );
}
