import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { JOB_META_KEY, POLL_INTERVAL_MS, STATUS_LOG_KEY } from '../config';
import { DataSource, fetchJobs, updateJobStatus } from '../services/sheetService';
import { JobStatus, PrintJob } from '../types';

type LoadState = 'loading' | 'ready' | 'error';

export interface JobMeta {
  deadline?: string;       // ISO datetime string
  operatorNote?: string;
  widthInOverride?: number;
  heightInOverride?: number;
}

export interface StatusEntry {
  status: JobStatus;
  at: string;              // ISO timestamp
}

interface JobsContextValue {
  jobs: PrintJob[];
  state: LoadState;
  source: DataSource;
  syncedAt: number | null;
  error: string | null;
  refresh: () => void;
  setJobStatus: (jobId: string, status: JobStatus) => void;
  jobMeta: Record<string, JobMeta>;
  setJobMeta: (jobId: string, patch: Partial<JobMeta>) => void;
  statusLog: Record<string, StatusEntry[]>;
}

const JobsContext = createContext<JobsContextValue | null>(null);

function loadMeta(): Record<string, JobMeta> {
  try {
    const raw = localStorage.getItem(JOB_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveMeta(meta: Record<string, JobMeta>): void {
  try { localStorage.setItem(JOB_META_KEY, JSON.stringify(meta)); } catch { /* full */ }
}

function loadStatusLog(): Record<string, StatusEntry[]> {
  try {
    const raw = localStorage.getItem(STATUS_LOG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveStatusLog(log: Record<string, StatusEntry[]>): void {
  try { localStorage.setItem(STATUS_LOG_KEY, JSON.stringify(log)); } catch { /* full */ }
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [source, setSource] = useState<DataSource>('mock');
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobMeta, setJobMetaState] = useState<Record<string, JobMeta>>(loadMeta);
  const [statusLog, setStatusLog] = useState<Record<string, StatusEntry[]>>(loadStatusLog);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await fetchJobs();
      setJobs(result.jobs);
      setSource(result.source);
      setSyncedAt(result.syncedAt);
      setError(null);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
      setState('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const setJobStatus = useCallback((jobId: string, status: JobStatus) => {
    const at = new Date().toISOString();
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status } : j)));
    setStatusLog((prev) => {
      const next = {
        ...prev,
        [jobId]: [...(prev[jobId] ?? []), { status, at }],
      };
      saveStatusLog(next);
      return next;
    });
    updateJobStatus(jobId, status).catch(() => { /* next poll reconciles */ });
  }, []);

  const setJobMeta = useCallback((jobId: string, patch: Partial<JobMeta>) => {
    setJobMetaState((prev) => {
      const next = { ...prev, [jobId]: { ...prev[jobId], ...patch } };
      saveMeta(next);
      return next;
    });
  }, []);

  return (
    <JobsContext.Provider value={{
      jobs, state, source, syncedAt, error, refresh: load,
      setJobStatus, jobMeta, setJobMeta, statusLog,
    }}>
      {children}
    </JobsContext.Provider>
  );
}

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within a JobsProvider');
  return ctx;
}
