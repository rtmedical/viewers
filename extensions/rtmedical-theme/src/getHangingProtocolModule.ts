import { rtRadiologyProtocols } from './hangingProtocols/rtRadiologyProtocols';
import { rtRadiotherapyProtocols } from './hangingProtocols/rtRadiotherapyProtocols';
import { rtHangingProtocolLibrary } from './hangingProtocols/library';
import { rtComparisonProtocols } from './hangingProtocols/rtComparisonProtocol';
import { rtSpecialtyProtocols } from './hangingProtocols/rtSpecialtyProtocols';

/**
 * Registers RT Medical hanging protocols with the HangingProtocolService:
 * RTV-119 radiology defaults, RTV-127 radiotherapy 4-up MPR, the RTV-25
 * ≥30-protocol modality library, and the RTV-22 current/prior comparison.
 * Each entry's `name` is the protocol id.
 */
function getHangingProtocolModule() {
  return [
    ...rtRadiologyProtocols,
    ...rtRadiotherapyProtocols,
    ...rtHangingProtocolLibrary,
    ...rtComparisonProtocols,
    ...rtSpecialtyProtocols,
  ].map(protocol => ({
    name: protocol.id,
    protocol,
  }));
}

export default getHangingProtocolModule;
