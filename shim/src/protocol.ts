// Wire-protocol version shared with the UEMCP plugin. Bump the major when
// changing: envelope shape, discovery file format, error shape, handshake
// behavior. See docs/PROTOCOL.md in the dev monorepo.

export const PROTOCOL_VERSION = {
  major: 0,
  minor: 1,
  patch: 0,
  string: '0.1.0',
} as const;

export const SHIM_VERSION = '0.1.0';

// Range of protocol majors this shim can talk to. Reject anything outside.
export const SUPPORTED_PROTOCOL_MAJORS: readonly number[] = [0];
