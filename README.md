# Our recipe & restaurant book

Shared recipe and restaurant app (Hebrew, mobile-first). Data is saved in a Google Sheet through a Google Apps Script web app; photos go to Google Drive.

## Fetch recipe from a link
The "✨ משיכת המתכון מהקישור" button asks the Apps Script (`fetchLink` action) to read the post's public page (Instagram embed page, or og: tags for Facebook and other sites), save the post image to Drive, and return the caption. The app then splits the caption into ingredients and instructions.

Setup: add `apps-script/fetch.gs` as a new file in the Apps Script project, add the `fetchLink` line to `doPost`, run `authorize`, then Deploy → Manage deployments → Edit → New version.

## Read recipe from screenshots
The "📷 קריאת המתכון מצילומי מסך" button (in the new-recipe box and in edit) lets you pick one or more screenshots/photos when there's no link or the link doesn't work. Each image is sent to the Apps Script (`ocrImage` action), which uses Google Drive's free text recognition (OCR, Hebrew) and returns the text. The app removes phone clutter (clock, "add a comment", dates), puts the ingredients screenshot before the instructions screenshot, joins wrapped lines, and splits it into ingredients / instructions / notes for review.

Setup: paste `apps-script/ocr.gs` as a new script file named "ocr" (it includes the full doPost with the `ocrImage` action, overriding the one in the main file because it loads last), run `testOcr`, then Deploy → Manage deployments → Edit → New version.
