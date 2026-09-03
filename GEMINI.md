# Antigravity Rules for OBD App

## Always Backup Before Destructive Operations
Before executing any commands or editing files that perform destructive actions, truncate, or overwrite database files (e.g. JSON, SQL, DB files), configuration files, or user data repositories, the agent **MUST** first create a backup copy (e.g., appending `.bak` or `.tmp` to the file name, or creating a zip/tar archive).

## UI and Card Design Guidelines
- **No Left-Side Lines on Cards**: Never add vertical left-side lines, accent stripes, or indicator borders (`border-left`, `borderLeft`, or left pseudoelement borders) to any cards in any dashboard, page, or UI design. All cards must use clean, uniform borders consistent with the design system.

