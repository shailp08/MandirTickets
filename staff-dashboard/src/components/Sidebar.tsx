import { NavLink } from 'react-router-dom';
import { useT } from '../i18n';
import { PrinterStatus } from '../types';
import './Sidebar.css';

interface NavItem {
  to: string;
  icon: string;
  labelKey: string;
  badge?: number;
}

interface Props {
  printer: PrinterStatus;
  pendingCount: number;
}

export default function Sidebar({ printer, pendingCount }: Props) {
  const t = useT();

  const items: NavItem[] = [
    { to: '/', icon: 'ti-layout-list', labelKey: 'nav.queue', badge: pendingCount },
    { to: '/inventory', icon: 'ti-stack-2', labelKey: 'nav.inventory' },
    { to: '/history', icon: 'ti-chart-line', labelKey: 'nav.history' },
    { to: '/maintenance', icon: 'ti-tool', labelKey: 'nav.maintenance' },
    { to: '/suppliers', icon: 'ti-truck-delivery', labelKey: 'nav.suppliers' },
    { to: '/settings', icon: 'ti-settings', labelKey: 'nav.settings' },
  ];

  return (
    <nav className="sidebar">
      <div className="brand">
        <div className="brand-logo"><i className="ti ti-printer" aria-hidden="true" /></div>
        <div>
          <div className="brand-name">{t('nav.brand')}</div>
          <div className="brand-sub">{t('nav.brandSub')}</div>
        </div>
      </div>

      <div className="nav-label">{t('nav.workspace')}</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
        >
          <i className={`ti ${item.icon}`} aria-hidden="true" />
          <span>{t(item.labelKey)}</span>
          {item.badge ? <span className="nav-count">{item.badge}</span> : null}
        </NavLink>
      ))}

      <div className="nav-spacer" />

      <div className={`printer-box${printer.online ? '' : ' printer-box--offline'}`}>
        <div className="pb-row">
          <span className="pb-status" />
          <span className="pb-name">{printer.online ? t('printer.online') : t('printer.offline')}</span>
        </div>
        <div className="pb-detail">
          {printer.model}<br />
          {printer.widthIn} in · {printer.state}
        </div>
      </div>
    </nav>
  );
}
