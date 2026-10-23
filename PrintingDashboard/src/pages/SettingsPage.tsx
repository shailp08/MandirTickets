import { useCallback, useEffect, useState } from 'react';
import {
  BACKEND_URL, HAS_LIVE_SYNC, POLL_INTERVAL_MS, ROLL_LENGTH_FT, SHEET_URL,
} from '../config';
import { useSettings } from '../context/SettingsContext';
import { useLang, useT } from '../i18n';
import {
  fetchHealth, fetchPrinterStatus, PrinterState,
} from '../services/printerService';
import './SettingsPage.css';

type Health = 'checking' | 'ok' | 'down';

function maskUrl(url: string): string {
  if (!url) return 'not configured';
  return url.replace(/\/s\/[^/]+/, '/s/•••').replace(/(https?:\/\/[^/]+).*/, '$1/…');
}

export default function SettingsPage() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { settings, update, reset } = useSettings();
  const [state, setState] = useState<Health>('checking');
  const [printer, setPrinter] = useState<PrinterState | null>(null);

  const check = useCallback(async () => {
    setState('checking');
    const [h, p] = await Promise.all([fetchHealth(), fetchPrinterStatus()]);
    setPrinter(p);
    setState(h ? 'ok' : 'down');
  }, []);

  useEffect(() => { check(); }, [check]);

  const backendUp = state === 'ok';
  const printerOnline = backendUp && printer?.online;
  const printerSim = printer?.simulated ?? true;

  const statusLabel = { ok: t('settings.connected'), warn: t('settings.attention'), down: t('settings.offline'), checking: t('settings.checking') };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{t('settings.title')}</div>
          <div className="page-sub">{t('settings.sub')}</div>
        </div>
        <div className="page-actions">
          <button className="btn-ghost" onClick={check} disabled={state === 'checking'}>
            <i className={`ti ti-refresh${state === 'checking' ? ' spin' : ''}`} aria-hidden="true" /> {t('settings.recheck')}
          </button>
        </div>
      </div>

      <div className="page-content">
        <section>
          <div className="section-head"><div className="section-title"><i className="ti ti-plug-connected" aria-hidden="true" /> {t('settings.connections')}</div></div>
          <div className="conn-grid">
            <ConnCard
              icon="ti-server-2" title="Backend service"
              status={state === 'checking' ? 'checking' : backendUp ? 'ok' : 'down'}
              statusLabel={statusLabel}
              line1={BACKEND_URL}
              line2={backendUp ? 'Reachable' : 'Not reachable — start the server on the shop PC'}
            />
            <ConnCard
              icon="ti-printer" title="HP DesignJet T210"
              status={state === 'checking' ? 'checking' : !backendUp ? 'down' : printerOnline ? (printerSim ? 'warn' : 'ok') : 'down'}
              statusLabel={statusLabel}
              line1={printer?.model ?? 'HP DesignJet T210'}
              line2={!backendUp ? 'Backend offline' : printerSim ? 'Simulated (no PRINTER_IP set)' : printerOnline ? `Online · ${printer?.state}` : 'Offline'}
            />
            <ConnCard
              icon="ti-table" title="Google Sheet sync"
              status={HAS_LIVE_SYNC ? 'ok' : 'warn'}
              statusLabel={statusLabel}
              line1={maskUrl(SHEET_URL)}
              line2={HAS_LIVE_SYNC ? 'Configured' : 'Demo data (set REACT_APP_SHEET_URL)'}
            />
          </div>
        </section>

        <section>
          <div className="section-head"><div className="section-title"><i className="ti ti-adjustments" aria-hidden="true" /> {t('settings.configuration')}</div></div>
          <div className="card cfg">
            <Row label="Sheet poll interval" value={`${POLL_INTERVAL_MS / 1000}s`} />
            <Row label="Backend URL" value={BACKEND_URL} />
            <Row label="Printer mode" value={printerSim ? 'Simulated' : 'Live (IPP)'} />
            <Row label="Ink source" value="Live from printer (SNMP)" />
            <Row label="Paper source" value="Tracked in-app (T210 can't report)" />
          </div>
        </section>

        <section>
          <div className="section-head">
            <div className="section-title"><i className="ti ti-adjustments-alt" aria-hidden="true" /> {t('settings.thresholds')}</div>
            <button className="btn-ghost" onClick={reset}><i className="ti ti-rotate" aria-hidden="true" /> {t('settings.resetDefaults')}</button>
          </div>
          <div className="card cfg">
            <NumRow label="Low ink warning (%)" hint="Cartridge flagged critical at or below this level"
              value={settings.lowInkPct} min={0} max={100} step={1} onChange={(v) => update({ lowInkPct: v })} />
            <NumRow label="Roll critical (%)" hint="Paper roll flagged critical at or below this fill"
              value={settings.rollCriticalPct} min={0} max={100} step={1} onChange={(v) => update({ rollCriticalPct: v })} />
            <NumRow label="Roll low warning (%)" hint="Paper roll flagged low at or below this fill"
              value={settings.rollWarningPct} min={0} max={100} step={1} onChange={(v) => update({ rollWarningPct: v })} />
            <NumRow label="Reorder when spares ≤" hint="Add to the reorder list at or below this spare count"
              value={settings.lowSpareThreshold} min={0} max={20} step={1} onChange={(v) => update({ lowSpareThreshold: v })} />
            <NumRow label="Load-waste allowance (ft)" hint="Paper trimmed each time a roll is loaded (skew correction)"
              value={settings.loadWasteFt} min={0} max={10} step={0.25} onChange={(v) => update({ loadWasteFt: v })} />
            <NumRow label="Minimum print resolution (DPI)" hint="Warn in the checklist if artwork is below this"
              value={settings.minDpi} min={0} max={1200} step={10} onChange={(v) => update({ minDpi: v })} />
          </div>
        </section>

        <section>
          <div className="section-head"><div className="section-title"><i className="ti ti-rollercoaster" aria-hidden="true" /> {t('settings.rollLengths')}</div></div>
          <div className="card cfg">
            {Object.entries(ROLL_LENGTH_FT).map(([m, ft]) => <Row key={m} label={m} value={`${ft} ft`} />)}
          </div>
        </section>

        <section>
          <div className="section-head"><div className="section-title"><i className="ti ti-language" aria-hidden="true" /> {t('settings.language')}</div></div>
          <div className="card cfg">
            <div className="cfg-row cfg-row--edit">
              <div className="cfg-edit-text">
                <span className="cfg-label">{t('settings.language')}</span>
                <span className="cfg-hint">Switch the interface language</span>
              </div>
              <div className="lang-toggle">
                <button
                  className={`lang-btn${lang === 'en' ? ' lang-btn--on' : ''}`}
                  onClick={() => setLang('en')}
                >
                  {t('settings.langEn')}
                </button>
                <button
                  className={`lang-btn${lang === 'gu' ? ' lang-btn--on' : ''}`}
                  onClick={() => setLang('gu')}
                >
                  {t('settings.langGu')}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="section-head"><div className="section-title"><i className="ti ti-info-circle" aria-hidden="true" /> {t('settings.about')}</div></div>
          <div className="card cfg">
            <Row label="App" value="PrintTrack" />
            <Row label="Site" value="BAPS Shri Swaminarayan Mandir · New Castle, DE" />
            <Row label="Printer" value="HP DesignJet T210 · 24 in" />
          </div>
        </section>
      </div>
    </>
  );
}

function ConnCard({ icon, title, status, statusLabel, line1, line2 }: {
  icon: string; title: string; status: 'ok' | 'warn' | 'down' | 'checking';
  statusLabel: Record<string, string>; line1: string; line2: string;
}) {
  const label = statusLabel[status] ?? status;
  return (
    <div className="card conn">
      <div className="conn-top">
        <div className="conn-ic"><i className={`ti ${icon}`} aria-hidden="true" /></div>
        <span className={`conn-dot conn-dot--${status}`} />
      </div>
      <div className="conn-title">{title}</div>
      <div className={`conn-status conn-status--${status}`}>{label}</div>
      <div className="conn-line conn-line--mono">{line1}</div>
      <div className="conn-line">{line2}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="cfg-row">
      <span className="cfg-label">{label}</span>
      <span className="cfg-value">{value}</span>
    </div>
  );
}

function NumRow({ label, hint, value, min, max, step, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="cfg-row cfg-row--edit">
      <div className="cfg-edit-text">
        <span className="cfg-label">{label}</span>
        <span className="cfg-hint">{hint}</span>
      </div>
      <input
        className="cfg-input" type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </div>
  );
}
