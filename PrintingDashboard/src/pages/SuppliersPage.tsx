import { useState } from 'react';
import { useOps } from '../context/OpsContext';
import { useT } from '../i18n';
import { ROLL_LENGTH_FT } from '../config';
import { Vendor } from '../types';
import './OpsPages.css';

const SUPPLY_OPTIONS = [
  'General',
  ...Object.keys(ROLL_LENGTH_FT).map((m) => `${m} paper`),
  'Black ink', 'Cyan ink', 'Magenta ink', 'Yellow ink',
];

export default function SuppliersPage() {
  const t = useT();
  const { vendors, addVendor, deleteVendor } = useOps();
  const [form, setForm] = useState<Omit<Vendor, 'id'>>({ name: '', supply: 'General' });

  const set = (patch: Partial<Vendor>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    if (!form.name.trim()) return;
    addVendor({
      ...form,
      name: form.name.trim(),
      url: form.url?.trim() || undefined,
      contact: form.contact?.trim() || undefined,
    });
    setForm({ name: '', supply: 'General' });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{t('suppliers.title')}</div>
          <div className="page-sub">{t('suppliers.sub')}</div>
        </div>
      </div>

      <div className="page-content">
        <div className="card ops-form">
          <div className="vendor-form-grid">
            <div className="fg"><label className="fl">{t('suppliers.name')}</label><input value={form.name} placeholder={t('suppliers.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} /></div>
            <div className="fg"><label className="fl">{t('suppliers.supply')}</label>
              <select value={form.supply} onChange={(e) => set({ supply: e.target.value })}>
                {SUPPLY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="fg"><label className="fl">{t('suppliers.contact')}</label><input value={form.contact ?? ''} placeholder={t('suppliers.contactPlaceholder')} onChange={(e) => set({ contact: e.target.value })} /></div>
            <div className="fg"><label className="fl">{t('suppliers.reorderLink')}</label><input value={form.url ?? ''} placeholder="https://…" onChange={(e) => set({ url: e.target.value })} /></div>
            <div className="fg"><label className="fl">{t('suppliers.unitCost')}</label><input type="number" min={0} step={0.01} value={form.unitCost ?? ''} onChange={(e) => set({ unitCost: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <div className="fg"><label className="fl">{t('suppliers.leadTime')}</label><input type="number" min={0} value={form.leadTimeDays ?? ''} onChange={(e) => set({ leadTimeDays: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <button className="btn-primary" onClick={submit}><i className="ti ti-plus" aria-hidden="true" /> {t('suppliers.addBtn')}</button>
          </div>
        </div>

        <div className="vendor-grid">
          {vendors.length === 0 && <div className="ops-empty card">{t('suppliers.noVendors')}</div>}
          {vendors.map((v) => (
            <div className="card vendor-card" key={v.id}>
              <div className="vendor-top">
                <div>
                  <div className="vendor-name">{v.name}</div>
                  <div className="vendor-supply">{v.supply}</div>
                </div>
                <button className="ops-del" onClick={() => deleteVendor(v.id)} aria-label={t('suppliers.deleteTitle')}><i className="ti ti-trash" aria-hidden="true" /></button>
              </div>
              <div className="vendor-meta">
                {v.contact && <div><i className="ti ti-phone" aria-hidden="true" /> {v.contact}</div>}
                {v.unitCost != null && <div><i className="ti ti-currency-dollar" aria-hidden="true" /> {v.unitCost.toFixed(2)} / unit</div>}
                {v.leadTimeDays != null && <div><i className="ti ti-clock" aria-hidden="true" /> {v.leadTimeDays} day lead</div>}
              </div>
              {v.url && (
                <a className="vendor-reorder" href={v.url} target="_blank" rel="noreferrer">
                  <i className="ti ti-external-link" aria-hidden="true" /> {t('suppliers.reorder')}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
