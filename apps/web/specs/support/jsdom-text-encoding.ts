import { TextDecoder, TextEncoder } from 'node:util';

/**
 * Every browser has TextEncoder; jsdom does not. react-qr-code encodes the
 * value with it, so any screen that draws an animal's QR code (the scan label
 * on the animal card) threw under jest without this.
 */
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
