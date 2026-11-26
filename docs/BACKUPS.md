# Database backups

Every Sunday at 03:00 Manila, the **Database backup** workflow (`.github/workflows/backup.yml`) does the following:
1. Dumps the `bdgtr` database with `mongodump`, logged in as a **read-only** Atlas user.
2. Encrypts the dump with the owner's [age](https://age-encryption.org) **public** key.
3. Uploads it as a workflow artifact, kept for 90 days.

The repo is public, so anyone signed in to GitHub can download the artifact. It's useless to them without the **private** key, which never leaves the owner's computer. You can also run the workflow by hand: Actions → Database backup → Run workflow.

## One-time setup

1. **Make a key pair** on your computer. Install `age` first (`sudo apt install age` on Ubuntu/WSL, or `winget install FiloSottile.age` on Windows):
   ```sh
   age-keygen -o ~/bdgtr-backup.key
   ```
   It prints `Public key: age1…`. Keep `~/bdgtr-backup.key` safe, for example in a password manager, and **never commit it**. Without it the backups can't be opened.
2. **Put the public key in the repo:** its `age1…` line goes in `.github/backup-age-recipient.txt`.
3. **Read-only Atlas user:** Atlas → Database Access → Add New Database User.
   - Use password authentication, user `bdgtr-backup`, and a long random password.
   - Under "Built-in Role", choose **Only read any database**, or a specific privilege `read` on `bdgtr`.
4. **GitHub secret:** run this in the repo folder:
   ```sh
   gh secret set BACKUP_MONGODB_URI
   ```
   Then paste that user's connection string, `mongodb+srv://bdgtr-backup:<password>@<cluster>/`. It's never shown in logs.

## Restoring

1. Download the artifact (Actions → a Database backup run → Artifacts) and unzip it.
2. Decrypt it:
   ```sh
   age -d -i ~/bdgtr-backup.key -o bdgtr.archive.gz bdgtr-YYYY-MM-DD.archive.gz.age
   ```
3. Restore into a **separate** database first, to check it (this needs a user with write access):
   ```sh
   mongorestore --uri "<uri>" --gzip --archive=bdgtr.archive.gz --nsFrom 'bdgtr.*' --nsTo 'bdgtr_restore.*'
   ```
   Only restore over `bdgtr` itself (`--drop`) when you really mean to replace the live data.
