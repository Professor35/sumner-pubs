# Sumner publications robot

Reads the free official books (NGA Sailing Directions, NOAA Coast Pilots) once and
publishes a small data file per book in `pubdata/`. The Sumner app fetches those files,
so users never download a PDF.

- `books.json` is the list of books and their download links.
- `read-books.mjs` does the reading. It takes its reading rules from the live app at sumnermarine.com.
- `.github/workflows/read-books.yml` runs it on GitHub: by hand from the Actions tab, and on the 3rd of each month.

Nothing here needs a password or key.
