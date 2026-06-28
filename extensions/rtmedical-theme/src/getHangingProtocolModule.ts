import { rtRadiologyProtocols } from './hangingProtocols/rtRadiologyProtocols';
import { rtRadiotherapyProtocols } from './hangingProtocols/rtRadiotherapyProtocols';

/**
 * Registers RT Medical hanging protocols (RTV-119 radiology + RTV-127
 * radiotherapy 4-up MPR) with the HangingProtocolService. Each entry's `name`
 * is the protocol id referenced by modes.
 */
function getHangingProtocolModule() {
  return [...rtRadiologyProtocols, ...rtRadiotherapyProtocols].map(protocol => ({
    name: protocol.id,
    protocol,
  }));
}

export default getHangingProtocolModule;
