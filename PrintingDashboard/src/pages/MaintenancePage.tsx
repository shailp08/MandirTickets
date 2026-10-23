import { useState } from 'react';
import { useOps } from '../context/OpsContext';
import { useT } from '../i18n';
import { MAINTENANCE_KINDS, MaintenanceKind } from '../types';
import './OpsPages.css';

const KIND_ICON: Record<string, string> = {
  'Printhead cleaning': 'ti-spray',
  'Alignment / calibration': 'ti-focus-2',
  'Cutter service': 'ti-scissors',
  'Firmware update': 'ti-download',
  'Paper jam cleared': 'ti-alert-triangle',
  Other: 'ti-tool',
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function MaintenancePage() {
  const t = useT();
  const { maintenance, addMaintenance, deleteMaintenance } = useOps();
  const [kind, setKind] = useState<MaintenanceKind>('Printhead cleaning');
  const [notes, setNotes] = useState('');
  const [by, setBy] = useState('');

  const log = [...maintenance].reverse();

  const submit = () => {
    addMaintenance(kind, notes.trim(), by.trim() || undefined);
    setNotes('');
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{t('maintenance.title')}</div>
          <div className="page-sub">{t('maintenance.sub')}</div>
        </div>
      </div>

      <div className="page-content">
        <div className="card ops-form">
          <div className="ops-form-grid">
            <div className="fg">
              <label className="fl">{t('maintenance.type')}</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as MaintenanceKind)}>
                {MAINTENANCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="fg fg--wide">
              <label className="fl">{t('maintenance.notes')}</label>
              <input type="text" value={notes} placeholder="What was done…" onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="fg">
              <label className="fl">{t('maintenance.by')}</label>
              <input type="text" value={by} placeholder={t('maintenance.byPlaceholder')} onChange={(e) => setBy(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={submit}><i className="ti ti-plus" aria-hidden="true" /> {t('maintenance.logBtn')}</button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">{t('maintenance.title')}</div>
              <div className="panel-meta">{maintenance.length} entr{maintenance.length === 1 ? 'y' : 'ies'}</div>
            </div>
          </div>
          <div className="ops-list">
            {log.length === 0
              ? <div className="ops-empty">{t('maintenance.noLog')}</div>
              : log.map((m) => (
                <div className="ops-row" key={m.id}>
                  <div className="ops-ic"><i className={`ti ${KIND_ICON[m.kind] ?? 'ti-tool'}`} aria-hidden="true" /></div>
                  <div className="ops-text">
                    <div className="ops-name">{m.kind}{m.by ? <span className="ops-by"> · {m.by}</span> : null}</div>
                    {m.notes && <div className="ops-detail">{m.notes}</div>}
                  </div>
                  <div className="ops-when">{fmtWhen(m.at)}</div>
                  <button className="ops-del" onClick={() => deleteMaintenance(m.id)} aria-label={t('maintenance.deleteTitle')}><i className="ti ti-trash" aria-hidden="true" /></button>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
