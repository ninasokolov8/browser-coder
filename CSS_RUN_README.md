# CSS Run behavior

CSS is not sent to `/api/run`.

When Run is pressed on a CSS file:
- If exactly one HTML file links that stylesheet, that HTML page is published and opened.
- If no HTML file links it, the IDE explains that CSS cannot run independently.
- If multiple HTML files link it, the IDE lists them and asks the user to run the intended page.

CSS imports are supported by the live preview:
- `<link rel="stylesheet" href="...">`
- `@import "...";`
- `@import url("...");`
- local `url(...)` assets
