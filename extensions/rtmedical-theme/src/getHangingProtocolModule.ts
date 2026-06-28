import { rtRadiologyProtocols } from './hangingProtocols/rtRadiologyProtocols';
import { rtRadiotherapyProtocols } from './hangingProtocols/rtRadiotherapyProtocols';
import { rtHangingProtocolLibrary } from './hangingProtocols/library';

/**
 * Registers RT Medical hanging protocols with the HangingProtocolService:
 * RTV-119 radiology defaults, RTV-127 radiotherapy 4-up MPR, and the RTV-25
 * ≥30-protocol modality library. Each entry's `name` is the protocol id.
 */
function getHangingProtocolModule() {
  return [
    ...rtRadiologyProtocols,
    ...rtRadiotherapyProtocols,
    ...rtHangingProtocolLibrary,
  ].map(protocol => ({
    name: protocol.id,
    protocol,
  }));
}

export default getHangingProtocolModule;
