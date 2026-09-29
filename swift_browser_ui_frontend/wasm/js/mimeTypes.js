// Content type resolution for uploaded files.
// The browser fills File.type from the OS mime database; the extension
// map is a fallback for types the browser leaves empty.

const extensionMap = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  zip: "application/zip",
  tar: "application/x-tar",
};

export function guessMimeFromName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return extensionMap[ext] || "application/octet-stream";
}

export function getContentType(file, name) {
  return (file?.type && file.type.trim().length)
    ? file.type
    : guessMimeFromName(name);
}
