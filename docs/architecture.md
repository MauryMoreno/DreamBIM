# Dream BIM architecture

Dream BIM (`studio/`) is a Tauri 2 application: a Rust backend that touches the disk and the Assistant process, and a
TypeScript frontend (Vite, three.js) that does everything else. This guide describes how the code is organized, the
rules that keep it that way and the patterns it uses.

## Layers

`studio/src/` has one rule: a layer only imports from the layers below it. `test/architecture.test.ts` enforces it.

| Layer | Folders | Imports |
|---|---|---|
| Startup | `main.ts`, `app/` | everything |
| Features | `workspace/`, `document/`, `modeling/`, `composer/`, `materials/`, `costs/`, `schedule/`, `classification/`, `properties/`, `browser/`, `collection/`, `library/`, `home/`, `assistant/`, `ribbon/`, `modes/`, `model/`, `help/`, `docs/` | other features, `shell/`, `render/`, `ifcx/` |
| Shell | `shell/` | `render/`, `ifcx/` |
| 3D engine | `render/` | `ifcx/`, three.js |
| IFCx core | `ifcx/` | nothing |

Two folders sit beside the layers: `platform/` (file access, build mode, downloads; it only imports itself and
packages) and `modeling/` (the pure model domain: no DOM, no three.js, no workspace or render).

Other enforced conventions (`test/conventions.test.ts`):

- No `.ts` file under `src/` and no `.rs` file under `src-tauri/src/` is over 400 lines.
- Comments and test titles are English.
- Knip reports no unused file, dependency or export (`npm run knip`).

## How the big pieces are split

The three classes and the dozen long functions that used to be single files follow the same shape: a small public
entry point (a facade) over focused modules that share an explicit context object.

### The open document: `src/document/`

`DocumentController` is the facade the rest of the app uses; its public API did not change when it was split.

| Piece | File | Role |
|---|---|---|
| `DocumentState` | `state.ts` | every field the open document keeps, in one place |
| `DocumentContext` | `context.ts` | state + injected dependencies + the other services; `createDocumentContext(deps)` builds it |
| `HistoryService` | `history.ts` | snapshots, undo and redo (Memento) |
| `OperationQueue` | `queue.ts` | one queue for edits and saves, so they never interleave |
| `EditLock` | `lock.ts` | the user lock while the Assistant works, and the agent pass-through |
| `LifecycleService`, `SaveService` | `lifecycle.ts`, `save.ts` | open, new, close, Save and Save As |
| `StackService`, `LinksService`, `PlacementService`, `TransformService`, `LinkedPropsService`, `PayloadsService` | `stack.ts`, `links.ts`, `placement.ts`, `transform.ts`, `linked-props.ts`, `payloads.ts` | the composer stack: linked files, placing, moving, properties of linked elements |
| `MaterialsService`, `ClassificationService`, `LibraryFilesService`, `SidecarsService` | `materials.ts`, `classification.ts`, `library-files.ts`, `sidecars.ts` | data that lives in its own IFCx file |
| `MutationsService`, `ElementsService`, `ReviewService` | `mutations.ts`, `elements.ts`, `review.ts` | Studio edits and the plan review |
| `move-target.ts`, `types.ts` | | pure helpers and the public types |

A service takes the context in its constructor and reaches the others through it (`this.ctx.stack.stackChange(...)`).
Outside `document/`, only `controller.ts`, `types.ts` and `move-target.ts` may be imported.

### The workspace: `src/workspace/`

`mountWorkspace` is a wiring function (about 250 lines). It builds a `WorkspaceContext` (layout, state, viewer,
options, ribbon, status bar, a `Disposables` collector) and mounts one controller per concern: layout, pane layout and
focus mode, selection, views, view bar, panels, drop, wall tool, floor sketch, view actions, keyboard, assistant pane,
modes host and model binding. `WorkspaceState` notifies listeners when the model, the selection, editing or the dirty
flag change. Every global listener is registered through the context, so `dispose()` removes them all.

### The viewer: `src/render/viewer/`

`Viewer` is a facade over subsystems that share a `ViewerCore` (scene, camera, renderer, controls): model, appearance,
visibility, camera, section, level of detail, sun, thumbnails, quantities, explode, grid, interaction and the render
loop. The private fields three.js does not expose (`BatchedMesh` internals) are isolated behind one typed wrapper.

### Long functions as install functions

Functions that built a large closure (the egress review, the Gantt, the schedule mode, the Stage panel, the document
picker, the Studio executor, the web bridge, the Collection screen) were split into a folder of `install<Name>(ctx)`
functions. Each one runs in order over one shared context object, and the original function is a short sequence of
those calls. Values that only one part uses stay local to that part. The folder also holds `context.ts` (the shape of
the shared object), `types.ts` and `helpers.ts`. The same layout is used for `modeling/document/`, `ifcx/compose/`
and `session/placements.ts`: the original path keeps re-exporting the public names, so importers did not change.

## Patterns, and where they are used

- **Facade:** `DocumentController`, `mountWorkspace`, `Viewer`, and the entry point of every split folder.
- **Memento:** `HistoryService` keeps snapshots of the editable state and restores them.
- **Command table:** the Studio executor registers its commands in themed arrays and merges them; the workspace maps
  every `ViewAction` to a handler (`view-actions.ts`).
- **Ports and adapters:** `platform/files.ts` defines the `Files` interface; `desktop-files.ts` (Tauri) and
  `web-files.ts` (memory + network) implement it. Features receive disk access injected from `app/`, so tests run
  without Tauri.
- **Strategy:** `LibKind` describes each IFCx file a model imports (schedule, budget, colors) and the shared code
  reads and writes them through it.
- **Observer:** `WorkspaceState.on(...)` and the `Disposables` collector.

## The Rust backend: `studio/src-tauri/src/`

| Module | Role |
|---|---|
| `lib.rs` | `run()`: plugins, state, the handler list |
| `fs/` | `atomic` (unique temp file, `sync_all`, rename), `blocking` (disk work off the async runtime), `entries`, `extensions`, `scope` |
| `commands/` | `files`, `documents`, `library`, `pickers`: the commands the frontend calls |
| `assistant/` | the supervisor of the Python agent: `bridge`, `commands`, `layout`, `watchdog` |

Security model:

- **Path scope.** Disk commands only reach folders the user picked. The dialogs are Rust commands (`pick_open_file`,
  `pick_save_path`, `pick_folder`), and what they return is granted (a folder, or the folder of a file) and persisted
  in `scope.json`. `..` is always refused and symlinks are resolved. The recents of the previous version are granted
  on the first run. `DREAM_BIM_UNRESTRICTED_FS=1` turns the scope off.
- **Content Security Policy** in `tauri.conf.json` (`csp`, `devCsp`) and, for the web demo, in two CloudFront
  response-headers policies (`deploy/web-demo.yaml`).
- **`open_document`** opens only an allowlist of document, drawing, image and archive extensions.
- **The Assistant bridge** ends a turn that goes silent for 120 s (so the edit lock is never left on), rotates its
  log and is killed when the app exits.

## Persisted names that stay Spanish

Old files must keep opening, so these keep their Spanish names: IFCx attribute keys (`prj::medicion`, `prj::precio`,
`prj::origen`, `prj::referencia`, `prj::costos::sistema`, `prj::cronograma::*`), file suffixes (`.cronograma.ifcx`,
`.costos-asignacion.ifcx`), the property names inside those attributes (`documento`, `celda`), the `localStorage` keys
and the ribbon tab id `arquitectura`.

## How to add...

- **A mode:** define it in `modes/definition.ts`, create its controller in `<mode>/mode.ts`, and mount it from
  `workspace/modes-host.ts`; give it ribbon buttons in the definition and actions in `view-actions.ts`.
- **A document operation:** add a method to the service that owns the data (`document/<service>.ts`), run it through
  `ctx.mutations.edit`/`editChecked` or `ctx.stack.stackChange` so it joins the history, and add the one-line
  delegation to `DocumentController`.
- **A viewer feature:** add a subsystem in `render/viewer/` that takes `ViewerCore`, create it in `viewer.ts`, and
  delegate the public methods.
- **A Tauri command:** write the blocking function and its tests in `commands/<module>.rs`, wrap it in an `async`
  command that calls `scope.check(...)` and `blocking::run(...)`, and register it in `lib.rs`. Add its frontend call to
  the `Files` adapter and its test.
- **A file the model imports:** describe it with a `LibKind` and give it a slot in `library-files.ts`.
