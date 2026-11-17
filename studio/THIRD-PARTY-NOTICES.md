# Third-party notices

Dream BIM includes the following open-source software. All of it is free to use, including commercially; its
licence only asks that this notice be kept.

## PDF.js (`pdfjs-dist`)

Reads and draws PDF files (quotes and price lists) in the cost module.

- Copyright: Mozilla Foundation and contributors
- Licence: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- Source: https://github.com/mozilla/pdf.js

The full licence text ships with the package in `node_modules/pdfjs-dist/LICENSE`.

## Tesseract.js (`tesseract.js`, `tesseract.js-core`)

Reads the text of scanned PDFs and images (OCR) in the cost module. It runs inside the app; nothing is sent anywhere.

- Copyright: Jerome Wu, Guillermo Webster, Balearica and contributors; the Tesseract OCR engine by Google and
  contributors
- Licence: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- Source: https://github.com/naptha/tesseract.js, https://github.com/tesseract-ocr/tesseract

## Tesseract language data (`@tesseract.js-data/spa`, `@tesseract.js-data/eng`)

The Spanish and English models used by the OCR (`best_int`).

- Packaging: MIT licence — https://github.com/naptha/tessdata
- Models: Apache License 2.0, from https://github.com/tesseract-ocr/tessdata

## Descarga del add-in de Revit

El zip que ofrece la demo es un fork no oficial de Autodesk `revit-ifc` empaquetado con:

- **revit-ifc** — LGPL-3.0 — https://github.com/Autodesk/revit-ifc (el código fuente de cada versión se publica al lado, en el zip `-src.zip`)
- **IfcOpenShell** — LGPL-3.0-or-later — https://ifcopenshell.org
- **numpy** — BSD-3-Clause — https://numpy.org
- **Python** — PSF License — https://www.python.org

Las licencias completas van dentro del zip, en `LICENCIAS\`.
