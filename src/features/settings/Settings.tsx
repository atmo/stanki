import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { DEFAULT_SETTINGS, type SrSettings } from '@shared/sm2';
import { getSettings, saveSettings, exportAll, importBundle, type ExportBundle } from '../../db/repo';
import { listBackups, restoreBackup, type BackupRef } from '../../sync/sync';
import { getToken } from '../../sync/googleAuth';

function fmtTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : 'never';
}

export function Settings() {
  const { connected, configured, syncStatus, syncError, lastSync, connect, disconnect, syncNow } = useStore();
  const [s, setS] = useState<SrSettings>(DEFAULT_SETTINGS);
  const fileRef = useRef<HTMLInputElement>(null);
  const [backups, setBackups] = useState<BackupRef[] | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  useEffect(() => {
    void getSettings().then(setS);
  }, []);

  async function loadBackups() {
    setBackupBusy(true);
    try {
      setBackups(await listBackups(getToken));
    } catch (e) {
      alert(`Could not load backups: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackupBusy(false);
    }
  }

  async function restore(b: BackupRef) {
    if (!confirm(`Restore the backup from ${new Date(b.at).toLocaleString()} (${b.cards} cards)?\n\nIt overwrites current cards with that snapshot; cards added since are kept.`)) {
      return;
    }
    setBackupBusy(true);
    try {
      await restoreBackup(getToken, b.id);
      await syncNow();
      alert('Backup restored.');
    } catch (e) {
      alert(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBackupBusy(false);
    }
  }

  function update<K extends keyof SrSettings>(key: K, value: number) {
    const next = { ...s, [key]: value };
    setS(next);
    void saveSettings(next);
  }

  async function doExport() {
    const bundle = await exportAll();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stanki-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text()) as ExportBundle;
      await importBundle(bundle);
      alert('Import complete.');
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="settings">
      <section className="panel">
        <h2>Google Drive sync</h2>
        {!configured ? (
          <p className="muted">
            Sync is not configured. Set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>.env</code> and rebuild.
            The app works fully offline without it; use Export/Import below to move decks between devices.
          </p>
        ) : connected ? (
          <>
            <p>Connected. Last sync: <strong>{fmtTime(lastSync)}</strong></p>
            {syncError && <p className="error">⚠ {syncError}</p>}
            <div className="row">
              <button className="btn btn-primary" disabled={syncStatus === 'syncing'} onClick={() => void syncNow()}>
                {syncStatus === 'syncing' ? 'Syncing…' : 'Sync now'}
              </button>
              <button className="btn" onClick={disconnect}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Connect your Google account to sync decks across devices via your own Drive.</p>
            {syncError && <p className="error">⚠ {syncError}</p>}
            <button className="btn btn-primary" onClick={() => void connect()}>Connect Google Drive</button>
          </>
        )}
      </section>

      {configured && connected && (
        <section className="panel">
          <h2>Backups</h2>
          <p className="muted small">
            Automatic snapshots in your Drive (the 5 most recent, written when your data changes).
            Restoring overwrites current cards with the chosen snapshot.
          </p>
          {!backups ? (
            <button className="btn" onClick={() => void loadBackups()} disabled={backupBusy}>
              {backupBusy ? 'Loading…' : 'Show backups'}
            </button>
          ) : backups.length === 0 ? (
            <p className="muted">No backups yet — they're written on sync once you have cards.</p>
          ) : (
            <ul className="backup-list">
              {backups.map((b) => (
                <li key={b.id} className="backup-item">
                  <span>{new Date(b.at).toLocaleString()} · {b.cards} cards</span>
                  <button className="btn" onClick={() => void restore(b)} disabled={backupBusy}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Scheduling</h2>
        <label className="field">
          <span>Starting ease ({s.startingEase.toFixed(2)})</span>
          <input type="range" min={1.3} max={3.5} step={0.1} value={s.startingEase}
            onChange={(e) => update('startingEase', Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Easy bonus ({s.easyBonus.toFixed(2)}×)</span>
          <input type="range" min={1} max={2} step={0.05} value={s.easyBonus}
            onChange={(e) => update('easyBonus', Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Easy first interval (days)</span>
          <input type="number" className="input" min={1} max={365} value={s.easyFirstInterval}
            onChange={(e) => update('easyFirstInterval', Math.max(1, Math.round(Number(e.target.value))))} />
        </label>
        <label className="field">
          <span>Again interval (minutes)</span>
          <input type="number" className="input" min={1} max={1440} value={s.againInterval}
            onChange={(e) => update('againInterval', Math.max(1, Math.round(Number(e.target.value))))} />
        </label>
      </section>

      <section className="panel">
        <h2>Daily limits</h2>
        <p className="muted small">Per deck. New cards are introduced up to the limit; reviews are capped separately.</p>
        <label className="field">
          <span>New cards / day</span>
          <input type="number" className="input" min={0} max={500} value={s.newCardsPerDay}
            onChange={(e) => update('newCardsPerDay', Math.max(0, Math.round(Number(e.target.value))))} />
        </label>
        <label className="field">
          <span>Max reviews / day</span>
          <input type="number" className="input" min={0} max={9999} value={s.maxReviewsPerDay}
            onChange={(e) => update('maxReviewsPerDay', Math.max(0, Math.round(Number(e.target.value))))} />
        </label>
      </section>

      <section className="panel">
        <h2>Backup</h2>
        <p className="muted">Offline portability and backup, independent of Drive.</p>
        <div className="row">
          <button className="btn" onClick={() => void doExport()}>Export JSON</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => void doImport(e)} />
        </div>
      </section>
    </div>
  );
}
