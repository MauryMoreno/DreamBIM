import { DocumentState } from './state';
import type { ControllerDeps } from './types';
import { HistoryService } from './history';
import { OperationQueue } from './queue';
import { EditLock } from './lock';
import { LifecycleService } from './lifecycle';
import { LibraryFilesService } from './library-files';
import { SidecarsService } from './sidecars';
import { MaterialsService } from './materials';
import { ClassificationService } from './classification';
import { SaveService } from './save';
import { StackService } from './stack';
import { LinksService } from './links';
import { PlacementService } from './placement';
import { TransformService } from './transform';
import { LinkedPropsService } from './linked-props';
import { PayloadsService } from './payloads';
import { MutationsService } from './mutations';
import { ElementsService } from './elements';
import { ReviewService } from './review';

/** What every service shares: the state, the injected dependencies and the other services. */
export interface DocumentContext {
  readonly state: DocumentState;
  readonly d: ControllerDeps;
  readonly history: HistoryService;
  readonly queue: OperationQueue;
  readonly lock: EditLock;
  readonly lifecycle: LifecycleService;
  readonly libraryFiles: LibraryFilesService;
  readonly sidecars: SidecarsService;
  readonly materials: MaterialsService;
  readonly classification: ClassificationService;
  readonly saver: SaveService;
  readonly stack: StackService;
  readonly links: LinksService;
  readonly placement: PlacementService;
  readonly transform: TransformService;
  readonly linkedProps: LinkedPropsService;
  readonly payloads: PayloadsService;
  readonly mutations: MutationsService;
  readonly elements: ElementsService;
  readonly review: ReviewService;
}

export function createDocumentContext(d: ControllerDeps): DocumentContext {
  const ctx = { state: new DocumentState(), d } as unknown as { -readonly [K in keyof DocumentContext]: DocumentContext[K] };
  ctx.history = new HistoryService(ctx);
  ctx.queue = new OperationQueue();
  ctx.lock = new EditLock(ctx);
  ctx.lifecycle = new LifecycleService(ctx);
  ctx.libraryFiles = new LibraryFilesService(ctx);
  ctx.sidecars = new SidecarsService(ctx);
  ctx.materials = new MaterialsService(ctx);
  ctx.classification = new ClassificationService(ctx);
  ctx.saver = new SaveService(ctx);
  ctx.stack = new StackService(ctx);
  ctx.links = new LinksService(ctx);
  ctx.placement = new PlacementService(ctx);
  ctx.transform = new TransformService(ctx);
  ctx.linkedProps = new LinkedPropsService(ctx);
  ctx.payloads = new PayloadsService(ctx);
  ctx.mutations = new MutationsService(ctx);
  ctx.elements = new ElementsService(ctx);
  ctx.review = new ReviewService(ctx);
  return ctx;
}
