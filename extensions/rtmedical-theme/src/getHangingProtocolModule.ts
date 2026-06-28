import { rtRadiologyProtocols } from './hangingProtocols/rtRadiologyProtocols';

/**
 * Registers RT Medical radiology hanging protocols (RTV-119) with the
 * HangingProtocolService. Each entry's `name` is the protocol id used by modes.
 */
function getHangingProtocolModule() {
  return rtRadiologyProtocols.map(protocol => ({
    name: protocol.id,
    protocol,
  }));
}

export default getHangingProtocolModule;
