import { useMemo, useRef, useState } from 'react';
import JobHistoryModal from '../components/JobHistoryModal';
import Modal from '../components/Modal';
import PrintDialog from '../components/PrintDialog';
import { useInventory } from '../context/InventoryContext';
import { JobMeta as CtxJobMeta, useJobs } from '../context/JobsContext';
import { useT } from '../i18n';
import { useQueueOrder } from '../hooks/useQueueOrder';
import { useRush } from '../hooks/useRush';
import { feetNeeded } from '../lib/calc';
import { loadedRoll } from '../lib/inventory';
import { buildNestingSuggestions } from '../lib/nesting';
import { relativeTime } from '../lib/time';
import { DataSource } from '../services/sheetService';
import { JobStatus, PrintJob, REPRINT_REASONS, ReprintReason } from '../types';
import './QueuePage.css';

/** Returns the effective dimensions for a job, applying any operator overrides. */
function effectiveDims(job: PrintJob, meta?: CtxJobMeta): PrintJob {
  return {
    ...job,
    widthIn: meta?.widthInOverride ?? job.widthIn,
    heightIn: meta?.heightInOverride ?? job.heightIn,
  };
}

const SOURCE_META: Record<DataSource, { labelKey: string; cls: string }> = {
  live: { labelKey: 'source.live', cls: 'live' },
  cache: { labelKey: 'source.cache', cls: 'cache' },
  mock: { labelKey: 'source.mock', cls: 'mock' },
};

const MATERIAL_ICON: Record<string, string> = {
  Canvas: 'ti-photo', Glossy: 'ti-photo', Regular: 'ti-photo', Outdoor: 'ti-photo', Sticky: 'ti-tag',
};

type Filter = 'all' | 'pending' | 'ready' | 'completed';

export default function QueuePage() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('all');
  const [dialogJob, setDialogJob] = useState<PrintJob | null>(null);
  const [reprintJob, setReprintJob] = useState<PrintJob | null>(null);
  const [historyJob, setHistoryJob] = useState<PrintJob | null>(null);
  const {
    jobs, state, source, syncedAt, refresh, setJobStatus,
    jobMeta, setJobMeta, statusLog,
  } = useJobs();
  const { consumeForJob, logReprint, inventory } = useInventory();
  const { isRushed, toggleRush } = useRush();
  const { orderIndex, move } = useQueueOrder();
  const dragId = useRef<string | null>(null);

  const loaded = loadedRoll(inventory);

  const markReady = (job: PrintJob) => {
    setJobStatus(job.id, 'ready');
    consumeForJob(job.material, feetNeeded(effectiveDims(job, jobMeta[job.id])), job.id);
  };

  const effJob = (job: PrintJob) => effectiveDims(job, jobMeta[job.id]);

  const markPickedUp = (job: PrintJob) => {
    setJobStatus(job.id, 'completed');
  };

  const counts = {
    total: jobs.length,
    pending: jobs.filter((j) => j.status === 'pending').length,
    inProgress: jobs.filter((j) => j.status === 'in_progress').length,
    ready: jobs.filter((j) => j.status === 'ready').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
  };

  const departments = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.department))).sort(),
    [jobs],
  );

  const nestGroups = useMemo(() => buildNestingSuggestions(jobs), [jobs]);

  // Capacity data: pending jobs matching loaded material, in queue order
  const capacityRows = useMemo(() => {
    if (!loaded) return [];
    const matching = jobs
      .filter((j) => j.status === 'pending' && j.material === loaded.material)
      .sort((a, b) => orderIndex(a.id) - orderIndex(b.id) || a.submittedAt.localeCompare(b.submittedAt));
    let cum = 0;
    return matching.map((job) => {
      const ft = feetNeeded(effectiveDims(job, jobMeta[job.id]));
      cum += ft;
      const cumRounded = Math.round(cum * 10) / 10;
      return { job, ft, cumFt: cumRounded, fitsOnCurrent: cumRounded <= loaded.remainingFt };
    });
  }, [jobs, loaded, orderIndex]);

  const rank = (j: PrintJob): number => {
    if (j.status === 'in_progress') return 0;
    if (j.status === 'ready') return 1;
    if (j.status === 'pending') {
      // Deadline jobs float up within pending
      const meta = jobMeta[j.id];
      if (meta?.deadline) return isRushed(j.id) ? 1.5 : 1.8;
      return isRushed(j.id) ? 2 : 2.5;
    }
    return 3;
  };

  const q = search.trim().toLowerCase();
  const visible = jobs
    .filter((j) => {
      if (filter === 'pending' && j.status !== 'pending' && j.status !== 'in_progress') return false;
      if (filter === 'ready' && j.status !== 'ready') return false;
      if (filter === 'completed' && j.status !== 'completed') return false;
      if (dept !== 'all' && j.department !== dept) return false;
      if (q && ![j.content, j.requester, j.notes, j.material, jobMeta[j.id]?.operatorNote].some((f) => f?.toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) =>
      rank(a) - rank(b)
      || orderIndex(a.id) - orderIndex(b.id)
      || a.submittedAt.localeCompare(b.submittedAt));

  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const onDrop = (targetId: string) => {
    if (dragId.current) move(dragId.current, targetId, visible.map((j) => j.id));
    dragId.current = null;
  };

  // First swap point in capacity rows
  const firstSwap = capacityRows.findIndex((r) => !r.fitsOnCurrent);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{t('queue.title')}</div>
          <div className="page-sub">{today}</div>
        </div>
        <div className="page-actions">
          <button className="btn-ghost" onClick={refresh} disabled={state === 'loading'}>
            <i className={`ti ti-refresh${state === 'loading' ? ' spin' : ''}`} aria-hidden="true" /> {t('queue.refresh')}
          </button>
        </div>
      </div>

      <div className="page-content">
        <div className="metrics metrics--5">
          <Metric icon="ti-files" tone="cream" trend={t('queue.trend.today')} value={counts.total} label={t('queue.metric.total')} />
          <Metric icon="ti-clock" tone="terra" trend={t('queue.trend.queue')} value={counts.pending} label={t('queue.metric.pending')} />
          <Metric icon="ti-player-play" tone="teal" trend={t('queue.trend.now')} value={counts.inProgress} label={t('queue.metric.inProgress')} />
          <Metric icon="ti-circle-check" tone="amber" trend="" value={counts.ready} label={t('queue.metric.ready')} />
          <Metric icon="ti-package" tone="slate" trend={t('queue.trend.today')} value={counts.completed} label={t('queue.metric.completed')} />
        </div>

        {nestGroups.length > 0 && (
          <div className="nest-panel">
            <div className="nest-head">
              <div className="nest-title"><i className="ti ti-layout-grid" aria-hidden="true" /> {t('nesting.title')}</div>
              <div className="nest-sub">{t('nesting.sub')}</div>
            </div>
            <div className="nest-list">
              {nestGroups.map((g, i) => (
                <div className="nest-group" key={i}>
                  <div className="nest-group-top">
                    <span className="mat">{g.material}</span>
                    <span className="nest-saved"><i className="ti ti-arrow-down-right" aria-hidden="true" /> {t('nesting.saves', { ft: g.savedFt })}</span>
                  </div>
                  <div className="nest-jobs">
                    {g.jobs.map((j) => (
                      <span className="nest-chip" key={j.id}>{j.content} <em>{j.widthIn}″</em></span>
                    ))}
                  </div>
                  <div className="nest-width">{t('nesting.used', { w: g.totalWidthIn })}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Capacity panel */}
        {loaded && (
          <div className="cap-panel">
            <div className="cap-head">
              <div className="cap-title"><i className="ti ti-ruler-measure" aria-hidden="true" /> {t('capacity.title')}</div>
              <div className="cap-info">
                <span className="cap-mat">{loaded.material}</span>
                <span className="cap-ft">{loaded.remainingFt} ft {t('common.remaining')}</span>
              </div>
            </div>
            {capacityRows.length === 0 ? (
              <div className="cap-empty">{t('capacity.noMatch', { material: loaded.material })}</div>
            ) : (
              <div className="cap-list">
                {capacityRows.map((row, i) => (
                  <div key={row.job.id}>
                    {firstSwap === i && (
                      <div className="cap-swap-line">
                        <span className="cap-swap-label"><i className="ti ti-arrows-exchange" aria-hidden="true" /> {t('capacity.swapAfter')}</span>
                      </div>
                    )}
                    <div className={`cap-row${row.fitsOnCurrent ? '' : ' cap-row--swap'}`}>
                      <span className="cap-n">{i + 1}</span>
                      <span className="cap-name">{row.job.content}</span>
                      <span className="cap-need">−{row.ft} ft</span>
                      <span className="cap-cum">{t('capacity.cumulative', { ft: row.cumFt })}</span>
                      <span className={`cap-badge${row.fitsOnCurrent ? ' cap-badge--ok' : ' cap-badge--swap'}`}>
                        {row.fitsOnCurrent ? t('capacity.fits') : t('capacity.needsSwap')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">{t('queue.requests')}</div>
              <div className="panel-meta">
                <span className={`sync-dot sync-dot--${SOURCE_META[source].cls}`} />
                {t(SOURCE_META[source].labelKey)} · {relativeTime(syncedAt)}
              </div>
            </div>
            <div className="seg" role="tablist" aria-label={t('queue.requests')}>
              {(['all', 'pending', 'ready', 'completed'] as Filter[]).map((f) => (
                <button
                  key={f} role="tab" aria-selected={filter === f}
                  className={`seg-btn${filter === f ? ' seg-btn--on' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? t('queue.filter.all')
                    : f === 'pending' ? t('queue.filter.pending')
                    : f === 'ready' ? t('queue.filter.ready')
                    : t('queue.filter.done')}
                </button>
              ))}
            </div>
          </div>

          <div className="queue-toolbar">
            <div className="search-box">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                type="text" placeholder={t('queue.search.placeholder')}
                value={search} onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear search"><i className="ti ti-x" aria-hidden="true" /></button>}
            </div>
            <select className="dept-filter" value={dept} onChange={(e) => setDept(e.target.value)} aria-label={t('queue.allDepts')}>
              <option value="all">{t('queue.allDepts')}</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <table className="job-table">
            <colgroup>
              <col style={{ width: '28%' }} /><col style={{ width: '13%' }} /><col style={{ width: '11%' }} />
              <col style={{ width: '7%' }} /><col style={{ width: '16%' }} /><col style={{ width: '25%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('queue.col.job')}</th><th>{t('queue.col.size')}</th><th>{t('queue.col.dept')}</th>
                <th>{t('queue.col.qty')}</th><th>{t('queue.col.status')}</th>
                <th style={{ textAlign: 'right' }}>{t('queue.col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  rushed={isRushed(job.id)}
                  meta={jobMeta[job.id] ?? {}}
                  onToggleRush={() => toggleRush(job.id)}
                  onPrint={() => setDialogJob(job)}
                  onMarkReady={() => markReady(job)}
                  onMarkPickedUp={() => markPickedUp(job)}
                  onReprint={() => setReprintJob(job)}
                  onHistory={() => setHistoryJob(job)}
                  onMetaChange={(patch) => setJobMeta(job.id, patch)}
                  draggable={job.status === 'pending'}
                  onDragStart={() => { dragId.current = job.id; }}
                  onDropRow={() => onDrop(job.id)}
                />
              ))}
            </tbody>
          </table>
          {visible.length === 0 && state === 'loading' && (
            <div className="table-empty"><i className="ti ti-loader spin" aria-hidden="true" /> {t('queue.loading')}</div>
          )}
          {visible.length === 0 && state !== 'loading' && (
            <div className="table-empty">{t('queue.empty')}</div>
          )}
        </div>
      </div>

      {dialogJob && (
        <PrintDialog
          job={effJob(dialogJob)}
          onClose={() => setDialogJob(null)}
          onSent={() => { setJobStatus(dialogJob.id, 'in_progress'); setDialogJob(null); }}
        />
      )}

      {reprintJob && (
        <ReprintModal
          job={reprintJob}
          onClose={() => setReprintJob(null)}
          onConfirm={(reason, wastedFt) => {
            logReprint(reprintJob.material, wastedFt, reason, reprintJob.id);
            const job = reprintJob;
            setReprintJob(null);
            setDialogJob(job);
          }}
        />
      )}

      {historyJob && (
        <JobHistoryModal
          job={historyJob}
          statusLog={statusLog[historyJob.id] ?? []}
          onClose={() => setHistoryJob(null)}
        />
      )}
    </>
  );
}

function Metric({ icon, tone, trend, value, label }: {
  icon: string; tone: string; trend: string; value: number; label: string;
}) {
  return (
    <div className="metric">
      <div className="m-top">
        <div className={`m-icon m-icon--${tone}`}><i className={`ti ${icon}`} aria-hidden="true" /></div>
        <span className="m-trend">{trend}</span>
      </div>
      <div className={`m-num m-num--${tone}`}>{value}</div>
      <div className="m-label">{label}</div>
    </div>
  );
}

interface JobMeta { deadline?: string; operatorNote?: string; widthInOverride?: number; heightInOverride?: number; }

function JobRow({
  job, rushed, meta, onToggleRush, onPrint, onMarkReady, onMarkPickedUp, onReprint, onHistory, onMetaChange,
  draggable, onDragStart, onDropRow,
}: {
  job: PrintJob; rushed: boolean; meta: JobMeta;
  onToggleRush: () => void; onPrint: () => void;
  onMarkReady: () => void; onMarkPickedUp: () => void; onReprint: () => void; onHistory: () => void;
  onMetaChange: (patch: Partial<JobMeta>) => void;
  draggable: boolean; onDragStart: () => void; onDropRow: () => void;
}) {
  const t = useT();
  const [editingMeta, setEditingMeta] = useState(false);
  const [noteVal, setNoteVal] = useState(meta.operatorNote ?? '');
  const [dlVal, setDlVal] = useState(meta.deadline ?? '');
  const effW = meta.widthInOverride ?? job.widthIn;
  const effH = meta.heightInOverride ?? job.heightIn;
  const [wVal, setWVal] = useState<string>(String(effW));
  const [hVal, setHVal] = useState<string>(String(effH));

  const saveMeta = () => {
    const w = parseFloat(wVal);
    const h = parseFloat(hVal);
    onMetaChange({
      operatorNote: noteVal.trim() || undefined,
      deadline: dlVal || undefined,
      widthInOverride: !isNaN(w) && w !== job.widthIn ? w : undefined,
      heightInOverride: !isNaN(h) && h !== job.heightIn ? h : undefined,
    });
    setEditingMeta(false);
  };

  const statusCls: Record<JobStatus, string> = {
    pending: 'pend', in_progress: 'prog', ready: 'ready', completed: 'done',
  };
  const statusKey: Record<JobStatus, string> = {
    pending: 'status.pending', in_progress: 'status.in_progress',
    ready: 'status.ready', completed: 'status.completed',
  };

  const canRush = job.status === 'pending';
  const subParts: string[] = [job.material];
  if (meta.deadline) subParts.push(`⏰ ${new Date(meta.deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
  if (meta.operatorNote) subParts.push(`📝 ${meta.operatorNote}`);
  if (job.notes) subParts.push(job.notes);
  const subline = subParts.join(' · ');

  return (
    <>
      <tr
        className={job.status === 'completed' ? 'row--done' : ''}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={draggable ? (e) => e.preventDefault() : undefined}
        onDrop={draggable ? onDropRow : undefined}
      >
        <td>
          <div className="job">
            {draggable && <i className="ti ti-grip-vertical drag-handle" aria-hidden="true" />}
            <div className="job-ic"><i className={`ti ${MATERIAL_ICON[job.material]}`} aria-hidden="true" /></div>
            <div className="job-text">
              <div className="job-name">
                <button className="job-name-btn" onClick={onHistory}>{job.content}</button>
                {rushed && canRush && <span className="rush-badge"><i className="ti ti-bolt" aria-hidden="true" /> {t('queue.badge.rush')}</span>}
              </div>
              <div className="job-mat">{subline}</div>
            </div>
          </div>
        </td>
        <td>
          {effW} × {effH} in
          {(meta.widthInOverride !== undefined || meta.heightInOverride !== undefined) && (
            <span className="dim-override-badge" title={`Original: ${job.widthIn} × ${job.heightIn} in`}> ✎</span>
          )}
        </td>
        <td><span className="dept">{job.department}</span></td>
        <td><span className="qty">{job.quantity}</span></td>
        <td><span className={`pill pill--${statusCls[job.status]}`}><span className="pd" />{t(statusKey[job.status])}</span></td>
        <td style={{ textAlign: 'right' }}>
          {job.status === 'pending' && (
            <div className="act-group">
              <button
                className={`rush-btn${rushed ? ' rush-btn--on' : ''}`}
                onClick={onToggleRush}
                title={rushed ? t('queue.action.unrush') : t('queue.action.rush')}
                aria-label={rushed ? t('queue.action.unrush') : t('queue.action.rush')}
              >
                <i className="ti ti-bolt" aria-hidden="true" />
              </button>
              <button className="act-icon" onClick={() => { setNoteVal(meta.operatorNote ?? ''); setDlVal(meta.deadline ?? ''); setEditingMeta((p) => !p); }} title={t('queue.notes.label')} aria-label={t('queue.notes.label')}>
                <i className="ti ti-notes" aria-hidden="true" />
              </button>
              <button className="act act--go" onClick={onPrint}><i className="ti ti-printer" aria-hidden="true" /> {t('queue.action.print')}</button>
            </div>
          )}
          {job.status === 'in_progress' && (
            <div className="act-group">
              <button className="act-icon" onClick={onHistory} title={t('queue.history.btn')}><i className="ti ti-history" aria-hidden="true" /></button>
              <button className="act act--mark" onClick={onMarkReady}><i className="ti ti-circle-check" aria-hidden="true" /> {t('queue.action.markReady')}</button>
            </div>
          )}
          {job.status === 'ready' && (
            <div className="act-group">
              <button className="act-icon" onClick={onHistory} title={t('queue.history.btn')}><i className="ti ti-history" aria-hidden="true" /></button>
              <button className="act act--pickup" onClick={onMarkPickedUp}><i className="ti ti-package" aria-hidden="true" /> {t('queue.action.markPickedUp')}</button>
            </div>
          )}
          {job.status === 'completed' && (
            <div className="act-group">
              <button className="act-icon" onClick={onHistory} title={t('queue.history.btn')}><i className="ti ti-history" aria-hidden="true" /></button>
              <button className="act act--reprint" onClick={onReprint}><i className="ti ti-rotate-clockwise" aria-hidden="true" /> {t('queue.action.reprint')}</button>
            </div>
          )}
        </td>
      </tr>
      {editingMeta && (
        <tr className="meta-row">
          <td colSpan={6}>
            <div className="meta-edit">
              <div className="meta-field meta-field--dim">
                <label>Width (in)</label>
                <input type="number" min={0} step={0.5} value={wVal} onChange={(e) => setWVal(e.target.value)} />
              </div>
              <div className="meta-field meta-field--dim">
                <label>Height (in)</label>
                <input type="number" min={0} step={0.5} value={hVal} onChange={(e) => setHVal(e.target.value)} />
              </div>
              <div className="meta-field">
                <label>{t('queue.deadline.label')}</label>
                <input type="datetime-local" value={dlVal} onChange={(e) => setDlVal(e.target.value)} />
              </div>
              <div className="meta-field meta-field--wide">
                <label>{t('queue.notes.label')}</label>
                <input type="text" value={noteVal} placeholder={t('queue.notes.placeholder')} onChange={(e) => setNoteVal(e.target.value)} />
              </div>
              <div className="meta-actions">
                <button className="btn-ghost btn-sm" onClick={() => setEditingMeta(false)}>{t('common.cancel')}</button>
                <button className="btn-primary btn-sm" onClick={saveMeta}>{t('common.save')}</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ReprintModal({ job, onClose, onConfirm }: {
  job: PrintJob; onClose: () => void; onConfirm: (reason: ReprintReason, wastedFt: number) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState<ReprintReason>('Low resolution');
  const isWaste = reason !== 'Additional copies (not waste)';
  const [wastedFt, setWastedFt] = useState<number>(feetNeeded(job));

  return (
    <Modal
      title={`${t('reprint.title')} — ${job.content}`} icon="ti-rotate-clockwise"
      subtitle={`${job.material} · ${job.widthIn}×${job.heightIn} in`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={() => onConfirm(reason, isWaste ? wastedFt : 0)}>
            <i className="ti ti-printer" aria-hidden="true" /> {t('reprint.confirm')}
          </button>
        </>
      )}
    >
      <div className="field">
        <label>{t('reprint.reason')}</label>
        <select value={reason} onChange={(e) => {
          const r = e.target.value as ReprintReason;
          setReason(r);
          if (r !== 'Additional copies (not waste)') setWastedFt(feetNeeded(job));
        }}>
          {REPRINT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {isWaste && (
        <div className="field">
          <label>{t('reprint.wasted')}</label>
          <input type="number" min={0} step={0.5} value={wastedFt} onChange={(e) => setWastedFt(Number(e.target.value))} />
          <span className="field-hint">{t('reprint.wastedHint', { material: job.material })}</span>
        </div>
      )}
    </Modal>
  );
}
