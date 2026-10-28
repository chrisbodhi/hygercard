// §5.1: an id is 128 random bits as 26 characters of lowercase Crockford
// base32, no padding. 26 characters carry 130 bits, so a generated id's first
// character is 0-7 (the top two bits are zero).

export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const ID_LENGTH = 26;

/** The id pattern as regexp source, uncaptured. §10.1's grammar is built from this. */
export const ID_SOURCE = `[${ID_ALPHABET}]{${ID_LENGTH}}`;

const ID_PATTERN = new RegExp(`^${ID_SOURCE}$`);

/**
 * Whether `value` is a well-formed id. This is the grammar's test (26
 * characters of the alphabet), deliberately not the generator's stricter one:
 * a reader that rejected a first character above 7 would be inventing a rule.
 */
export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Fills the array with random bytes, in place. */
type Fill = (bytes: Uint8Array<ArrayBuffer>) => void;

/** Encode 16 bytes (128 bits, big-endian) as 26 base32 characters. */
export function encodeId(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error(`an id is 128 bits, got ${bytes.length * 8}`);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id = ID_ALPHABET[Number(value & 31n)] + id;
    value >>= 5n;
  }
  return id;
}

/** Generate an id from a cryptographically strong source (§5.1). */
export function newId(fill: Fill = (bytes) => void crypto.getRandomValues(bytes)): string {
  const bytes = new Uint8Array(16);
  fill(bytes);
  return encodeId(bytes);
}
