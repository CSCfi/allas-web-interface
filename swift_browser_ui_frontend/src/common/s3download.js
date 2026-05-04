// Functions for handling s3 download worker communication

/*
Download file list:
{
    bucket: string,
    key: string,
    orderNumber: number,
    size: number,
    uuid: string,  // Unique identifier for the download session
}

The download will be finished after all list elements have been shifted
and consumed.
*/

import {
  DEV,
  ensureObjectSizes,
  timeout,
} from "./globalFunctions";
import { awsListObjects, ensureCollaborateAccessPolicy } from "./s3commands";

export default class S3DownloadSocket {
  constructor(
    active, // project id
    project = "", // project name
    store, // shared pinia store
    t, // i18n bindings
    s3access,
    s3secret,
    s3endpoint,
  ) {
    this.active = active;
    this.project = project;
    this.$store = store;
    this.$t = t;
    this.s3access = s3access;
    this.s3secret = s3secret;
    this.s3endpoint = s3endpoint;

    this.downloadFinished = true;
    this.totalSize = 0;
    this.totalCompleted = 0;

    this.useServiceWorker = "serviceWorker" in navigator
      && window.showSaveFilePicker === undefined;
    if (this.useServiceWorker) {
      if (DEV) console.log("Registering download script as service worker");
      let workerUrl = new URL("/s3downworker.js", document.location.origin);
      navigator.serviceWorker.register(workerUrl).then(reg => {
        reg.update();
      }).catch((err) => {
        if (DEV) console.log("Failed to register the service worker.");
        if (DEV) console.log(err);
      });
      this.downWorker = undefined;
    } else if (window.showSaveFilePicker !== undefined) {
      if (DEV) {
        // Load the workers from frontend work directory when in
        // development mode
        this.downWorker = new Worker("/s3downworker.js");
      } else {
        // In production worker is defined in the static folder
        this.downWorker = new Worker("/static/s3downworker.js");
      }
      if (DEV) {
        console.log("Created a conventional worker for downloads.");
      }
    } else {
      if (DEV) console.log("Could not register a worker for download.");
      if (DEV) console.log("Direct downloads are not available.");
    }

    this.toastMessage = {
      duration: 6000,
      persistent: false,
      progress: false,
    };

    // Add message handler for the download worker
    let handleDownloadWorker = (e) => {
      switch(e.data.eventType) {
        case "downloadStarted":
          if (DEV) console.log(`Started download in ${e.data.bucket}`);
          if (this.useServiceWorker) {
            this.downloadFinished = false;
            let downloadUrl = undefined;
            if (e.data.archive) {
              downloadUrl = new URL(
                `/archive/${e.data.id}/${e.data.bucket}.tar`,
                document.location.origin,
              );
            } else {
              downloadUrl = new URL(
                `/file/${e.data.id}/${e.data.bucket}/${e.data.path}`,
                document.location.origin,
              );
            }
            if (DEV) console.log(downloadUrl);
            window.open(downloadUrl, "_blank");
          }
          break;
        case "downloadProgressing":
          if (this.useServiceWorker) {
            navigator.serviceWorker.ready.then(async(reg) => {
              while (!this.downloadFinished) {
                // Keep the service worker awake while downloading
                reg.active.postMessage({
                  command: "keepDownloadProgressing",
                });
                await timeout(10000);
              }
            });
          }
          break;
        case "abort":
          this.$store.setDownloadAbortReason(e.data.reason);
          if (!this.useServiceWorker) {
            this.$store.removeDownload(true);
            this.$store.eraseDownloadProgress();
          }
          break;
        case "progress":
          this.$store.updateDownloadProgress(e.data.progress);
          break;
        case "finished":
          if (DEV) {
            console.log(
              `Finished a download in bucket ${e.data.bucket}`,
            );
          }
          if (!this.useServiceWorker) {
            if (this.$store.downloadCount === 1) {
              this.$store.updateDownloadProgress(1);
              this.downWorker.postMessage({
                command: "clear",
              });
              if (DEV) {
                console.log("Clearing download progress interval");
              }
            }
            this.$store.removeDownload();
          }
          else {
            this.downloadFinished = true;
          }
          break;
      }
    };

    this.handleDownloadWorker = handleDownloadWorker;

    if (this.useServiceWorker) {
      navigator.serviceWorker.addEventListener(
        "message",
        handleDownloadWorker,
      );
    } else if (window.showSaveFilePicker !== undefined) {
      this.downWorker.onmessage = handleDownloadWorker;
    }

    // Initialize the S3 client
    if (this.useServiceWorker) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.active.postMessage({
          command: "createS3Client",
          access: this.s3access,
          secret: this.s3secret,
          endpoint: this.s3endpoint,
        });
      });
    } else if (window.showSaveFilePicker !== undefined) {
      this.downWorker.postMessage({
        command: "createS3Client",
        access: this.s3access,
        secret: this.s3secret,
        endpoint: this.s3endpoint,
      });
    }
  }

  async resolveDownloadObjects(bucket, objectNames) {
    let bucketFiles = await awsListObjects(bucket);
    if (bucketFiles.length == 0) {
      throw new Error(`No objects for bucket ${bucket}, aborting`);
    }

    if (objectNames.length >= 1) {
      bucketFiles = bucketFiles.filter(
        item => objectNames.includes(item.name),
      );
    }

    bucketFiles = await ensureObjectSizes(bucket, bucketFiles);
    return bucketFiles.map(file => ({
      path: file.name,
      size: file.bytes,
    }));
  }

  cancelDownload() {
    this.downWorker.postMessage({ command: "abort", reason: "cancel" });
    if (DEV) console.log("Cancel direct downloads");
  }

  async addDownload(
    bucket,
    objects,
    owner = "",
    test = false,
  ) {
    // Before adding the download, ensure that we have retained access as the owner
    if (!owner) {
      if (DEV) console.log("Not downloading from shared bucket, ensure access is retained.");
      try {
        await ensureCollaborateAccessPolicy(bucket);
      } catch {
        if (DEV) console.log(`Could not retain access in bucket ${bucket}`);

        document.querySelector("#download-error-toasts").addToast(
          {
            ...this.toastMessage,
            type: "error",
            message: this.$t("message.download.noRetain"),
          },
        );

        return;
      }
    }


    // get random id
    const sessionId = window.crypto.randomUUID();
    if (DEV) {
      console.log(`Beginning download session with UUID ${sessionId}`);
    }

    const selectedObjects = await this.resolveDownloadObjects(bucket, objects);
    let fileHandle = undefined;
    if (objects.length == 1) {
      // Download directly into the file if available.
      // Otherwise, use streaming + ServiceWorker
      if (!this.useServiceWorker) {
        const fileName = objects[0];

        if (test) {
          // OPFS root for direct download e2e testing
          const testDirHandle = await navigator.storage.getDirectory();
          fileHandle =
            await testDirHandle.getFileHandle(fileName, { create: true });
        } else {
          // Match the file identifier
          const fident = objects[0].match(/(?<!^)\.[^.]{1,}$/g);
          const opts = {
            suggestedName: fileName,
          };

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
          fileHandle = await window.showSaveFilePicker(opts);
        }

        if (DEV) console.log(`Posting file ${fileName} to download worker`);
        this.downWorker.postMessage({
          command: "downloadFile",
          id: sessionId,
          bucket: bucket,
          file: objects[0],
          size: selectedObjects[0].size,
          handle: fileHandle,
          owner: owner,
          test: test,
        });

        if (DEV) console.log(`Posted file ${fileName} to download worker`);
      } else {
        if (DEV) {
          console.log(
            "Instructing ServiceWorker to add a file to the downloads.",
          );
        }
        navigator.serviceWorker.ready.then(reg => {
          reg.active.postMessage({
            command: "downloadFile",
            id: sessionId,
            bucket: bucket,
            file: objects[0],
            size: selectedObjects[0].size,
            owner: owner,
          });
        });
      }
    } else {
      // Download directly into the archive if available.
      // Otherwise stream the download via ServiceWorker.
      if (!this.useServiceWorker) {
        const fileName = `${bucket}_download.tar`;
        if (test) {
          // OPFS root for direct download e2e testing
          const testDirHandle = await navigator.storage.getDirectory();
          fileHandle =
            await testDirHandle.getFileHandle(fileName, { create: true });
        } else {
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
          });
        }
        this.downWorker.postMessage({
          command: "downloadFiles",
          id: sessionId,
          bucket: bucket,
          files: selectedObjects,
          handle: fileHandle,
          owner: owner,
          test: test,
        });
      } else {
        navigator.serviceWorker.ready.then(reg => {
          reg.active.postMessage({
            command: "downloadFiles",
            id: sessionId,
            bucket: bucket,
            files: selectedObjects,
            owner: owner,
          });
        });
      }
    }
  }
}
