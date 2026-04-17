// Worker scripts for plain S3 download chunks

import { addTarFile, addTarFolder } from "./tar";
import { checkPollutingName } from "./nameCheck";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

let downloads = {};
let enc = new TextEncoder();
let downProgressInterval = undefined;
let totalDone = 0;
let totalToDo = 0;
let aborted = false;

// Use a 50 MiB segment when downloading
const DOWNLOAD_SEGMENT_SIZE = 52428800; // 50 MiB

let s3client = undefined;

postMessage({
  eventType: "runtimeInitialized",
});

/*
This script supports being loaded both as a ServiceWorker and an ordinary
worker. The former is to provide support for Firefox and Safari, which only
implement an OPFS version of File System API for security reasons.
*/

function createS3Client(access, secret, endpoint) {
  s3client = new S3Client({
    region: "RegionOne",
    stsRegionalEndpoints: "legacy",
    s3UsEast1RegionalEndpoint: "legacy",
    s3ForcePathStyle: true,
    forcePathStyle: true,
    endpoint: endpoint,
    credentials: {
      accessKeyId: access,
      secretAccessKey: secret,
    },
  });

  postMessage({
    eventType: "s3ClientCreated",
  });
}

// Example: https://devenv:8443/file/session-id/test-container/examplefile.txt
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

function createDownloadSession(id, bucket, handle, archive, test = false) {
  aborted = false;

  downloads[id] = {
    handle: handle,
    direct: !inServiceWorker,
    archive: archive,
    bucket: bucket,
    test: test,
    files: {},
  };
}

function addDownloadSessionFile(id, path, size) {
  if (checkPollutingName(path)) return false;
  if (typeof size !== "number" || size < 0) return false;

  downloads[id].files[path] = {
    size: size,
    realsize: size,
  };

  return true;
}

function startProgressInterval() {
  const interval = setInterval(() => {
    postMessage({
      eventType: "progress",
      progress: totalToDo > 0 ? (totalDone / totalToDo < 1 ? totalDone / totalToDo : 1) : 1,
    });
  }, 250);
  return interval;
}

async function writeOutput(output, chunk) {
  if (typeof output.write === "function") {
    await output.write(chunk);
  } else {
    while (output.desiredSize <= 0) {
      await timeout(5);
    }
    output.enqueue(chunk);
  }
}

async function concatFile(output, id, path) {
  if (!s3client) {
    throw new Error("S3 client has not been created");
  }

  let totalSegments = Math.floor(downloads[id].files[path].realsize / DOWNLOAD_SEGMENT_SIZE);
  let lastSegment = downloads[id].files[path].realsize % DOWNLOAD_SEGMENT_SIZE;
  let totalBytes = 0;

  console.log(`Concatenating ${downloads[id].bucket}/${path} to output`);

  for (let i = 0; i < totalSegments; i++) {
    if (aborted) break;

    const input = {
      Bucket: downloads[id].bucket,
      Key: path,
      Range: `bytes=${i * DOWNLOAD_SEGMENT_SIZE}-${(i * DOWNLOAD_SEGMENT_SIZE + DOWNLOAD_SEGMENT_SIZE) - 1}`,
    };
    const command = new GetObjectCommand(input);
    const resp = await s3client.send(command);
    const body = await resp.Body.transformToByteArray();

    await writeOutput(output, body);

    totalDone += body.length;
    totalBytes += body.length;
  }

  if (aborted) return false;

  if (lastSegment > 0) {
    const input = {
      Bucket: downloads[id].bucket,
      Key: path,
      Range: `bytes=${totalSegments * DOWNLOAD_SEGMENT_SIZE}-${downloads[id].files[path].realsize - 1}`,
    };
    const command = new GetObjectCommand(input);
    const resp = await s3client.send(command);
    const body = await resp.Body.transformToByteArray();

    await writeOutput(output, body);

    totalDone += body.length;
    totalBytes += body.length;
  }

  if (totalBytes % 512 > 0 && downloads[id].archive) {
    let padding = "\x00".repeat(512 - totalBytes % 512);
    await writeOutput(output, enc.encode(padding));
  }

  return true;
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
      clients.forEach(client => client.postMessage(msg));
    });
  }
  clear();
}

function finishDownloadSession(id) {
  delete downloads[id];
}

async function abortDownload(id, stream = null) {
  console.log(`Aborting download ${id}`);
  if (downloads[id] && downloads[id].direct) {
    if (stream && typeof stream.abort === "function") {
      await stream.abort().catch(() => {});
    }
    if (downloads[id].handle && typeof downloads[id].handle.remove === "function") {
      await downloads[id].handle.remove().catch(err => {
        console.log("Tried to remove a not-yet created file.");
      });
    }
  }
  finishDownloadSession(id);
}

async function beginDownloadInSession(id) {
  let fileHandle = downloads[id].handle;
  let fileStream;

  if (downloads[id].direct) {
    console.log("Creating a writable stream for the file.");
    fileStream = await fileHandle.createWritable();
    console.log("Created a writable stream for the file.");
  } else {
    fileStream = fileHandle;
  }

  if (downloads[id].archive) {
    console.log("Creating the archive header.");
    let folderPaths = Object.keys(downloads[id].files)
      .map(path => path.split("/"))
      .map(path => path.slice(0, -1))
      .filter(path => path.length > 0)
      .sort((a, b) => a.length - b.length)
      .reduce((unique, path) => {
        let joined = path.join("/");
        if (!unique.includes(joined)) {
          unique.push(joined);
        }
        return unique;
      }, []);

    for (const path of folderPaths) {
      await writeOutput(fileStream, addTarFolder(path));
    }
  }

  if (downloads[id].direct) {
    console.log("Starting progress interval.");
    for (const file in downloads[id].files) {
      totalToDo += downloads[id].files[file].size;
    }
    if (!downProgressInterval) {
      downProgressInterval = startProgressInterval();
    }
  }

  for (const file in downloads[id].files) {
    if (aborted) {
      console.log(`Download is aborted, aborting at ${file}`);
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

    if (downloads[id].archive) {
      console.log(`Creating tar archive header for file ${file}`);
      const size = downloads[id].files[file].size;
      let fileHeader = addTarFile(file, size);
      await writeOutput(fileStream, fileHeader);
    }

    let res = await concatFile(fileStream, id, file).catch(err => {
      console.log(`Failed concatenating file ${file}`);
      console.log(err);
      return false;
    });

    if (!res) {
      if (!aborted) startAbort(!inServiceWorker, "error");
      await abortDownload(id, fileStream);
      return;
    }
  }

  if (downloads[id].archive) {
    await writeOutput(fileStream, enc.encode("\x00".repeat(1024)));
  }

  if (downloads[id].direct) {
    await fileStream.close();
  } else if (typeof fileStream.close === "function") {
    fileStream.close();
  }

  if (downloads[id].direct) {
    postMessage({
      eventType: "finished",
      bucket: downloads[id].bucket,
      test: downloads[id].test,
      handle: downloads[id].handle,
    });
  } else {
    self.clients.matchAll().then(clients => {
      clients.forEach(client =>
        client.postMessage({
          eventType: "finished",
          bucket: downloads[id].bucket,
        }));
    });
  }

  finishDownloadSession(id);
  return;
}

if (inServiceWorker) {
  self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    let fileName;
    let bucketName;
    let sessionId;

    if (fileUrl.test(url.pathname)) {
      fileName = url.pathname.replace(fileUrlStart, "");
      [sessionId, bucketName] = url.pathname
        .replace("/file/", "").replace("/" + fileName, "").split("/");
    } else if (archiveUrl.test(url.pathname)) {
      fileName = url.pathname.replace(archiveUrlStart, "");
      [sessionId, bucketName] = url.pathname
        .replace("/archive/", "")
        .replace(/\.tar$/, "")
        .split("/");
    } else {
      return;
    }

    fileName = decodeURIComponent(fileName);
    bucketName = decodeURIComponent(bucketName);

    if (checkPollutingName(bucketName) || checkPollutingName(fileName)) return;
    if (!downloads[sessionId]) return;

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
        fileName.split("/").at(-1) + "\"",
    );

    downloads[sessionId].handle = streamController;

    e.respondWith((() => {
      e.waitUntil(beginDownloadInSession(sessionId));
      return response;
    })());
  });
}

self.addEventListener("message", async (e) => {
  if (checkPollutingName(e.data.bucket)) return;

  switch (e.data.command) {
    case "createS3Client":
      createS3Client(e.data.access, e.data.secret, e.data.endpoint);
      console.log("Download worker created an S3 client.");
      break;

    case "downloadFile":
      if (typeof e.data.size !== "number" || e.data.size < 0) {
        postMessage({
          eventType: "abort",
          reason: "missing_size",
        });
        break;
      }

      if (inServiceWorker) {
        createDownloadSession(e.data.id, e.data.bucket, undefined, false);
        addDownloadSessionFile(e.data.id, e.data.file, e.data.size);

        e.source.postMessage({
          eventType: "downloadStarted",
          id: e.data.id,
          bucket: e.data.bucket,
          archive: false,
          path: e.data.file,
        });
      } else {
        createDownloadSession(
          e.data.id, e.data.bucket, e.data.handle, false, e.data.test);
        addDownloadSessionFile(e.data.id, e.data.file, e.data.size);

        beginDownloadInSession(e.data.id);
        postMessage({
          eventType: "downloadStarted",
          bucket: e.data.bucket,
        });
      }
      break;

    case "downloadFiles":
      if (inServiceWorker) {
        createDownloadSession(e.data.id, e.data.bucket, undefined, true);

        for (const file of e.data.files) {
          if (typeof file !== "object" || file === null || typeof file.path !== "string" || typeof file.size !== "number" || file.size < 0) {
            e.source.postMessage({
              eventType: "abort",
              reason: "missing_size",
            });
            return;
          }
          addDownloadSessionFile(e.data.id, file.path, file.size);
        }

        e.source.postMessage({
          eventType: "downloadStarted",
          id: e.data.id,
          bucket: e.data.bucket,
          archive: true,
        });
      } else {
        createDownloadSession(
          e.data.id, e.data.bucket, e.data.handle, true, e.data.test);

        for (const file of e.data.files) {
          if (typeof file !== "object" || file === null || typeof file.path !== "string" || typeof file.size !== "number" || file.size < 0) {
            postMessage({
              eventType: "abort",
              reason: "missing_size",
            });
            return;
          }
          addDownloadSessionFile(e.data.id, file.path, file.size);
        }

        beginDownloadInSession(e.data.id);
        postMessage({
          eventType: "downloadStarted",
          bucket: e.data.bucket,
        });
      }
      break;

    case "clear":
      clear();
      break;

    case "abort":
      if (!aborted) startAbort(!inServiceWorker, e.data.reason);
      break;
  }
});