# Google Drive Sync Setup

The trackers share JSON files through a folder synchronized by Google Drive for desktop. No Firebase project or OneDrive account is needed.

## Set Up Each Computer

1. Install Google Drive for desktop and sign in to the same Google account on every computer.
2. In Google Drive, create a folder such as `My Drive/QI SC372 Shared Data` and make sure it is available in File Explorer on each computer.
3. Open the hosted tracker in Chrome or Edge. On the first use of each app, choose **Connect Google Drive Folder** and select that same synced folder. Grant read/write access.
4. For Housekeeping, sign in to the tracker first, then connect the folder. Cash Inventory and Hours Tracking can connect directly.
5. Repeat for each app on each computer. The apps create separate files in the chosen folder:
   - `Housekeeping_Tracker_Shared.json`
   - `Cash_Inventory_Shared.json`
   - `Attendance_Tracker_Shared.json`

The first connection merges the browser's existing records into its shared file. Later connections use the shared file as the source of truth. Keep the tracker page open for updates to sync; it checks the file every few seconds. Google Drive may take additional time to upload/download changes. Avoid editing the same record on two devices simultaneously.

## Publishing

Publish `shared-json-sync.js`, `Housekeeping-Tracker.html`, `cash_inventory_website_updated.html`, `hours-tracking.html`, and `script.js` to the GitHub Pages repository. The folder picker requires a secure page origin (HTTPS) and a supported browser such as Chrome or Edge.
