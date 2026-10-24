import { Alert } from '../types';
import './AlertTicker.css';

interface Props {
  alerts: Alert[];
}

/** Continuously scrolling banner of low-stock / printer alerts.
 *  The track is duplicated so the CSS marquee loops seamlessly. */
export default function AlertTicker({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="ticker ticker--calm">
        <div className="ticker-tag ticker-tag--calm">
          <i className="ti ti-circle-check" aria-hidden="true" /> ALL CLEAR
        </div>
        <div className="ticker-calm-msg">No active alerts — supplies and printer are healthy.</div>
      </div>
    );
  }

  const items = [...alerts, ...alerts]; // duplicate for seamless loop

  return (
    <div className="ticker">
      <div className="ticker-tag">
        <span className="ticker-live" />
        LIVE ALERTS
      </div>
      <div className="ticker-scroll">
        <div className="ticker-row" role="list" aria-label="Active alerts">
          {items.map((a, i) => (
            <span className="ticker-alert" role="listitem" key={`${a.id}-${i}`}>
              <span className={`ticker-dot ticker-dot--${a.severity}`} />
              <b className={`ticker-${a.severity}`}>{a.title}</b>
              {' — '}{a.detail}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
