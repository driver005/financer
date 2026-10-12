# Encrypted backup and app lock

## Encrypted backup

In on-phone (embedded) mode the SQLite database exists only on the phone, so losing the phone
loses the data. **Settings -> Backup** writes everything the JSON export holds (transactions,
budget, usual items, receipts, non-secret settings; never PINs, tokens, API keys or prices) into
one passphrase-encrypted file.

- **Format.** An [age](https://age-encryption.org) file with a scrypt passphrase recipient
  (ChaCha20-Poly1305, work factor 2^17), from the pure-Rust `age` crate (no system libraries, so it
  cross-compiles to Android and iOS). It also opens with the standard tool: `age -d backup.age`.
  When opening a file, a work factor above 2^20 is refused so a hostile file cannot exhaust memory.
- **API.** `POST /v1/backup/create` `{passphrase}` returns `{data_base64, transactions, receipts}`;
  `POST /v1/backup/restore` `{passphrase, data_base64}` merges the data exactly like `/v1/import`
  (duplicates skipped, so restoring twice changes nothing) and returns the same report. The app
  transport carries only text, hence base64 inside JSON. The passphrase must have at least 8
  characters, is never stored or logged, and is not part of any response or error. A wrong
  passphrase and a damaged or truncated file give the same 400 and change nothing.
- **Manual backup.** Type a passphrase twice, "Create and share": the file is kept in the app's
  `backups/` folder (and in the chosen folder, see below) and the share sheet opens so it can go to
  cloud storage, mail or another device. In the browser it is downloaded.
- **Restore.** Type the passphrase, "Restore", pick the file.
- **Automatic backups (phone only, opt in).** Choose Daily or Weekly. When the app opens (and when
  it returns to the front) and the newest automatic backup is older than that interval, a new one
  is written to the app's backup folder and only the last 3 are kept. To do this unattended the
  app must remember the passphrase, which you can save with "Remember passphrase on this phone";
  it goes to the Keychain / Keystore (`expo-secure-store`) and nowhere else, and "Forget the saved
  passphrase" removes it and switches automatic backups off. The decision "is a backup due" lives
  in `apps/mobile/src/backupPlan.ts` (unit tested).
- **Folder.** `expo-file-system` in this SDK offers a directory picker (`Directory.pickDirectoryAsync`).
  If you pick a folder, every backup is also written there; if that fails the app says so and the
  copy in the app folder is still made.

### Limits, honestly

- **A file inside the app's own folder does not protect against losing the phone**, resetting it or
  uninstalling the app: the OS deletes it with the app. The share sheet or a cloud-synced folder is
  what makes a backup survive. Automatic backups only write into the app folder (plus the picked
  folder, if any), so they help against a corrupted database, not against a lost phone, unless the
  picked folder is synced.
- **Without the passphrase the backup is unreadable and nobody can recover it.** A saved
  passphrase on the phone is lost with the phone too, so remember it elsewhere.
- Automatic backups run only while the app is open (iOS does not let apps run on a schedule).
- Size: the request body limit is 10 MB, so the encrypted backup can be about 7 MB (hundreds of
  thousands of transactions are not a concern; thousands of receipt photos would be, but photos are
  not stored).
- scrypt at 2^17 uses about 128 MiB of memory for a moment; very old phones may be slow.
- **Not verified on a device:** the share sheet, the file and folder pickers, writing to a picked
  folder (Android and iOS differ in how long they allow access to it), SecureStore and the
  on-phone backend's scrypt speed. The Rust side and the pure logic are tested; see below.

### Tests

`cargo test -p financer-api` (round trip, wrong passphrase, flipped bytes, truncation, oversize,
HTTP endpoints, redacted `Debug`), `npm test` in `apps/mobile` (due-logic, file naming and
retention, settings parsing, client calls).

## App lock

**Settings -> Lock the app** asks for fingerprint / face (`expo-local-authentication`), falling back to
the device passcode, when the app starts and when you come back after more than 60 seconds in the
background. The rules (`apps/mobile/src/appLock.ts`, unit tested) are: locked at start when on;
the time away is measured from the `background` AppState (not `inactive`, which the iOS Face ID
prompt itself causes); a clock that moved backwards counts as long.

- Turning the lock on or off asks the phone to confirm first, so a broken setup cannot lock you
  out and someone holding the unlocked app cannot just remove the lock.
- It is hidden in the browser. If the phone has no screen lock or biometric enrolled, the setting
  is disabled and says what to set up. If the screen lock is removed later, the app lock switches
  itself off at the next start or unlock attempt (otherwise nobody could ever open the app).
- The lock is a cover on top of the screens; screens keep their state.

### Limits

- It protects against **someone else opening the app on your unlocked phone**. It does **not**
  encrypt the database or protect against data extraction from a rooted or jailbroken phone, a
  forensic copy of the app's files, or a backup of the phone. For that, rely on the phone's own
  full-disk encryption and a strong device passcode.
- The task-switcher preview is not blurred.
- **Not verified on a device:** the biometric / passcode prompt, `AppState` timing on Android and
  iOS, and the cover's layout on real hardware. Only the decision logic is tested.
