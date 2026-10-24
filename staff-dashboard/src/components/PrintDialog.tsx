import { useEffect, useState } from 'react';
import ArtworkViewer from './ArtworkViewer';
import Modal from './Modal';
import { useInventory } from '../context/InventoryContext';
import { useSettings } from '../context/SettingsContext';
import { buildPrecheck, InkReading } from '../lib/precheck';
import {
  artworkFileUrl, fetchInk, PrintResult, submitPrint,
} from '../services/printerService';
import { BACKEND_URL } from '../config';
import { PrintJob } from '../types';
import './PrintDialog.css';

const INK_SWATCH: Record<string, string> = {
  Black: '#3a3d44', Cyan: '#7bb5b9', Magenta: '#c2483d', Yellow: '#d9a441',
};

interface Props {
  job: PrintJob;
  onClose: () => void;
  onSent: (result: PrintResult) => void;
}

export default function PrintDialog({ job, onClose, onSent }: Props) {
  const { inventory } = useInventory();
  const { settings } = useSettings();
  const loaded = inventory.rolls.find((r) => r.loaded);
  // A fuller shelf roll of the right material the operator could switch to.
  const altRoll = inventory.rolls
    .filter((r) => !r.loaded && r.material === job.material)
    .sort((a, b) => b.remainingFt - a.remainingFt)[0];

  const hasFile = !!job.fileId;
  const thumbnailSrc = hasFile ? `${BACKEND_URL}/api/artwork/${encodeURIComponent(job.id)}/thumbnail` : null;

  const [inks, setInks] = useState<InkReading[]>(
    inventory.inks.map((i) => ({ color: i.color, levelPct: i.levelPct })),
  );
  const [inkLive, setInkLive] = useState(false);

  const pc = buildPrecheck(job, loaded, inks);

  const [checks, setChecks] = useState({ paper: false, aligned: false, ready: false });
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchInk().then((res) => {
      if (alive && res) { setInks(res.ink); setInkLive(!res.simulated); }
    });
    return () => { alive = false; };
  }, [job.id]);
  const allChecked = checks.paper && checks.aligned && checks.ready;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await submitPrint(job.id);
      onSent(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed');
      setSending(false);
    }
  };

  return (
    <>
    <Modal
      title={job.content}
      icon="ti-printer"
      subtitle={`${job.material} · ${job.widthIn}×${job.heightIn} in · Qty ${job.quantity} · ${job.department}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button className="btn-primary" onClick={send} disabled={!allChecked || sending}>
            <i className={`ti ${sending ? 'ti-loader spin' : 'ti-printer'}`} aria-hidden="true" />
            {sending ? 'Sending…' : 'Send to printer'}
          </button>
        </>
      )}
    >
      <div className="pd-section">
        <div className="pd-label">Job specs</div>
        <div className="pd-specs">
          <Spec label="Material" value={job.material} />
          <Spec label="Size" value={`${job.widthIn} × ${job.heightIn} in`} />
          <Spec label="Quantity" value={`${job.quantity}`} />
          <Spec label="Paper needed" value={`${pc.feetNeeded} ft`} accent />
        </div>
      </div>

      <div className="pd-section">
        <div className="pd-label">Artwork</div>
        <div className="pd-artwork">
          <button
            className="pd-thumb pd-thumb--btn"
            onClick={() => hasFile && setViewing(true)}
            disabled={!hasFile}
            title={hasFile ? 'View artwork' : undefined}
          >
            {thumbnailSrc
              ? <img src={thumbnailSrc} alt="Artwork preview" />
              : <i className="ti ti-photo-off" aria-hidden="true" />}
            {hasFile && <span className="pd-thumb-overlay"><i className="ti ti-zoom-in" aria-hidden="true" /></span>}
          </button>
          <div className="pd-artwork-info">
            {!hasFile && <div className="pd-art-line pd-muted">No artwork file attached.</div>}
            {hasFile && (
              <>
                <div className="pd-art-line pd-muted">Vector/PDF — resolution not size-dependent.</div>
                <button className="pd-view-btn" onClick={() => setViewing(true)}>
                  <i className="ti ti-eye" aria-hidden="true" /> View artwork
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pd-section">
        <div className="pd-label">Paper check</div>
        {!loaded ? (
          <div className="pd-check pd-check--warn">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <div>
              <div className="pd-check-main">No roll loaded</div>
              <div className="pd-check-detail">Load a {job.material} roll before printing.</div>
            </div>
          </div>
        ) : pc.wrongMaterial ? (
          <div className="pd-check pd-check--warn">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <div>
              <div className="pd-check-main">Wrong material loaded — {pc.loadedMaterial} is on the printer</div>
              <div className="pd-check-detail">
                Switch to {job.material}{altRoll ? ` (a partial roll with ${altRoll.remainingFt} ft is on the shelf)` : ' — none on the shelf, open a new roll'}.
              </div>
            </div>
          </div>
        ) : !pc.paperEnough ? (
          <div className="pd-check pd-check--warn">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <div>
              <div className="pd-check-main">Not enough on the loaded roll</div>
              <div className="pd-check-detail">
                {job.material} roll has {pc.rollRemainingFt} ft, job needs {pc.feetNeeded} ft.
                {altRoll && altRoll.remainingFt >= pc.feetNeeded ? ` Switch to the ${altRoll.remainingFt} ft shelf roll.` : ' Open a new roll.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="pd-check pd-check--ok">
            <i className="ti ti-check" aria-hidden="true" />
            <div>
              <div className="pd-check-main">Enough {job.material} loaded</div>
              <div className="pd-check-detail">{pc.rollRemainingFt} ft remaining · job needs {pc.feetNeeded} ft.</div>
            </div>
          </div>
        )}
      </div>

      <div className="pd-section">
        <div className="pd-label">
          Ink levels {inkLive ? <span className="pd-live">live</span> : <span className="pd-sim">simulated</span>}
        </div>
        <div className="pd-inks">
          {inks.map((ink) => {
            const low = ink.levelPct >= 0 && ink.levelPct <= 20;
            return (
              <div className="pd-ink" key={ink.color}>
                <span className="pd-ink-name">{ink.color}</span>
                <div className="pd-ink-bar">
                  <i style={{ width: `${Math.max(0, ink.levelPct)}%`, background: low ? 'var(--terra)' : INK_SWATCH[ink.color] || 'var(--t2)' }} />
                </div>
                <span className="pd-ink-pct" style={low ? { color: 'var(--terra-light)' } : undefined}>
                  {ink.levelPct < 0 ? '—' : `${ink.levelPct}%`}
                </span>
              </div>
            );
          })}
        </div>
        {pc.lowInks.length > 0 && (
          <div className="pd-ink-warn">
            <i className="ti ti-alert-circle" aria-hidden="true" />
            {pc.lowInks.join(', ')} low — have spares ready before printing.
          </div>
        )}
      </div>

      <div className="pd-section">
        <div className="pd-label">Confirm before sending</div>
        <Confirm label="Correct paper roll loaded" checked={checks.paper} onChange={(v) => setChecks((c) => ({ ...c, paper: v }))} />
        <Confirm label="Paper aligned and fed correctly" checked={checks.aligned} onChange={(v) => setChecks((c) => ({ ...c, aligned: v }))} />
        <Confirm label="Printer shows no error lights" checked={checks.ready} onChange={(v) => setChecks((c) => ({ ...c, ready: v }))} />
      </div>

      {error && <div className="pd-error"><i className="ti ti-alert-circle" aria-hidden="true" /> {error}</div>}
    </Modal>

    {viewing && hasFile && (
      <ArtworkViewer rowId={job.id} fileId={job.fileId} filename={job.content} mime="application/pdf" onClose={() => setViewing(false)} />
    )}
    </>
  );
}

function Spec({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="pd-spec">
      <div className="pd-spec-label">{label}</div>
      <div className="pd-spec-value" style={accent ? { color: 'var(--teal)' } : undefined}>{value}</div>
    </div>
  );
}

function Confirm({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`pd-confirm${checked ? ' pd-confirm--on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
