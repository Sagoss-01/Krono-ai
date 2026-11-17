import * as mediasoupClientNs from 'mediasoup-client';

const mediasoupClient =
  mediasoupClientNs?.default && typeof mediasoupClientNs.default.Device === 'function'
    ? mediasoupClientNs.default
    : mediasoupClientNs;

if (typeof window !== 'undefined') {
  window.TechSphereMediasoupClient = mediasoupClient;
  window.__TECHSPHERE_MEDIASOUP_CLIENT__ = mediasoupClient;
}

export default mediasoupClient;
export * from 'mediasoup-client';
