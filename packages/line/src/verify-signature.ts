const textEncoder = new TextEncoder();

function decodeBase64(input: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;

  const signatureBytes = decodeBase64(signature);
  if (!signatureBytes) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    textEncoder.encode(rawBody),
  );
}
