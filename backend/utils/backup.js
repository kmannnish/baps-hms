/**
 * utils/backup.js — local PostgreSQL backup & restore for the Reception PC.
 *
 * ZERO-BUDGET, LAN-ONLY, STORAGE-BOUNDED by design (see CLAUDE.md constraints):
 *
 *   • Backups are plain pg_dump custom-format files on the PC's own disk, under
 *     BACKUP_DIR (a host-mounted ./backups folder in Docker — see docker-
 *     compose.yml). No cloud, no extra service, no running cost.
 *
 *   • We keep ONE FILE PER SLOT. 'daily', 'weekly' and 'monthly' are the three
 *     scheduled slots; each new backup of a cadence OVERWRITES that slot's file,
 *     so the previous backup is replaced automatically and storage can never
 *     grow past a handful of files — exactly the "till next backup the previous
 *     backup delete automatically so storage not run out" requirement. 'manual'
 *     is an on-demand slot (the "Back up now" button); 'prerestore' is an
 *     automatic safety copy taken immediately before any restore, so even a
 *     deliberate (or mistaken) restore is itself reversible.
 *
 * The overwrite is ATOMIC: we dump to a temp file and rename over the slot only
 * after the dump fully succeeds, so a crash mid-dump never corrupts the existing
 * good backup.
 *
 * pg_dump/pg_restore read the connection from the process env (PGHOST/PGPORT/
 * PGUSER/PGPASSWORD/PGDATABASE, or DATABASE_URL) — the same vars db.js uses — so
 * the password is passed through the child's env, never on the command line
 * (where it would show up in `ps`). The client binaries are installed in the
 * backend image (backend/Dockerfile); if they're ever missing, toolsAvailable()
 * reports it so the UI can show a clear message instead of a cryptic failure.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

// Every slot we recognise. Human-triggerable ones are in MANUAL_SLOTS; the
// scheduler only ever writes daily/weekly/monthly; 'prerestore' is written by
// restoreBackup() itself.
const SLOTS = ['daily', 'weekly', 'monthly', 'manual', 'prerestore'];
const MANUAL_SLOTS = ['manual', 'daily', 'weekly', 'monthly'];

const SLOT_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  manual: 'Manual',
  prerestore: 'Safety copy (before last restore)',
};

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function isValidSlot(slot) {
  return SLOTS.includes(slot);
}

function slotFile(slot) {
  return path.join(BACKUP_DIR, `baps_hms_${slot}.dump`);
}

// dbname argument for pg_dump/pg_restore: a full connection string when
// DATABASE_URL is set (managed/cloud), else the discrete PGDATABASE (local
// Docker). The PG* vars + PGPASSWORD flow to the child through its inherited
// env, so no secret ever appears in argv.
function dbArg() {
  return process.env.DATABASE_URL || process.env.PGDATABASE || 'baps_hms';
}

// Spawn a pg_* binary; resolve with trimmed stderr on exit 0, reject with the
// captured stderr otherwise. ENOENT (binary not installed) is reported as a
// clear, actionable error.
function runPg(bin, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { env: { ...process.env } });
    } catch (err) {
      return reject(new Error(`${bin} could not be started: ${err.message}`));
    }
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000); // bound memory
    });
    child.on('error', (err) => {
      reject(
        err.code === 'ENOENT'
          ? new Error(`${bin} is not installed (PostgreSQL client tools missing on the server)`)
          : err
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stderr.trim());
      else reject(new Error(`${bin} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

// Are pg_dump/pg_restore present? Probed cheaply via --version. Never throws.
async function toolsAvailable() {
  try {
    await runPg('pg_dump', ['--version']);
    return true;
  } catch {
    return false;
  }
}

function statOf(slot) {
  const file = slotFile(slot);
  const base = { slot, label: SLOT_LABELS[slot] || slot, file };
  try {
    const st = fs.statSync(file);
    return { ...base, exists: true, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
  } catch {
    return { ...base, exists: false, sizeBytes: 0, modifiedAt: null };
  }
}

// All slots, in a stable display order. Missing ones come back exists:false so
// the UI can show "— not yet created".
function listBackups() {
  ensureDir();
  return SLOTS.map(statOf);
}

/**
 * Create (or overwrite) a slot's backup, atomically. Dumps to a temp file and
 * renames over the slot only on success, so the previous good backup survives a
 * failed/interrupted dump. Returns statOf(slot). Throws on failure.
 */
async function createBackup(slot) {
  if (!isValidSlot(slot)) throw new Error(`Unknown backup slot: ${slot}`);
  ensureDir();
  const finalPath = slotFile(slot);
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    await runPg('pg_dump', ['-Fc', '--no-owner', '--no-privileges', '-f', tmpPath, '-d', dbArg()]);
    fs.renameSync(tmpPath, finalPath); // atomic replace on the same filesystem
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* nothing to clean up */
    }
    throw err;
  }
  return statOf(slot);
}

/**
 * Restore the DB from a slot. DESTRUCTIVE — pg_restore --clean --if-exists drops
 * and recreates every object, inside --single-transaction so a failure rolls the
 * whole thing back (never a half-restored DB). A 'prerestore' safety backup of
 * the CURRENT data is taken first; if that fails we abort rather than restore
 * with no way back. Returns { restoredFrom, prerestore }. Throws on failure.
 *
 * Run this when no one is actively checking guests in/out: --clean needs an
 * exclusive lock on each table, which a concurrent transaction would block.
 */
async function restoreBackup(slot) {
  if (!isValidSlot(slot)) throw new Error(`Unknown backup slot: ${slot}`);
  const src = slotFile(slot);
  if (!fs.existsSync(src)) throw new Error(`No ${slot} backup exists to restore from`);

  // Taking the pre-restore safety copy below writes baps_hms_prerestore.dump.
  // If the slot being restored IS 'prerestore' (the "undo the last restore"
  // action), that write would clobber our own restore source before pg_restore
  // reads it — turning the undo into a no-op. So copy the source aside first and
  // restore from the copy. Normal slots don't alias, so they skip this.
  let restoreSrc = src;
  let tmpCopy = null;
  if (slot === 'prerestore') {
    tmpCopy = `${src}.restoring.${process.pid}.${Date.now()}`;
    fs.copyFileSync(src, tmpCopy);
    restoreSrc = tmpCopy;
  }

  let prerestore = null;
  try {
    prerestore = await createBackup('prerestore');
  } catch (err) {
    if (tmpCopy) {
      try { fs.unlinkSync(tmpCopy); } catch { /* ignore */ }
    }
    throw new Error(`Safety backup before restore failed, restore aborted: ${err.message}`);
  }

  try {
    await runPg('pg_restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '-d',
      dbArg(),
      restoreSrc,
    ]);
  } finally {
    if (tmpCopy) {
      try { fs.unlinkSync(tmpCopy); } catch { /* ignore */ }
    }
  }

  return { restoredFrom: slot, prerestore };
}

module.exports = {
  BACKUP_DIR,
  SLOTS,
  MANUAL_SLOTS,
  SLOT_LABELS,
  isValidSlot,
  slotFile,
  statOf,
  listBackups,
  createBackup,
  restoreBackup,
  toolsAvailable,
};
