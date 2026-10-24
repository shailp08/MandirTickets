import { useInventory } from '../context/InventoryContext';
import { StatusEntry } from '../context/JobsContext';
import { useT } from '../i18n';
import { PrintJob } from '../types';
import Modal from './Modal';
import './JobHistoryModal.css';

interface Props {
  job: PrintJob;
  statusLog: StatusEntry[];
  onClose: () => void;
}

interface TimelineItem {
  at: string;
  icon: string;
  tone: 'default' | 'teal' | 'terra' | 'ready';
  text: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function JobHistoryModal({ job, statusLog, onClose }: Props) {
  const t = useT();
  const { events } = useInventory();

  const consumptionEvents = events.filter(
    (e) => (e.type === 'roll_consumed' || e.type === 'reprint_logged') && e.jobId === job.id,
  );

  const timeline: TimelineItem[] = [];

  // Submitted
  timeline.push({
    at: job.submittedAt,
    icon: 'ti-circle-plus',
    tone: 'default',
    text: t('jobHistory.submitted'),
  });

  // Status changes (recorded this session)
  statusLog.forEach((entry) => {
    const icons: Record<string, string> = {
      in_progress: 'ti-player-play',
      ready: 'ti-circle-check',
      completed: 'ti-package',
      pending: 'ti-clock',
    };
    const tones: Record<string, TimelineItem['tone']> = {
      in_progress: 'teal',
      ready: 'ready',
      completed: 'teal',
      pending: 'default',
    };
    timeline.push({
      at: entry.at,
      icon: icons[entry.status] ?? 'ti-circle',
      tone: tones[entry.status] ?? 'default',
      text: t(`status.${entry.status}`),
    });
  });

  // Consumption + reprint events
  consumptionEvents.forEach((e) => {
    if (e.type === 'roll_consumed') {
      timeline.push({
        at: e.at,
        icon: 'ti-printer',
        tone: 'teal',
        text: t('jobHistory.printed', { ft: e.ft }),
      });
    } else if (e.type === 'reprint_logged') {
      timeline.push({
        at: e.at,
        icon: 'ti-rotate-clockwise',
        tone: 'terra',
        text: t('jobHistory.reprint', { reason: e.reason, ft: e.wastedFt }),
      });
    }
  });

  // Sort by timestamp
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  return (
    <Modal
      title={t('jobHistory.title')}
      icon="ti-history"
      subtitle={`${job.content} · ${job.material} · ${job.widthIn}×${job.heightIn} in`}
      onClose={onClose}
      footer={<button className="btn-ghost" onClick={onClose}>{t('common.close')}</button>}
    >
      <div className="jh-meta">
        <span className="jh-meta-item"><i className="ti ti-user" aria-hidden="true" /> {job.requester ?? '—'}</span>
        <span className="jh-meta-item"><i className="ti ti-building" aria-hidden="true" /> {job.department}</span>
        <span className="jh-meta-item"><i className="ti ti-stack" aria-hidden="true" /> ×{job.quantity}</span>
      </div>

      {timeline.length === 0 ? (
        <div className="jh-empty">{t('jobHistory.noEvents')}</div>
      ) : (
        <ol className="jh-timeline">
          {timeline.map((item, i) => (
            <li key={i} className={`jh-item jh-item--${item.tone}`}>
              <div className="jh-dot"><i className={`ti ${item.icon}`} aria-hidden="true" /></div>
              <div className="jh-body">
                <div className="jh-text">{item.text}</div>
                <div className="jh-when">{fmt(item.at)}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
