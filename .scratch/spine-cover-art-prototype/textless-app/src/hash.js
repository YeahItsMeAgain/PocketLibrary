export async function sha256Hex(data) {
  let buffer;
  if (data instanceof ArrayBuffer) buffer = data;
  else if (ArrayBuffer.isView(data)) buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  else if (data instanceof Blob) buffer = await data.arrayBuffer();
  else throw new TypeError("sha256Hex expects ArrayBuffer, typed array or Blob");
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalise(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titleAuthorKey(title, author) {
  return `${normalise(title)}|${normalise(author)}`;
}

export function normaliseIsbn(value) {
  return String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function shortHash(hash, n = 10) {
  return hash ? `${hash.slice(0, n)}…${hash.slice(-4)}` : "—";
}
