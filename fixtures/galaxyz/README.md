# GALAXYZ fixtures (ogamex.eu/Aeternum, engine "GALAXYZ 1.8.git")

Served by `tests/gz-server.js` (mock) for `tests/gz-lib.js` / `tests/gz-*.test.js`.

| Folder | Source | Tag |
|---|---|---|
| `pages/*.html` | REAL pages saved from the live server with Chrome "Save page as" (copy of `scratchpad/eu/pages`, unchanged; see `pages/README.txt`). File name = `?page=[-mode]`. | REAL |
| `assets/*` | REAL JS/CSS/images of the overview page (`scratchpad/eu/overview/*_files`). The pages reference them as `./<n>_files/<name>`; the mock looks them up by base name. | REAL |
| `upstream/js/*.js` | Scripts the fork loads but that were not captured (flotten, galaxy, message, officier, shipyard, fleettrader, bcmath), taken from upstream 2Moons `scripts/`. | UPSTREAM |
| `upstream/messages-view-cat*.html` | AJAX fragments of `page=messages&mode=view&messcat=N` for categories without a real capture (copies of `specs/galaxyz/fixtures/messages-upstream-view-*`). Categories 0 and 100 are cut from the real pages. | UPSTREAM |

Not captured (the mock answers with upstream-shaped data, tagged in `tests/gz-server.js`): details AJAX panels, fleetAjax, info pages (printMessage), combat reports. `OGX_GZ_PAGES=/path` points the mock at another folder of saved pages.
