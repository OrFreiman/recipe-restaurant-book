# Our recipe & restaurant book

Shared recipe and restaurant app (Hebrew, mobile-first). Data is saved in a Google Sheet through a Google Apps Script web app; photos go to Google Drive.

## Fetch recipe from a link
The "✨ משיכת המתכון מהקישור" button asks the Apps Script (`fetchLink` action) to read the post's public page (Instagram embed page, or og: tags for Facebook and other sites), save the post image to Drive, and return the caption. The app then splits the caption into ingredients and instructions.

Setup: add `apps-script/fetch.gs` as a new file in the Apps Script project, add the `fetchLink` line to `doPost`, run `authorize`, then Deploy → Manage deployments → Edit → New version.
