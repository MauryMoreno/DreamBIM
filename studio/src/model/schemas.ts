// Standard IFCx schemas packaged in the application (it works offline).
// Se descargan con `node scripts/fetch-schemas.mjs`.
import { files } from '../platform/files';
import { fetchIfcx, parseIfcx, type Fetcher, type Locator } from '../ifcx/layers';
import { resolveUri } from '../composer/uri';
import ifc from './schemas/ifc@v5a.ifcx?raw';
import prop from './schemas/prop@v5a.ifcx?raw';
import usd from './schemas/usd@v1.ifcx?raw';

export const BUNDLED_SCHEMAS: Record<string, string> = {
  'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx': ifc,
  'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx': prop,
  'https://ifcx.dev/@openusd.org/usd@v1.ifcx': usd,
};

const REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Resolves the standard schemas locally; the remote URIs go to the network and the paths are read from the
 * disco.
 */
export const offlineFetcher: Fetcher = async (uri) => {
  const text = BUNDLED_SCHEMAS[uri];
  if (text !== undefined) return parseIfcx(text);
  if (REMOTE.test(uri)) return fetchIfcx(uri);
  try {
    return parseIfcx(await files().readText(uri));
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
};

/** A relative import is resolved against the file that declares it; the remote and absolute ones, as they are. */
export const locateImport: Locator = (uri, from) => (from && !REMOTE.test(uri) ? resolveUri(from, uri) : uri);
