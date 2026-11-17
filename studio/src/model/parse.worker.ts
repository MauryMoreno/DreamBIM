// Worker that parses the linked layers: JSON.parse of a layer of tens of MB no longer blocks the
// main thread. The meshes travel packed (typed arrays) and their buffers are TRANSFERRED, so
// returning the tree costs a fraction of structured cloning. It is only used with linked layers
// (el documento y la base de un IFCx ajeno se reescriben al guardar y se parsean en el hilo principal).
import { parseIfcx } from '../ifcx/layers';
import { packMeshes } from '../ifcx/packed';
import type { IfcxFile } from '../ifcx/types';

export interface ParseRequest { id: number; text: string }
export type ParseReply = { id: number; file: IfcxFile } | { id: number; error: string };

/** Manejador puro: el mismo texto de error que `parseLayer` ('Not a valid IFCX file: …'). */
export function handleParse(msg: ParseRequest): { reply: ParseReply; transfer: ArrayBuffer[] } {
  try {
    const file = parseIfcx(msg.text);
    return { reply: { id: msg.id, file }, transfer: packMeshes(file) };
  } catch (e) {
    return { reply: { id: msg.id, error: 'Not a valid IFCX file: ' + (e instanceof Error ? e.message : String(e)) }, transfer: [] };
  }
}

// Only inside a worker: on the main thread (and in the tests) importing this module registers nothing.
declare const WorkerGlobalScope: unknown;
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof (WorkerGlobalScope as typeof Object)) {
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent<ParseRequest>) => void) | null;
    postMessage(m: unknown, transfer: Transferable[]): void;
  };
  scope.onmessage = (e) => {
    const { reply, transfer } = handleParse(e.data);
    scope.postMessage(reply, transfer);
  };
}
