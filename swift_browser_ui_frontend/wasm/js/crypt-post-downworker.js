// Worker script for download chunks

import { addTarFile, addTarFolder } from "./tar";
import { checkPollutingName } from "./nameCheck";

/*
Schema for storing the download information:
{
  "containerName": {  // Container level session for the upload
    keyPair: int;  // pointer to the ephemeral keypair for decryption (see uptypes.h)
    files: {  // Files to download, stored in an object
      "filePath": int;  // pointer to the unique session key (see uptypes.h)
      ...
      path_n: int;
    }
  }
}
*/

let downloads = {};
// Text encoder for quickly encoding tar headers
let enc = new TextEncoder();
let downProgressInterval = undefined;
let totalDone = 0;
let totalToDo = 0;
let aborted = false;

// Use a 50 MiB segment when downloading
const DOWNLOAD_SEGMENT_SIZE = 1024 * 1024 * 50;
// Don't segment downloads under 250 MiB
const DOWNLOAD_MAX_NONSEGMENTED_SIZE = 1024 * 1024 * 250;

/*
This script supports being loaded both as a ServiceWorker and an ordinary
worker. The former is to provide support for Firefox and Safari, which only
implement an OPFS version of File System API for security reasons.
Additionally, Firefox <= 110 (e.g. Firefox ESR), lacks any form of
File System API altogether.

SerivceWorker based approach streams the file through ServiceWorker, into
a specific file download. This is a tad slower, since multiple files can't
be downloaded / decrypted in parallel due to the lack of random access,
but is reasonably performant anyways.

OPFS based version might not be worth it in real world use, since it needs
intermediary storage and the ServiceWorker doesn't.
*/


// Example: https://devenv:8443/file/session-id/test-container/examplefile.txt.c4gh
const fileUrl = new RegExp("/file/[^/]*/[^/]*/.*$");
// Example: https://devenv:8443/archive/session-id/test-container.tar
const archiveUrl = new RegExp("/archive/[^/]*/[^/]*\\.tar$");
const fileUrlStart = new RegExp("/file/[^/]*/[^/]*/");
const archiveUrlStart = new RegExp("/archive/[^/]*/");

if (inServiceWorker) {
  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });
}


// Create a download session
function createDownloadSession(id, container, handle, archive, test = false) {
  aborted = false; //reset

  downloads[id] = {
    handle: handle,
    direct: !inServiceWorker,
    archive: archive,
    container: container,
    files: {},
    test: test,
  };
}

function addFileToSession(id, path, url, size) {
  if (checkPollutingName(path)) return;

  downloads[id].files[path] = {
    key: 0,
    url: url,
    size: size,
    realsize: size,
  };
}


function startProgressInterval() {
  const interval = setInterval(() => {
    postMessage({
      eventType: "progress",
      progress: totalDone / totalToDo < 1 ? totalDone / totalToDo : 1,
    });
  }, 250);
  return interval;
}
class FileSlicer {
  constructor(
    output,
    id,
    path,
  ) {
    this.reader = undefined;
    this.output = output;
    this.id = id,
    this.path = path;
    this.chunk = undefined;
    this.done = false;
    this.totalBytes = 0;

    // Cache total file size to properly iterate through responses
    // as fetch bodies larger than 4 GiB can cause issues with memory
    // management.
    this.segmentOffset = 0;
  }

  async getNextSegment() {
    let resp;

    const fileInfo = downloads[this.id].files[this.path];
    const fileSize = fileInfo.realsize;

    // Don't separate smaller downloads (< 250 MiB) into ranges
    if (fileSize < DOWNLOAD_MAX_NONSEGMENTED_SIZE) {
      resp = await fetch(fileInfo.url).catch(() => {});
      this.segmentOffset += DOWNLOAD_MAX_NONSEGMENTED_SIZE;
      this.reader = resp.body.getReader();
      return;
    }

    let end = this.segmentOffset + DOWNLOAD_SEGMENT_SIZE - 1;
    let range = `bytes=${this.segmentOffset}-${end}`;
    resp = await fetch(
      fileInfo.url,
      {
        headers: {
          "Range": range,
        },
      },
    ).catch(e => {
      console.log(e);
    });
    this.segmentOffset += DOWNLOAD_SEGMENT_SIZE;
    this.reader = resp.body.getReader();
  }

  async getStart() {
    await this.getNextSegment();
    ({ value: this.chunk, done: this.done } = await this.reader.read());
  }

  setController(controller) {
    this.output = controller;
  }

  async padFile() {
    if (this.totalBytes % 512 > 0 && downloads[this.id].archive) {
      let padding = "\x00".repeat(512 - this.totalBytes % 512);
      if (this.output instanceof WritableStream) {
        await this.output.write(enc.encode(padding));
      } else {
        this.output.enqueue(enc.encode(padding));
      }
    }
  }

  async concatFile() {

    await this.getStart();

    while (!this.done) {
      if (aborted) return;
      if (this.output instanceof WritableStream) {
        await this.output.write(this.chunk);
      } else {
        while(this.output.desiredSize <= 0) {
          await timeout(10);
        }
        this.output.enqueue(new Uint8Array(this.chunk));
      }
      this.totalBytes += this.chunk.length;
      totalDone += this.chunk.length;
      ({ value: this.chunk, done: this.done } = await this.reader.read());

      if (this.done && this.segmentOffset < downloads[this.id].files[this.path].realsize) {
        await this.getNextSegment();
        ({ value: this.chunk, done: this.done } = await this.reader.read());
      }
    }

    // Round up to a multiple of 512, because tar
    await this.padFile();

    return true;
  }

}

function clear() {
  if (downProgressInterval) {
    clearInterval(downProgressInterval);
    downProgressInterval = undefined;
  }
  totalDone = 0;
  totalToDo = 0;
}

function startAbort(direct, abortReason) {
  aborted = true;
  const msg = {
    eventType: "abort",
    reason: abortReason,
  };
  if (direct) {
    postMessage(msg);
  } else {
    self.clients.matchAll().then(clients => {
      clients.forEach(client =>
        client.postMessage(msg));
    });
  }
  clear();
}

async function abortDownload(id, stream = null) {
  if (downloads[id].direct) {
    // Direct download: FileSystemWritableFileStream with abort/remove support
    if (stream && typeof stream.abort === "function") {
      try {
        await stream.abort();
      } catch (_) {}
    }
    if (downloads[id].handle && typeof downloads[id].handle.remove === "function") {
      try {
        await downloads[id].handle.remove();
      } catch (_) {}
    }
  } else {
    // ServiceWorker: stream is a ReadableStream controller
    if (stream && typeof stream.close === "function") {
      try {
        stream.close();
      } catch (_) {}
    }
  }

  finishDownloadSession(id);
}


// Safely free and remove a download session
function finishDownloadSession(id) {
  delete downloads[id];
}

async function beginDownloadInSession(
  id,
) {

  let fileHandle = downloads[id].handle;
  let fileStream;
  if (downloads[id].direct) {
    fileStream = await fileHandle.createWritable();
  } else {
    fileStream = fileHandle;
  }

  // Add the archive folder structure
  const writtenDirs = new Set();
  const dirKey = (p) => p.replace(/\/+$/, ""); // remove trailing slash

  const writeDirOnce = async (dirPathNoSlash) => {
    const key = dirKey(dirPathNoSlash);
    if (!key || writtenDirs.has(key)) return;

    const entry = addTarFolder(key);
    if (downloads[id].direct) {
      await fileStream.write(entry);
    } else {
      fileStream.enqueue(entry);
    }
    writtenDirs.add(key);
  };

  if (downloads[id].archive) {
    // Derived directories from file paths
    const allDirs = new Set();

    for (const objPath of Object.keys(downloads[id].files)) {
      // Add all parent directories
      const isDirMarker = objPath.endsWith("/") && downloads[id].files[objPath].size === 0;
      const parts = dirKey(objPath).split("/").filter(Boolean);

      // If it's a directory marker, include the full path
      const upto = isDirMarker ? parts.length : Math.max(parts.length - 1, 0);
      for (let i = 1; i <= upto; i++) {
        allDirs.add(parts.slice(0, i).join("/"));
      }
    }

    // Write directories in order of path length
    const folderPaths = Array.from(allDirs).sort((a, b) => a.length - b.length);
    for (const d of folderPaths) {
      await writeDirOnce(d);
    }
  }

  if (downloads[id].direct) {
    // Get total download size and periodically report download progress
    for (const file in downloads[id].files) {
      totalToDo += downloads[id].files[file].size;
    }
    if (!downProgressInterval) {
      downProgressInterval = startProgressInterval();
    }
  }

  for (const file in downloads[id].files) {
    if (aborted) {
      await abortDownload(id, fileStream);
      return;
    }
    if (inServiceWorker) {
      self.clients.matchAll().then(clients => {
        clients.forEach(client =>
          client.postMessage({
            eventType: "downloadProgressing",
          }));
      });
    }

    let path = file;

    // write as directory (0755), not a file (0644)
    if (
      downloads[id].archive &&
      path.endsWith("/") &&
      downloads[id].files[file].size === 0
    ) {
      await writeDirOnce(path);
      continue;
    }

    if (downloads[id].archive) {
      const size = downloads[id].files[file].size;

      let fileHeader = addTarFile(
        downloads[id].files[file].key != 0 ? path : file,
        size,
      );

      if (downloads[id].direct) {
        await fileStream.write(fileHeader);
      } else {
        fileStream.enqueue(fileHeader);
      }
    }

    const slicer = new FileSlicer(
      fileStream,
      id,
      file);

    let res;
    // Always use concatFile since there's no decryption key
    res = await slicer.concatFile().catch(() => {
      return false;
      });
    if (!res) {
      if (!aborted) startAbort(!inServiceWorker, "error");
      await abortDownload(id, fileStream);
      return;
    }
  }

  if (downloads[id].archive) {
    // Write the end of the archive
    if (downloads[id].direct) {
      await fileStream.write(enc.encode("\x00".repeat(1024)));
    } else {
      fileStream.enqueue(enc.encode("\x00".repeat(1024)));
    }
  }

  // Sync the file if downloading directly into file, otherwise finish
  // the fetch request.
  if (downloads[id].direct) {
    await fileStream.close();

  } else {
    fileStream.close();
  }

  if (downloads[id].direct) {
  // Direct downloads need no further action, the resulting archive is
  // already in the filesystem.
    postMessage({
      eventType: "finished",
      container: downloads[id].container,
      test: downloads[id].test,
      handle: downloads[id].handle,
    });
  } else {
  // Inform download with service worker finished
    self.clients.matchAll().then(clients => {
      clients.forEach(client =>
        client.postMessage({
          eventType: "finished",
          container: downloads[id].container,
        }));
    });
  }
  finishDownloadSession(id);
  return;
}

if (inServiceWorker) {
  // Add listener for fetch events
  self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    let fileName;
    let containerName;
    let sessionId;

    if (fileUrl.test(url.pathname)) {
      fileName = url.pathname.replace(fileUrlStart, "");
      [sessionId, containerName] = url.pathname
        .replace("/file/", "").replace("/" + fileName, "").split("/");
    } else if (archiveUrl.test(url.pathname)) {
      fileName = url.pathname.replace(archiveUrlStart, "");
      [sessionId, containerName] = url.pathname
        .replace("/archive/", "")
        .replace(/\.tar$/, "")
        .split("/");
    } else {
      return;
    }

    // Fix URL safe contents
    fileName = decodeURIComponent(fileName);
    containerName = decodeURIComponent(containerName);

    if (checkPollutingName(containerName)) return;

    if (fileUrl.test(url.pathname) || archiveUrl.test(url.pathname)) {
      let streamController;
      const stream = new ReadableStream({
        start(controller) {
          streamController = controller;
        },
      });
      const response = new Response(stream);
      response.headers.append(
        "Content-Disposition",
        "attachment; filename=\"" +
          fileName.split("/").at(-1).replace(".c4gh", "") + "\"",
      );

      // Map the streamController as the stream for the download
      downloads[sessionId].handle = streamController;

      // Start the decrypt slicer and respond, tell worker to stay open
      // until stream is consumed
      e.respondWith((() => {
        e.waitUntil(beginDownloadInSession(sessionId));
        return response;
      })());
    }
  });
}

self.addEventListener("message", async (e) => {
  // Sanity check container name
  if (checkPollutingName(e.data.container)) return;

  switch(e.data.command) {
    case "downloadFile":
      if (inServiceWorker) {
        createDownloadSession(e.data.id, e.data.container, undefined, false);
        addFileToSession(
          e.data.id,
          e.data.file.path,
          e.data.file.url,
          e.data.file.size,
        );

        // Tell the main thread to open the SW download URL
        e.source.postMessage({
          eventType: "downloadStarted",
          id: e.data.id,
          container: e.data.container,
          archive: false,
          path: e.data.file.path,
        });
      } else {
        // Direct worker path
        createDownloadSession(
          e.data.id,
          e.data.container,
          e.data.handle,
          false,
          e.data.test,
        );
        addFileToSession(
          e.data.id,
          e.data.file.path,
          e.data.file.url,
          e.data.file.size,
        );

        // Start the actual download
        beginDownloadInSession(e.data.id);
        postMessage({
          eventType: "downloadStarted",
          container: e.data.container,
        });
      }
      break;
    case "downloadFiles":
      if (inServiceWorker) {
        createDownloadSession(e.data.id, e.data.container, undefined, true);
        for (const f of e.data.files) {
          addFileToSession(e.data.id, f.path, f.url, f.size);
        }

        e.source.postMessage({
          eventType: "downloadStarted",
          id: e.data.id,
          container: e.data.container,
          archive: true,
          path: undefined,
        });
      } else {
        createDownloadSession(
          e.data.id,
          e.data.container,
          e.data.handle,
          true,
          e.data.test,
        );
        for (const f of e.data.files) {
          addFileToSession(e.data.id, f.path, f.url, f.size);
        }

        beginDownloadInSession(e.data.id);
        postMessage({
          eventType: "downloadStarted",
          container: e.data.container,
        });
      }
      break;
    case "keepDownloadProgressing":
      break;
    case "clear":
      clear();
      break;
    case "abort":
      if (!aborted) startAbort(!inServiceWorker, e.data.reason);
      break;
  }
});

export var downloadRuntime = Module;
export var downloadFileSystem = FS;
