# DreamBIM

Open-source tools for working with **IFCx (IFC5 alpha)**: **Dream BIM**, a desktop BIM application with the Revit layout, and an IFC→IFCx converter.

Dream BIM opens, composes, models, classifies, budgets and schedules IFCx models. It never rewrites the original model file: everything it adds goes into IFCx layers.

**Website:** <https://dreambim.maudigitalconstructor.com/>

## Contents

| Folder | Technology | What it is |
|---|---|---|
| [`studio/`](studio/) | Tauri 2 (Rust) + Vite + TypeScript | Dream BIM desktop application |
| [`converter/`](converter/) | Python 3.12 + IfcOpenShell | Converter from IFC2X3, IFC4 and IFC4X3 to `.ifcx` ([README](converter/README.md)) |
| [`docs/`](docs/) | Markdown | [Architecture guide](docs/architecture.md) |

## Dream BIM

- **Home:** recent models with a thumbnail; Open, New and Import IFC.
- **Workspace:** ribbon, Properties, Project Browser, 3D views, plan and elevations with ViewCube, Stage and Layer panels, Library and Assistant.
- **Collection:** the library of `.ifcx` cards with a 3D viewer and levels of detail.
- **Four modes** in the title bar (`Ctrl+1` to `Ctrl+4`, `Ctrl+Tab`):

| Mode | What it does | Where it saves |
|---|---|---|
| Model | Levels, walls and floors; links other `.ifcx` files and edits their elements without touching them | `model.ifcx` |
| Materials | Creates materials and assigns them to the selection or by rule | `model.materials.ifcx` |
| Costs | BOQ by rule and measure, price catalog, classification tables (such as OmniClass 21 and 22, imported from your own copy), exports CSV and XLSX | `model.costs.ifcx`, `model.classification.ifcx` |
| Schedule | Tasks with dependencies and calendar, Gantt, 4D with Play and S curve | `model.schedule.ifcx` |

When a model is opened, Dream BIM looks for its sibling files and stacks them on its own. To share a model, pass the files together.

The **Assistant** shows BuiltBot inside Dream BIM. The agent (`chatbot-revit/AI_Manage`) queries the model, selects, changes views and takes captures. BuiltBot lives in a separate repository that is not part of this project; without it, the rest of Dream BIM works and the Assistant stays unavailable.

## Requirements

- Node 22
- Rust 1.90 or higher
- Python 3.12 (only for the converter)
- Windows 10/11 with WebView2 (included in Windows 11)

## Usage

### Dream BIM

```sh
cd studio
npm install
npm run tauri dev       # opens the app in development mode
npm run tauri build     # builds the installer (unsigned)
```

The Assistant needs the `chatbot-revit` repository next to this one, or at the path in `IFCX_CHATBOT_DIR`. The CDE folder is taken from `IFCX_PROJECT_DIR`. To copy the BuiltBot build to `studio/public/builtbot/`:

```sh
npm run sync-builtbot
```

The disk commands of the desktop app only reach the folders the user picked (a folder, or the folder of a file). If a project keeps files in sibling folders that were never picked, pick the common folder in Docs or the Library, or set `DREAM_BIM_UNRESTRICTED_FS=1` to turn the restriction off.

### Converter

```sh
cd converter
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m ifc2ifcx model.ifc      # writes model.ifcx next to it
```

The options are in the [converter README](converter/README.md).

## Tests and checks

```sh
cd studio && npm run typecheck && npm test && npm run knip
cd studio/src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
cd converter && .venv/Scripts/python -m pytest tests
```

`npm test` does not check types. Also run `npm run typecheck`, because `npm run build` fails if `tsc` reports errors. CI runs all of the above plus `npm audit` and `cargo audit`.

## Architecture

`studio/src/` is organized in layers; each layer only imports from the ones below it, and the tests in `studio/test/architecture.test.ts` enforce it. Files stay under 400 lines and comments and test titles are in English (`studio/test/conventions.test.ts`). The full guide, with the structure of each folder and the patterns used, is in [docs/architecture.md](docs/architecture.md).

| Layer | Folder | What it contains | May import |
|---|---|---|---|
| Startup | `main.ts`, `app/` | Composition root: creates the pieces and connects them | Everything |
| Features | `workspace/`, `document/`, `modeling/`, `composer/`, `materials/`, `costs/`, `schedule/`, `classification/`, `properties/`, `browser/`, `collection/`, `library/`, `home/`, `assistant/`, `ribbon/`, `modes/`, `model/`, `help/`, `docs/` | One folder per feature, with its state, its panels and its disk access | Other features, `shell/`, `render/`, `ifcx/` |
| Shell | `shell/` | Screens, title bar, dialogs, toasts, theme, windows | `render/`, `ifcx/` |
| 3D engine | `render/` | three.js viewer: geometry, batches, selection, sections, styles | `ifcx/`, three.js |
| IFCx core | `ifcx/` | Types, reading and composition of layers, packed meshes, units, names | Nothing |

Disk and Tauri access lives in the `disk.ts` or `open.ts` of each feature, and in `platform/`. Features receive those commands injected from `app/`, so they are tested without Tauri.

`npm run bench -- model.ifcx` measures the load of a model with the 3D engine.

## How it works

An `.ifcx` is JSON with `header`, `imports`, `schemas` and `data`. Several files are stacked as layers and `compose()` merges them: the top layer wins attribute by attribute. Dream BIM uses this composition for everything:

1. The `ifc@v5a`, `prop@v5a` and `usd@v1` schemas, included in the app (it works offline).
2. Each linked file and, on top, the layer with its edits.
3. The Dream BIM document.
4. The overlays of the modes (materials and classification).

Costs and the schedule are not composed: they are read separately and point to the elements by their path.

## Language

The code, the comments, the documentation and the interface of Dream BIM are in English, using the terms of Revit. The IFCx attribute keys that older files already contain (for example `prj::medicion`, `prj::precio`) and the file suffixes (`.cronograma.ifcx`) keep their Spanish names so that existing files keep opening.

## Classification tables

Dream BIM does not ship classification tables. OmniClass® is a trademark of the Construction Specifications Institute (CSI) and its tables are published by CSI and CSC under their own terms; import them from your own copy (for example the `OmniClassTaxonomy.txt` that comes with Revit).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE) © 2026 MauryMoreno
