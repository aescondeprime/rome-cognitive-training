# ROME — Data Vault & Storage Guide

## Where your data lives

ROME stores all user data (profiles, training history, notes, memory, recall items) in a single SQLite database file named `rome.db`.

### Web / Development mode
```
./data.db
```
Located in the project root directory.

### Desktop app — Windows
```
C:\Users\<YourName>\AppData\Roaming\ROME\rome.db
```

### Desktop app — macOS
```
/Users/<YourName>/Library/Application Support/ROME/rome.db
```

## Update safety

Your database lives **outside** the app installation directory. This means:
- Reinstalling the app does **not** touch your database
- Updating to a new version does **not** delete your data
- Uninstalling the app does **not** auto-delete your database (it stays at the path above)

## Vault directory structure (future)

The intended future Obsidian-style vault structure:
```
ROME Vault/
├── .rome/
│   ├── rome.db          ← SQLite database (all data)
│   ├── config.json      ← App settings
│   └── profile.json     ← Active profile
├── backups/             ← JSON exports per profile
├── exports/             ← Manual exports
└── notes/               ← Future: markdown note files
```

## Backup / Export

From the Profile Manager page (`/profiles`), you can:
- **Export** any profile as a `.json` file (includes all training data, notes, memory, recall items)
- **Import** a previously exported profile JSON to restore it

## Manual backup

You can also manually copy `rome.db` to back it up:
```bash
# Windows
copy "%APPDATA%\ROME\rome.db" "%APPDATA%\ROME\rome.db.bak"

# macOS / Linux
cp ~/Library/Application\ Support/ROME/rome.db ~/Desktop/rome-backup.db
```

## Confirming data survives reinstall

1. Open ROME, create a profile, add training data
2. Note the profile name and session count
3. Reinstall or update the app
4. Reopen ROME — your profile and data should be intact
5. The database at the path above was never touched during reinstall
