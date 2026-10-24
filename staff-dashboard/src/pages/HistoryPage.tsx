import { useState } from 'react';
import {
  BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { useInventory } from '../context/InventoryContext';
import { useOps } from '../context/OpsContext';
import { useT } from '../i18n';
import { buildAnalytics, describeEvent } from '../lib/analytics';
import { deriveReorderList, ReorderItem } from '../lib/alerts';
import { BACKEND_URL } from '../config';
import { Vendor } from '../types';
import './HistoryPage.css';

function matchVendor(item: ReorderItem, vendors: Vendor[]): Vendor | undefined {
  const token = item.name.split(' ')[0].toLowerCase();
  const specific = vendors.find((v) => v.url && v.supply.toLowerCase().startsWith(token));
  if (specific) return specific;
  return vendors.find((v) => v.url && v.supply === 'General');
}

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const MATERIAL_COLOR: Record<string, string> = {
  Canvas: '#7bb5b9', Glossy: '#c2483d', Regular: '#d9a441', Sticky: '#b75744', Outdoor: '#28435a',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function monthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString([], { month: 'long', year: 'numeric' });
    opts.push({ value: val, label });
  }
  return opts;
}

export default function HistoryPage() {
  const t = useT();
  const { events, inventory } = useInventory();
  const { vendors } = useOps();
  const a = buildAnalytics(events);
  const reorder = deriveReorderList(inventory);
  const recent = [...events].reverse();
  const months = monthOptions();
  const [selectedMonth, setSelectedMonth] = useState(months[0].value);
  const [exporting, setExporting] = useState(false);

  const chartData = {
    labels: a.paperUsedByMaterial.map((m) => m.material),
    datasets: [{
      data: a.paperUsedByMaterial.map((m) => m.ft),
      backgroundColor: a.paperUsedByMaterial.map((m) => MATERIAL_COLOR[m.material] ?? '#7bb5b9'),
      borderRadius: 6,
      maxBarThickness: 48,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1c1f26', titleColor: '#f4f5f7', bodyColor: '#9ba1ad',
        borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 10,
        callbacks: { label: (ctx: any) => ` ${ctx.parsed.y} ft used` },
      },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#5d636e', font: { size: 11 } } },
      x: { grid: { display: false }, ticks: { color: '#9ba1ad', font: { size: 12 } } },
    },
  } as const;

  const exportPdf = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/reports/monthly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          analytics: a,
          reorder,
          events: events.filter((e) => e.at.startsWith(selectedMonth)),
        }),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a2 = document.createElement('a');
      a2.href = url;
      a2.download = `printtrack-report-${selectedMonth}.pdf`;
      a2.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('PDF export failed. Make sure the backend server is running.');
    } finally {
      setExporting(false);
    }
  };

  const actSub = events.length === 1
    ? t('history.activitySub', { n: events.length })
    : t('history.activitySubPlural', { n: events.length });

  const reprintLabel = a.reprints === 1
    ? t('history.reprints', { n: a.reprints })
    : t('history.reprintsPlural', { n: a.reprints });

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{t('history.title')}</div>
          <div className="page-sub">{t('history.sub')}</div>
        </div>
        <div className="page-actions">
          <div className="pdf-export">
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button className="btn-ghost" onClick={exportPdf} disabled={exporting}>
              <i className={`ti ${exporting ? 'ti-loader spin' : 'ti-file-type-pdf'}`} aria-hidden="true" /> {t('history.exportPdf')}
            </button>
          </div>
        </div>
      </div>

      <div className="page-content">
        <div className="metrics">
          <Metric icon="ti-ruler-measure" tone="cream" value={`${a.totalPaperUsedFt} ft`} label={t('history.paperUsed')} />
          <Metric icon="ti-printer" tone="teal" value={`${a.jobsPrinted}`} label={t('history.jobsPrinted')} />
          <Metric icon="ti-rotate-clockwise" tone="terra" value={`${a.wastedFt} ft`} label={`${t('history.wasted')} · ${reprintLabel}`} />
          <Metric icon="ti-droplet" tone="slate" value={`${a.inkReplacements}`} label={t('history.inkReplacements')} />
        </div>

        <div className="hist-grid">
          <div className="panel">
            <div className="panel-head"><div><div className="panel-title">{t('history.chartTitle')}</div><div className="panel-meta">{t('history.chartSub')}</div></div></div>
            <div className="chart-wrap">
              {a.paperUsedByMaterial.length === 0
                ? <div className="hist-empty">{t('history.noChart')}</div>
                : <div className="chart-box"><Bar data={chartData} options={chartOptions} /></div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><div className="panel-title">{t('history.reorderTitle')}</div><div className="panel-meta">{t('history.reorderSub')}</div></div></div>
            <div className="reorder">
              {reorder.length === 0
                ? <div className="hist-empty"><i className="ti ti-circle-check" aria-hidden="true" /> {t('history.allStocked')}</div>
                : reorder.map((item) => (
                  <div className="reorder-row" key={`${item.kind}-${item.name}`}>
                    <div className={`reorder-ic reorder-ic--${item.kind}`}><i className={`ti ${item.kind === 'paper' ? 'ti-rollercoaster' : 'ti-droplet'}`} aria-hidden="true" /></div>
                    <div className="reorder-text">
                      <div className="reorder-name">{item.name}</div>
                      <div className="reorder-detail">{item.detail}</div>
                    </div>
                    <span className={`reorder-count${item.sparesInStock === 0 ? ' reorder-count--zero' : ''}`}>
                      {t('history.reorderLeft', { n: item.sparesInStock })}
                    </span>
                    {(() => {
                      const v = matchVendor(item, vendors);
                      return v?.url ? (
                        <a className="reorder-link" href={v.url} target="_blank" rel="noreferrer" title={`Reorder from ${v.name}`}>
                          <i className="ti ti-external-link" aria-hidden="true" />
                        </a>
                      ) : null;
                    })()}
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">{t('history.activityTitle')}</div><div className="panel-meta">{actSub}</div></div></div>
          <div className="audit">
            {recent.length === 0
              ? <div className="hist-empty">{t('history.noActivity')}</div>
              : recent.map((e) => {
                const d = describeEvent(e);
                return (
                  <div className="audit-row" key={e.id}>
                    <div className="audit-ic"><i className={`ti ${d.icon}`} aria-hidden="true" /></div>
                    <div className="audit-text">{d.text}</div>
                    <div className="audit-when">{fmtWhen(e.at)}</div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </>
  );
}

function Metric({ icon, tone, value, label }: { icon: string; tone: string; value: string; label: string }) {
  return (
    <div className="metric">
      <div className="m-top">
        <div className={`m-icon m-icon--${tone}`}><i className={`ti ${icon}`} aria-hidden="true" /></div>
      </div>
      <div className="m-num">{value}</div>
      <div className="m-label">{label}</div>
    </div>
  );
}
