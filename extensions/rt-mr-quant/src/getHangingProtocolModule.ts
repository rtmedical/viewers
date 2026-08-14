import { dixonProtocols } from './hangingProtocols/dixonProtocol';

/**
 * Registers the MR-quantitative hanging protocols with the HangingProtocolService.
 * Each entry's `name` is the protocol id, matching the convention in
 * `extensions/rtmedical-theme/src/getHangingProtocolModule.ts`.
 *
 * Currently the Dixon 2x2 layout (RTV-83).
 */
function getHangingProtocolModule() {
  return dixonProtocols.map(protocol => ({
    name: protocol.id,
    protocol,
  }));
}

export default getHangingProtocolModule;
