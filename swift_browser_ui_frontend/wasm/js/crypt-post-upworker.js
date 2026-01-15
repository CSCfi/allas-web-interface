// Worker script for upload chunks

/*
Schema for storing the upload information:
{
  "containerName": {  // Container level session for the upload
    receivers: int;  // pointer to the receiver public key list (see uptypes.h)
    receiversLen: int;  // The amount of receivers listed
    files: {  // Files to upload, stored in an object
      "filePath": int;  // pointer to the unique session key (see uptypes.h)
      ...
      path_n: int;
    }
  }
}
*/
import msgpack from "@ygoe/msgpack";
import { checkPollutingName } from "./nameCheck";

let uploads = {};
let upinfo = undefined;
let socket = undefined;

let totalLeft = 0;
let totalDone = 0;
let totalFiles = 0;
let doneFiles = 0;
let progressInterval = undefined;
let uploadCount = 0;
let uploadCancelled = false;

// Content type fallback for uploaded files
function guessMimeFromName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
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
    md:   "text/markdown; charset=utf-8",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    zip: "application/zip",
    tar: "application/x-tar",
  };
  return map[ext] || "application/octet-stream";
}


// Create an upload session
function createUploadSession(container, projectName) {


  // Store the upload session
  uploads[container] = {
    files: {},
    done_files: {},
    projectName: projectName,
    owner: "",
    ownerName: "",
  };
}

class StreamSlicer{
  constructor(
    input,
    container,
    path,
  ) {
    this.file = input;
    this.container = container;
    this.path = path;
    this.chunk = undefined;
    this.done = false;
    this.offset = 0;
    this.remainder = 0;
    this.bytes = 0;
    this.totalBytes = 0;
    this.iter = 0;

    this.reader = this.file.stream();
  }

  async getStart() {
    ({ value: this.chunk, done: this.done } = await this.reader.read());
  }

  async getChunk(iter) {
    let enChunk = await this.file.slice(iter * 65536, iter * 65536 + 65536);

    if (enChunk === undefined || enChunk.length === 0 || enChunk.size === 0
      || uploadCancelled
    ) {
      if (uploadCancelled) uploadCount = 0;
      return undefined;
    }

    let enBuffer = await enChunk.arrayBuffer();

    return new Uint8Array(enBuffer);
  }

  retryChunk(iter) {
    this.getChunk(iter).then(async () => {
      if (uploads[this.container]) {
        let chunk = await this.getChunk(iter);

        if (chunk === undefined) {
          return;
        }

        let msg = msgpack.serialize({
          command: "add_chunk",
          container: this.container,
          object: this.path,
          order: iter,
          data: chunk,
        });
        if (socket.readyState === 1) {
          socket.send(msg);
        }
      }
    });
  }

  async sendChunks() {
    if (uploads[this.container]) {
      let chunks = [];
      while (chunks.length < 20) {
        let chunk = await this.getChunk(this.iter);
        if (chunk === undefined) {
          break;
        }
        chunks.push({
          order: this.iter,
          data: chunk,
        });
        this.iter++;
        totalDone += chunk.length;
      }

      let msg = msgpack.serialize({
        command: "add_chunks",
        container: this.container,
        object: this.path,
        chunks: chunks,
      });
      if (socket.readyState === 1) {
        socket.send(msg);
      }
    }
  }

  async startFile() {
    // Uploads need to be throttled a bit, without throttling
    // upload doesn't progress fast enough to keep the upload
    // connection open.
    while (uploadCount > 4) {
      await timeout(250);
    }
    if (!uploadCancelled) {
      uploadCount++;
      await this.sendChunks();
    }
  }

  finishFile() {
    let msg = msgpack.serialize({
      command: "finish",
      container: this.container,
      object: this.path,
    });
    socket.send(msg);
    uploadCount--;
    doneFiles++;
  }
}

// Safely free and remove an upload session
function finishUploadSession(container) {
  delete uploads[container];
}


// Open the websocket for communicating with the runner
async function openWebSocket (
  upinfo,
) {
  // Skip socket initialization if the socket is connecting or open
  if (socket !== undefined) {
    if (socket.readyState === 0 || socket.readyState === 1) {
      return;
    }
  }

  let socketURL = new URL(upinfo.wsurl);
  socketURL.searchParams.append(
    "session",
    upinfo.id,
  );
  socketURL.searchParams.append(
    "valid",
    upinfo.wssignature.valid,
  );
  socketURL.searchParams.append(
    "signature",
    upinfo.wssignature.signature,
  );

  socket = new WebSocket(socketURL);
  socket.binaryType = "arraybuffer";

  socket.onmessage = msg => {
    let msg_data = msgpack.deserialize(msg.data);

    switch (msg_data.command) {
      // Abort the upload
      case "abort":
        socket.close();
        doneFiles = 0;
        totalFiles = 0;
        uploadCount = 0;
        postMessage({
          eventType: "abort",
          container: msg_data.container,
          object: msg_data.object,
          reason: msg_data.reason,
        });
        break;
      // A file was successfully uploaded
      case "success":
        if(!uploadCancelled) {
          uploads[msg_data.container].files[msg_data.object].slicer.finishFile();
          postMessage({
            eventType: "success",
            container: msg_data.container,
            object: msg_data.object,
          });
        }
        break;
      // Push the next chunk to the websocket
      case "start_upload":
        if(!uploadCancelled) {
          uploads[msg_data.container].files[msg_data.object].slicer.startFile().then(
            () => {},
          );
        }
        break;
      // Respond to server ACK with next content
      case "next":
        if(!uploadCancelled) {
          uploads[msg_data.container].files[msg_data.object].slicer.sendChunks().then(
            () => {},
          );
        }
        break;
      // Retry a chunk in the websocket
      case "retry_chunk":
        if(!uploadCancelled) {
          uploads[msg_data.container].files[msg_data.object].slicer.retryChunk(msg_data.order);
        }
        break;
    }
  };
}

/*
Add a batch of files to the current upload session.
*/
async function addFiles(files, container) {
  for (const file of files) {
    let handle = file.file;

    if (checkPollutingName(file.relativePath)) return;

    const chunkSize = 65536;
    let path = `${file.relativePath}`;
    let totalBytes  = handle.size;
    let totalChunks = Math.ceil(handle.size / chunkSize);

    totalLeft += handle.size;
    totalFiles++;

    const contentType =
      (handle.type && handle.type.trim().length)
        ? handle.type
        : guessMimeFromName(path);


    // Add the chunks that need to be uploaded
    let chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      chunks.push(i);
    }

    // Add the file to the upload session
    uploads[container].files[path] = {
      totalBytes: totalBytes,
      currentByte: 0,
      totalChunks: totalChunks,
      totalUploadedChunks: 0,
      chunks: chunks,
      file: handle,
      slicer: new StreamSlicer(handle, container, path),
    };

    let msg = {
      command: "start_upload",
      container: container,
      object: path,
      name: uploads[container].projectName,
      total: totalBytes,
      content_type: contentType,
    };

    if (uploads[container].owner !== "") {
      msg.owner = uploads[container].owner;
    }
    if (uploads[container].ownerName !== "") {
      msg.owner_name = uploads[container].ownerName;
    }

    while (socket.readyState !== 1 && !uploadCancelled) {
      await timeout(250);
      // Ensure the websocket has stayed open
      openWebSocket(upinfo);
    }
    if (socket.readyState === 1) {
      // Upload the file header
      socket.send(msgpack.serialize(msg));
    }
  }

  // Create an interval for updating progress
  progressInterval = setInterval(() => {
    if (doneFiles >= totalFiles) {
      postMessage({
        eventType: "finished",
        container: container,
      });
      totalDone = 0;
      totalLeft = 0;
      totalFiles = 0;
      doneFiles = 0;
      clearInterval(progressInterval);
    } else {
      postMessage({
        eventType: "progress",
        totalFiles: totalFiles,
        progress: totalDone / totalLeft < 1 ? totalDone / totalLeft : 1,
      });
    }
  }, 250);
}


function closeWebSocket(container) {
  let msg = msgpack.serialize({
    command: "cancel",
  });
  socket.send(msg);
  finishUploadSession(container);
}

self.addEventListener("message", (e) => {
  e.stopImmediatePropagation();

  // Sanity check container name
  if (checkPollutingName(e.data.container)) return;

  switch(e.data.command) {
    // Create a new upload session with provided files
    case "addFiles":
      uploadCancelled = false;
      // Create new upload session if it doesn't already exist
      if (uploads[e.data.container] === undefined) {
        createUploadSession(
          e.data.container,
          e.data.projectName,
        );
      }

      if (e.data.owner !== "") {
        uploads[e.data.container].owner = e.data.owner;
      }
      if (e.data.ownerName !== "") {
        uploads[e.data.container].ownerName = e.data.ownerName;
      }

      // Add the files in the upload request
      addFiles(e.data.files, e.data.container);

      postMessage({
        eventType: "uploadCreated",
        container: e.data.container,
      });
      break;
    // Abort the upload in question
    case "openWebSocket":
      upinfo = e.data.upinfo;
      openWebSocket(upinfo);
      postMessage({
        eventType: "webSocketOpened",
      });
      break;
    case "closeWebSocket":
      uploadCancelled = true;
      closeWebSocket(e.data.container);
      break;
    case "abortUpload":
      finishUploadSession(e.data.container);
      break;
  }
});

export var uploadRuntime = Module;
export var uploadFileSystem = FS;
