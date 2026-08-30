Drop a custom thumbnail image here named `<project-slug>.jpg` (e.g. `goska.jpg`) to
override the auto-generated Google Drive thumbnail for that project. Project slugs
are the `slug` field in `src/lib/data.ts`, and match the URL: `/work/<slug>`.

If no file matches a project's slug, the site falls back to Drive's own thumbnail,
then to a generic icon.
