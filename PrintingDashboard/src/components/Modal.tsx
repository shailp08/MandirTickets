import { useEffect } from 'react';
import './Modal.css';

interface Props {
  title: string;
  icon?: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Lightweight centered modal with backdrop. Closes on Esc / backdrop click. */
export default function Modal({ title, icon, subtitle, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-left">
            {icon && <div className="modal-icon"><i className={`ti ${icon}`} aria-hidden="true" /></div>}
            <div>
              <div className="modal-title">{title}</div>
              {subtitle && <div className="modal-subtitle">{subtitle}</div>}
            </div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close"><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
