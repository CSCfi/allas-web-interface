// Functions for handling interfacing between workers and upload API socket

import { getUploadSocket } from "./api";
import { DEV } from "./conv";
import { getDB } from "./db";
import { timeout } from "./globalFunctions";


export default class UploadSocket {
  constructor(
    active,
    project = "",
    store,
    t,
  ) {
    this.active = active;
    this.project = project;
    this.$store = store;
    this.$t = t;

    this.inputFiles = {};
    this.outputFiles = {};

    this.downloadFinished = true; // track download progress with service worker

    this.useServiceWorker = "serviceWorker" in navigator
      && window.showSaveFilePicker === undefined;

    // Initialize the workers
    // The workers will eventually handle threading by themselves, to
    // avoid blocking the main browser thread
    this.upWorker = new Worker("/upworker.js");
    if (this.useServiceWorker) {
      if (DEV) console.log("Registering download script into service worker.");
      let workerUrl = new URL("/downworker.js", document.location.origin);
      navigator.serviceWorker.register(workerUrl).then(reg => {
        reg.update();
      }).catch((err) => {
        if (DEV) console.log("Failed to register the service worker.");
        if (DEV) console.log(err);
      });
      this.downWorker = undefined;
    } else if (window.showSaveFilePicker !== undefined) {
      if (DEV) {
        console.log("Registering the download script as a normal worker.");
      }
      this.downWorker = new Worker("/downworker.js");
    } else {
      if (DEV) console.log("Could not register a worker for download.");
      if (DEV) console.log("Decrypted downloads are not available.");
    }

    this.toastMessage = {
      duration: 6000,
      persistent: false,
      progress: false,
    };

    // Add message handlers for upload and download workers
    let handleUpWorker = (e) => {
      switch(e.data.eventType) {
        case "uploadCreated":
          break;
        case "webSocketOpened":
          break;
        case "retryChunk":
          if (DEV) console.log("Retrying a chunk.");
          break;
        case "progress":
          this.$store.commit(
            "updateProgress",
            e.data.progress,
          );
          break;
        case "abort":
          this.$store.commit("setUploadAbortReason", e.data.reason);
          this.$store.commit("stopUploading", true);
          this.$store.commit("toggleUploadNotification", false);
          this.$store.commit("eraseProgress");
          this.$store.commit("eraseDropFiles");
          break;
        case "success":
          break;
        case "finished":
          this.$store.commit("eraseDropFiles");
          this.$store.commit("stopUploading");
          this.$store.commit("eraseProgress");
          break;
      }
    };
    let handleDownWorker = (e) => {
      switch(e.data.eventType) {
        case "downloadStarted":
          if (this.useServiceWorker) {
            this.$store.commit("toggleDownloadStartedToast", true);
            setTimeout(() => {
              this.$store.commit("toggleDownloadStartedToast", false);
            }, 4000);
          }
          if (DEV) {
            console.log(
              `Started downloading in container ${e.data.container}`,
            );
          }
          if (this.useServiceWorker) {
            if (this.$store.state.downloadProgress === undefined) {
              this.$store.commit("updateDownloadProgress", 0);
            }
            this.downloadFinished = false;
            if (e.data.archive) {
              let downloadUrl = new URL(
                `/archive/${e.data.id}/${e.data.container}.tar`,
                document.location.origin,
              );
              if (DEV) console.log(downloadUrl);
              window.open(downloadUrl, "_blank");
            } else {
              let downloadUrl = new URL(
                `/file/${e.data.id}/${e.data.container}/${e.data.path}`,
                document.location.origin,
              );
              if (DEV) console.log(downloadUrl);
              window.open(downloadUrl, "_blank");
            }
          }
          break;
        case "downloadProgressing":
          if (this.useServiceWorker) {
            navigator.serviceWorker.ready.then(async(reg) => {
              while (!this.downloadFinished) {
                // keep the service worker awake while downloading
                reg.active.postMessage({
                  command: "keepDownloadProgressing",
                });
                await timeout(10000);
              }
            });
          }
          break;
        case "abort":
          this.$store.commit("setDownloadAbortReason", e.data.reason);
          this.$store.commit("removeDownload", true);
          this.$store.commit("eraseDownloadProgress");
          this.$store.commit("toggleDownloadNotification", false);
          if (this.useServiceWorker) this.downloadFinished = true;
          break;
        case "progress":
          this.$store.commit("updateDownloadProgress", e.data.progress);
          break;
        case "finished":
          if (DEV) {
            console.log(
              `Finished a download in container ${e.data.container}`,
            );
          }
          if (!this.useServiceWorker) {
            if (this.$store.state.downloadCount === 1) {
              this.$store.commit("updateDownloadProgress", 1);
              this.downWorker.postMessage({ command: "clear" });
            }
          }
          else {
            this.downloadFinished = true;
            this.$store.commit("updateDownloadProgress", 1);
          }

          this.$store.commit("removeDownload");

          break;
      }
    };

    this.handleUpWorker = handleUpWorker;
    this.handleDownWorker = handleDownWorker;

    this.upWorker.onmessage = handleUpWorker;
    if (this.useServiceWorker) {
      navigator.serviceWorker.addEventListener(
        "message",
        handleDownWorker,
      );
    } else if (window.showSaveFilePicker !== undefined) {
      this.downWorker.onmessage = handleDownWorker;
    }
  }

  // Get the latest upload endpoint
  async updateEndpoint() {
    let upinfo = await getUploadSocket(
      this.active.id,
      this.active.id,
    );

    return upinfo;
  }

  async resolveDownloadObjects(container, objects, owner) {
    // Find the container in IndexedDB
    const dbContainer = await getDB().containers.get({
      projectID: this.active.id,
      name: container,
    });
    if (!dbContainer) {
      throw new Error(`Container ${container} not found in IndexedDB`);
    }

    // Get all objects for that container
    let dbObjects = await getDB().objects
      .where({ containerID: dbContainer.id })
      .toArray();

    // Filter to the requested ones
    if (objects && objects.length) {
      dbObjects = dbObjects.filter(o => objects.includes(o.name));
    }

    return dbObjects;
  }

  // Build the proxy download URL
  buildProxyUrl(container, objectName, owner) {
    const projectParam = this.active.id;
    const projectPath = owner || this.active.id;

    const url = new URL(
      `/download/${encodeURIComponent(projectPath)}/${encodeURIComponent(container)}/${encodeURIComponent(objectName)}`,
      document.location.origin,
    );
    url.searchParams.set("project", projectParam);
    return url.toString();
  }

  // Initialize download UI state
  beginDownloadUI()  {
    if (this.$store.state.downloadCount <= 0) {
      this.$store.commit("eraseDownloadProgress");
    }
    this.$store.commit("addDownload");
    if (this.$store.state.downloadProgress === undefined) {
      this.$store.commit("updateDownloadProgress", 0);
    }
    this.$store.commit("toggleDownloadNotification", true);
  }



  // Open the websocket for runner communication
  openSocket() {
    this.updateEndpoint().then(upinfo => {
      this.upWorker.postMessage({
        command: "openWebSocket",
        upinfo: upinfo,
      });
      if (DEV) console.log("Instructed upWorker to open the websocket.");
    });
  }

  cancelUpload(container) {
    this.upWorker.postMessage({ command: "closeWebSocket", container });
    if (DEV) console.log("Close the websocket and cancel current upload");
  }

  cancelDownload() {
    // Direct worker downloads (Chrome/Edge etc.)
    if (!this.useServiceWorker && this.downWorker) {
      this.downWorker.postMessage({ command: "abort", reason: "cancel" });
      if (DEV) console.log("Cancel direct downloads");
    }
    // ServiceWorker downloads (Firefox / Safari)
    else if (this.useServiceWorker) {
      navigator.serviceWorker.ready.then(reg => {
        reg.active?.postMessage({ command: "abort", reason: "cancel" });
        if (DEV) console.log("Cancel SW downloads");
      });
    }
  }


  // Schedule file/files for upload
  addUpload(
    container,
    files,
    owner = "",
    ownerName = "",
  ) {
    let uploadFiles = [];
    for (const file of files) {
      uploadFiles.push({
        relativePath: file.relativePath,
        file: file,
      });
    }

    this.upWorker.postMessage({
      command: "addFiles",
      container: container,
      projectName: this.active.name,
      owner: owner,
      ownerName: ownerName,
      files: uploadFiles,
    });

    if (DEV) console.log("Pushed new files to the service worker.");
    this.$store.commit("setUploading");
  }

  // Schedule file/files for download
  async addDownload(
    container,
    objects,
    owner = "",
    test = false,
  ) {

    //get random id
    const sessionId = window.crypto.randomUUID().slice(0, 8);

    let ownerName = "";
    if (owner) {
      let ids = await this.$store.state.client.projectCheckIDs(owner);
      ownerName = ids.name;
    }

    // Resolve selected object records (name, url, bytes) from IndexedDB
    const dbObjects = await this.resolveDownloadObjects(container, objects, owner);

    let fileHandle = undefined;
    if (objects.length == 1) {
      const obj = dbObjects[0];
      const fileName = obj.name.replace(".c4gh", "");
      // Download directly into the file if available.
      // Otherwise, use streaming + ServiceWorker.
      if (!this.useServiceWorker) {
        if (test) {
          //OPFS root for direct download e2e testing
          const testDirHandle = await navigator.storage.getDirectory();
          fileHandle =
            await testDirHandle.getFileHandle(fileName, { create: true });
        }
        else {
        // Match the file identifier
          const fident = fileName.match(/(?<!^)\.[^.]{1,}$/g);
          const opts = { suggestedName: fileName };
          if (fident) {
            opts.types = [
              {
                description: "Generic file",
                accept: {
                  "application/octet-stream": [fident],
                },
              },
            ];
          }
          try {
            fileHandle = await window.showSaveFilePicker(opts);
          } catch (err) {
            return;
          }
          this.beginDownloadUI();
        }
        this.downWorker.postMessage({
          command: "downloadFile",
          id: sessionId,
          container: container,
          file: {
            path: obj.name,
            url:  this.buildProxyUrl(container, obj.name, owner),
            size: obj.bytes,
          },
          handle: fileHandle,
          owner: owner,
          ownerName: ownerName,
          test: test,
        });
      } else {
        if (DEV) {
          console.log("Instructing ServiceWorker to add a file to downloads.");
        }
        navigator.serviceWorker.ready.then(reg => {
          reg.active.postMessage({
            command: "downloadFile",
            id: sessionId,
            container: container,
            file: {
              path: obj.name,
              url: this.buildProxyUrl(container, obj.name, owner),
              size: obj.bytes,
            },
            owner: owner,
            ownerName: ownerName,
          });
        });
      }
    } else {
      // Download directly into the archive if available.
      // Otherwise, use streaming + ServiceWorker.
      if (!this.useServiceWorker) {
        const fileName = `${container}_download.tar`;
        if (test) {
          //OPFS root for direct download e2e testing
          const testDirHandle = await navigator.storage.getDirectory();
          fileHandle =
            await testDirHandle.getFileHandle(fileName, { create: true });
        } else {
          try {
            fileHandle = await window.showSaveFilePicker({
              suggestedName: fileName,
              types: [
                {
                  description: "Tar archive (uncompressed)",
                  accept: {
                    "application/x-tar": [".tar"],
                  },
                },
              ],
            });} catch (err) {
            return;
          }
          this.beginDownloadUI();
        }
        this.downWorker.postMessage({
          command: "downloadFiles",
          id: sessionId,
          container: container,
          files: dbObjects.map(obj => ({
            path: obj.name,
            url: this.buildProxyUrl(container, obj.name, owner),
            size: obj.bytes,
          })),
          handle: fileHandle,
          owner: owner,
          ownerName: ownerName,
          test: test,
        });
      } else {
        navigator.serviceWorker.ready.then(reg => {
          reg.active.postMessage({
            command: "downloadFiles",
            id: sessionId,
            container: container,
            files: dbObjects.map(obj => ({
              path: obj.name,
              url: this.buildProxyUrl(container, obj.name, owner),
              size: obj.bytes,
            })),
            owner: owner,
            ownerName: ownerName,
          });
        });
      }
    }
  }
}
