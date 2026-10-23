import { useState } from 'react';
import Modal from '../components/Modal';
import { ROLL_LENGTH_FT } from '../config';
import { useInventory } from '../context/InventoryContext';
import { useT } from '../i18n';
import { rollPct, rollState } from '../lib/calc';
import { loadedRoll, rollsOfMaterial } from '../lib/inventory';
import { InkColor, InkCartridge, Material, RollInstance } from '../types';
import './InventoryPage.css';

const MATERIALS: Material[] = ['Canvas', 'Glossy', 'Regular', 'Sticky', 'Outdoor'];
const INK_COLORS: InkColor[] = ['Black', 'Cyan', 'Magenta', 'Yellow'];

const INK_SWATCH: Record<string, string> = {
  Black: '#3a3d44', Cyan: '#7bb5b9', Magenta: '#c2483d', Yellow: '#d9a441',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function InventoryPage() {
  const t = useT();
  const { inventory, loadNewRoll, switchToRoll, recalibrate, replaceCartridge, addInkSpare, receivePaperStock, discardRoll } = useInventory();
  const [loadModal, setLoadModal] = useState<Material | null>(null);
  const [recalRoll, setRecalRoll] = useState<RollInstance | null>(null);
  const loaded = loadedRoll(inventory);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{t('inventory.title')}</div>
          <div className="page-sub">{t('inventory.sub')}</div>
        </div>
      </div>

      <div className="page-content">
        {/* Currently loaded */}
        <LoadedBanner roll={loaded} onRecalibrate={() => loaded && setRecalRoll(loaded)} />

        {/* Paper, per material */}
        <section>
          <div className="section-head">
            <div className="section-title"><i className="ti ti-rollercoaster" aria-hidden="true" /> {t('inventory.paperRolls')}</div>
          </div>
          <div className="mat-grid">
            {MATERIALS.map((material) => (
              <MaterialCard
                key={material}
                material={material}
                rolls={rollsOfMaterial(inventory, material)}
                spares={inventory.spares[material] ?? 0}
                onLoadNew={() => setLoadModal(material)}
                onSwitch={switchToRoll}
                onRecalibrate={(r) => setRecalRoll(r)}
                onDiscard={discardRoll}
              />
            ))}
          </div>
        </section>

        {/* Ink */}
        <section>
          <div className="section-head">
            <div className="section-title"><i className="ti ti-droplet" aria-hidden="true" /> {t('inventory.inkCartridges')}</div>
          </div>
          <div className="ink-grid">
            {inventory.inks.map((ink) => (
              <InkCard key={ink.color} ink={ink} onReplace={() => replaceCartridge(ink.color)} onAddSpare={() => addInkSpare(ink.color)} />
            ))}
          </div>
        </section>

        <IntakeForm onReceivePaper={receivePaperStock} onReceiveInk={addInkSpare} />
      </div>

      {loadModal && (
        <LoadRollModal
          material={loadModal}
          onClose={() => setLoadModal(null)}
          onConfirm={(ft) => { loadNewRoll(loadModal, ft); setLoadModal(null); }}
        />
      )}
      {recalRoll && (
        <RecalibrateModal
          roll={recalRoll}
          onClose={() => setRecalRoll(null)}
          onConfirm={(ft) => { recalibrate(recalRoll.id, ft); setRecalRoll(null); }}
        />
      )}
    </>
  );
}

function LoadedBanner({ roll, onRecalibrate }: { roll: RollInstance | undefined; onRecalibrate: () => void }) {
  if (!roll) {
    return (
      <div className="loaded-banner loaded-banner--empty">
        <div className="lb-icon"><i className="ti ti-printer-off" aria-hidden="true" /></div>
        <div><div className="lb-title">No roll loaded</div><div className="lb-sub">Load a roll below before printing.</div></div>
      </div>
    );
  }
  const pct = rollPct(roll);
  const alert = rollState(roll) === 'critical';
  const circ = 157;
  return (
    <div className={`loaded-banner${alert ? ' loaded-banner--alert' : ''}`}>
      <div className="ring lb-ring">
        <svg width="58" height="58">
          <circle className="ring-track" cx="29" cy="29" r="25" />
          <circle className="ring-fill" cx="29" cy="29" r="25" stroke={alert ? 'var(--terra)' : 'var(--teal)'} strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} />
        </svg>
        <div className="ring-pct">{pct}%</div>
      </div>
      <div className="lb-main">
        <div className="lb-tag"><i className="ti ti-printer" aria-hidden="true" /> On the printer</div>
        <div className="lb-title">{roll.material} · <span style={alert ? { color: 'var(--terra-light)' } : undefined}>{roll.remainingFt} ft</span> remaining</div>
        <div className="lb-sub">of a {roll.fullLengthFt} ft roll · opened {fmtDate(roll.openedAt)}</div>
      </div>
      <button className="btn-ghost" onClick={onRecalibrate}><i className="ti ti-ruler-2" aria-hidden="true" /> Recalibrate</button>
    </div>
  );
}

function MaterialCard({ material, rolls, spares, onLoadNew, onSwitch, onRecalibrate, onDiscard }: {
  material: Material; rolls: RollInstance[]; spares: number;
  onLoadNew: () => void; onSwitch: (id: string) => void;
  onRecalibrate: (r: RollInstance) => void; onDiscard: (id: string) => void;
}) {
  const hasLoaded = rolls.some((r) => r.loaded);
  const full = ROLL_LENGTH_FT[material] ?? 100;
  const openedFt = rolls.reduce((s, r) => s + r.remainingFt, 0);
  const totalFt = Math.round((openedFt + spares * full) * 10) / 10;

  return (
    <div className={`card mat-card${hasLoaded ? ' mat-card--loaded' : ''}`}>
      <div className="mat-top">
        <div>
          <div className="mat-name">{material}{hasLoaded && <span className="mat-loaded-badge">Loaded</span>}</div>
          <div className="mat-sub">{totalFt} ft total available</div>
        </div>
        <span className="mat-spares">{spares} spare{spares === 1 ? '' : 's'}</span>
      </div>

      <div className="roll-rows">
        {rolls.length === 0 && <div className="roll-empty">No opened rolls</div>}
        {rolls.sort((a, b) => b.remainingFt - a.remainingFt).map((r) => {
          const st = rollState(r);
          return (
            <div className={`roll-row${r.loaded ? ' roll-row--loaded' : ''}`} key={r.id}>
              <div className="roll-bar"><i style={{ width: `${rollPct(r)}%`, background: st === 'critical' ? 'var(--terra)' : 'var(--teal)' }} /></div>
              <span className={`roll-ft${st === 'critical' ? ' roll-ft--crit' : ''}`}>{r.remainingFt} ft</span>
              {r.loaded
                ? <span className="roll-onprinter"><i className="ti ti-printer" aria-hidden="true" /></span>
                : <button className="roll-load" onClick={() => onSwitch(r.id)} title="Load this roll">Load</button>}
              <button className="roll-mini" onClick={() => onRecalibrate(r)} title="Recalibrate" aria-label="Recalibrate"><i className="ti ti-ruler-2" aria-hidden="true" /></button>
              <button className="roll-mini" onClick={() => onDiscard(r.id)} title="Remove (used up)" aria-label="Remove roll"><i className="ti ti-trash" aria-hidden="true" /></button>
            </div>
          );
        })}
      </div>

      <button className="mat-open" onClick={onLoadNew} disabled={spares <= 0}>
        <i className="ti ti-plus" aria-hidden="true" /> Open new roll{spares <= 0 ? ' (no spares)' : ''}
      </button>
    </div>
  );
}

function InkCard({ ink, onReplace, onAddSpare }: { ink: InkCartridge; onReplace: () => void; onAddSpare: () => void }) {
  const alert = ink.levelPct <= 20;
  const swatch = INK_SWATCH[ink.color];
  return (
    <div className={`card${alert ? ' card--alert' : ''}`}>
      <div className="ink-head">
        <div className="ink-swatch" style={{ background: swatch }} />
        <div><div className="ink-name">{ink.color}</div><div className="ink-sub">{ink.model} · {ink.capacityMl} ml</div></div>
      </div>
      <div className="ink-pctrow">
        <span className="ink-pct" style={{ color: alert ? 'var(--terra-light)' : swatch }}>{ink.levelPct}%</span>
        <span className="ink-ml" style={alert ? { color: 'var(--terra)' } : undefined}>· {alert ? 'replace soon' : `replaced ${fmtDate(ink.replacedAt)}`}</span>
      </div>
      <div className="ink-bar"><i style={{ width: `${ink.levelPct}%`, background: alert ? 'var(--terra)' : swatch }} /></div>
      <div className="ink-foot">
        <div className="spares">
          <span className="spares-lbl">Spares</span>
          <span className="spares-n">{ink.sparesInStock}</span>
          <button className="iconbtn" onClick={onAddSpare} aria-label={`Add ${ink.color} spare`}><i className="ti ti-plus" aria-hidden="true" /></button>
        </div>
        <button className="replace" onClick={onReplace} style={alert ? { color: 'var(--terra-light)' } : undefined}>Replace</button>
      </div>
    </div>
  );
}

function IntakeForm({ onReceivePaper, onReceiveInk }: {
  onReceivePaper: (m: Material, qty: number) => void; onReceiveInk: (c: InkColor, qty: number) => void;
}) {
  const [type, setType] = useState<'paper' | 'ink'>('paper');
  const [item, setItem] = useState<string>('Canvas');
  const [qty, setQty] = useState(2);

  const onTypeChange = (t: 'paper' | 'ink') => { setType(t); setItem(t === 'paper' ? 'Canvas' : 'Black'); };
  const submit = () => {
    const n = Math.max(1, Math.trunc(qty));
    if (type === 'paper') onReceivePaper(item as Material, n); else onReceiveInk(item as InkColor, n);
  };

  return (
    <div className="intake">
      <div className="intake-head">
        <div className="intake-ic"><i className="ti ti-package-import" aria-hidden="true" /></div>
        <div><div className="intake-title">Receive new supplies</div><div className="intake-sub">Log incoming spare rolls or ink cartridges</div></div>
      </div>
      <div className="form-grid">
        <div className="fg">
          <label className="fl">Supply type</label>
          <select value={type} onChange={(e) => onTypeChange(e.target.value as 'paper' | 'ink')}>
            <option value="paper">Paper roll</option><option value="ink">Ink cartridge</option>
          </select>
        </div>
        <div className="fg">
          <label className="fl">Item</label>
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            {type === 'paper'
              ? MATERIALS.map((m) => <option key={m} value={m}>{m} ({ROLL_LENGTH_FT[m]} ft)</option>)
              : INK_COLORS.map((c) => <option key={c} value={c}>{c} (HP 712)</option>)}
          </select>
        </div>
        <div className="fg">
          <label className="fl">Quantity received</label>
          <input type="number" value={qty} min={1} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
        <button className="btn-primary" onClick={submit}><i className="ti ti-check" aria-hidden="true" /> Add to inventory</button>
      </div>
    </div>
  );
}

function LoadRollModal({ material, onClose, onConfirm }: {
  material: Material; onClose: () => void; onConfirm: (ft: number) => void;
}) {
  const [ft, setFt] = useState<number>(ROLL_LENGTH_FT[material] ?? 100);
  return (
    <Modal
      title={`Open new ${material} roll`} icon="ti-rollercoaster"
      subtitle="Draws one from spare stock and mounts it"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onConfirm(ft)}><i className="ti ti-check" aria-hidden="true" /> Load roll</button>
        </>
      )}
    >
      <div className="field">
        <label>Roll length (ft)</label>
        <input type="number" value={ft} min={1} onChange={(e) => setFt(Number(e.target.value))} />
        <span className="field-hint">A small load-waste trim is deducted automatically for skew correction. The roll currently on the printer moves to the shelf.</span>
      </div>
    </Modal>
  );
}

function RecalibrateModal({ roll, onClose, onConfirm }: {
  roll: RollInstance; onClose: () => void; onConfirm: (ft: number) => void;
}) {
  const [measured, setMeasured] = useState<number>(roll.remainingFt);
  return (
    <Modal
      title={`Recalibrate ${roll.material}`} icon="ti-ruler-2"
      subtitle="Correct drift with a real measurement"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onConfirm(measured)}><i className="ti ti-check" aria-hidden="true" /> Update</button>
        </>
      )}
    >
      <div className="field">
        <label>Measured remaining length (ft)</label>
        <input type="number" value={measured} min={0} max={roll.fullLengthFt} step={0.5} onChange={(e) => setMeasured(Number(e.target.value))} />
        <span className="field-hint">Currently tracked at {roll.remainingFt} ft of a {roll.fullLengthFt} ft roll.</span>
      </div>
    </Modal>
  );
}
