# Antigravity Rules for OBD App

## Always Backup Before Destructive Operations
Before executing any commands or editing files that perform destructive actions, truncate, or overwrite database files (e.g. JSON, SQL, DB files), configuration files, or user data repositories, the agent **MUST** first create a backup copy (e.g., appending `.bak` or `.tmp` to the file name, or creating a zip/tar archive).
