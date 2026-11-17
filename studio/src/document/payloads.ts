import { resolveUri } from '../composer/uri';
import type { DocumentContext } from './context';

export class PayloadsService {
  constructor(private readonly ctx: DocumentContext) {}

  /** URIs of the loaded payloads. */
  get loadedPayloads(): string[] {
    return [...this.ctx.state.payloads.keys()];
  }

  /**
   * Loads or unloads a payload and recomposes. The uri is resolved next to the file that declares it
   * (`layerId`: a linked layer, or the document). false if it could not be read (warns).
   */
  setPayloadLoaded(uri: string, on: boolean, layerId: string): Promise<boolean> {
    if (!this.ctx.state.open) return Promise.resolve(false);
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    const gen = this.ctx.state.generation;
    return this.ctx.queue.enqueue(async () => {
      if (gen !== this.ctx.state.generation) return false;
      const docPath = this.ctx.stack.docPath();
      const l = this.ctx.stack.layer(layerId);
      // the payload is identified by the absolute location it resolves to, not by its declared uri
      const key = resolveUri(l ? resolveUri(docPath, l.uri) : docPath, uri);
      if (on === this.ctx.state.payloads.has(key)) return true;
      if (on) {
        const file = await this.ctx.links.readLinked(key, 'load');
        if (!file || gen !== this.ctx.state.generation) return false;
        this.ctx.state.payloads.set(key, file);
      } else {
        this.ctx.state.payloads.delete(key);
      }
      await this.ctx.stack.recompose();
      return true;
    });
  }
}
