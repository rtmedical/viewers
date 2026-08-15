import { dbtProtocols } from './dbtProtocol';

/**
 * Registers the mammography hanging protocols. Currently the DBT four-up (RTV-76).
 * Each entry's `name` is the protocol id, matching the convention in
 * `extensions/rtmedical-theme/src/getHangingProtocolModule.ts`.
 */
function getHangingProtocolModule() {
  return dbtProtocols.map(protocol => ({ name: protocol.id, protocol }));
}

export default getHangingProtocolModule;
