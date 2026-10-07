# Importing rulebooks

Rule libraries are shared by campaigns. Create or open a system in **Rules**, supply its GM instructions and import book packages. A campaign can instead use the instructions-only **Model knowledge** default without importing books.

The rulebook package importer expects a `rules-book` manifest and annotated Markdown column files. A manifest that carries `version` was prepared by an older app and is rejected; regenerate it with `npm run rules:manifest`. A regular campaign document upload is a different workflow; an arbitrary Markdown file is not automatically a structured rulebook package.

## Prepare a manifest

Keep original books and extracted text outside the repository. From the repository root, run:

```powershell
npm.cmd run rules:manifest -- --columns 'C:\PRIVATE_BOOKS\book-columns' --title 'Book title' --page-count 100 --out 'C:\PRIVATE_BOOKS\book-manifest.json'
```

Replace the paths and page count with your own. The column directory must contain recognized column filenames and valid source/node annotations. The tool reads the original files, hashes their bytes and validates the package before writing a manifest. It refuses to overwrite an existing output or write inside the original column directory. Without `--out`, it prints the manifest to stdout.

Optional metadata arguments are `--converter-id`, `--converter-version`, `--pdf-hash` and repeatable `--omission` entries. Supply a PDF SHA-256 only when independently known; otherwise the manifest records it as unknown. Package validation does not certify extraction or OCR completeness.

Select the generated manifest and its unchanged column files together in the Rules import dialog. Inspect the import preview and publish the library change through the interface. Each new campaign action uses the current published system; an action already running uses the snapshot it started with.

## After importing: choose a sheet layout

Character sheets are free-form, so a new rule system draws them with the plain base layer. To get dots, tracks or percentiles that match the book, have an agent read [sheet layouts](sheet-layouts.md), inspect a sample character and save a layout for the system. The layout is display-only and never changes rule content, revisions or what the GM sees.

## Source text and citations

Generator annotations, navigation headings and node markers describe the extraction structure. They are not original rule prose. Body text is normalized to LF, and citation offsets address the resulting canonical UTF-16 string. Structural parent nodes with no substantive body cannot support citations. Unknown page ranges can remain unknown rather than being invented.

When changing an extraction pipeline, preserve this contract and validate its output against the importer. The [backend architecture](rpg-backend-architecture.md) describes import staging, lookup tools and citation validation. The implementation lives in [ruleImport.ts](../../rpg_be_local/src/domain/ruleImport.ts).

Campaign exports reference the required rule library by default. Use the separate full-library backup for a self-contained copy of your private books. Do not publish those backups with the code; imported materials retain their own rights.
