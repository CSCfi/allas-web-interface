// Worker script for uploading objects using S3
// Plain version: no encryption, no headers, no vault, no FS mounting

import { PutObjectCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { checkPollutingName } from "./nameCheck";

let s3client = undefined;

// Keep files in memory by bucket + key so we can upload parts directly
const mountedFiles = {};

postMessage({
  eventType: "runtimeInitialized",
});

// Create an s3 client for the worker instance
function createS3Client(access, secret, endpoint) {
  if (s3client === undefined) {
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
}

function ensureBucket(bucket) {
  if (!mountedFiles[bucket]) {
    mountedFiles[bucket] = {};
  }
}

function storeFiles(bucket, files) {
  ensureBucket(bucket);

  for (const obj of files) {
    const key = obj.relativePath || obj.file.name;
    mountedFiles[bucket][key] = obj.file;
  }
}

function removeBucketFiles(bucket) {
  if (mountedFiles[bucket]) {
    delete mountedFiles[bucket];
  }
}

async function uploadSegment(e) {
  if (!s3client) {
    throw new Error("S3 client has not been created");
  }

  const part = e.data.part;
  const bucketFiles = mountedFiles[part.bucket];

  if (!bucketFiles) {
    throw new Error(`No files stored for bucket ${part.bucket}`);
  }

  const file = bucketFiles[part.key];
  if (!file) {
    throw new Error(`No file stored for key ${part.key} in bucket ${part.bucket}`);
  }

  const blob = file.slice(part.offset, part.offset + part.size);
  const body = new Uint8Array(await blob.arrayBuffer());

  let command = undefined;

  if (e.data.session !== "") {
    const input = {
      Body: body,
      Bucket: part.bucket,
      ContentLength: body.length,
      Key: part.key,
      PartNumber: part.orderNumber,
      UploadId: e.data.session,
    };
    command = new UploadPartCommand(input);
  } else {
    const input = {
      Body: body,
      Bucket: part.bucket,
      ContentLength: body.length,
      Key: part.key,
    };
    command = new PutObjectCommand(input);
  }

  const completedPart = await s3client.send(command);

  postMessage({
    eventType: "progress",
    amount: body.length,
  });

  postMessage({
    eventType: "uploadPartComplete",
    key: part.key,
    bucket: part.bucket,
    orderNumber: e.data.session !== "" ? part.orderNumber : 0,
    ETag: completedPart.ETag,
  });
}

self.addEventListener("message", (e) => {
  e.stopImmediatePropagation();

  if (e.data.bucket && checkPollutingName(e.data.bucket)) return;

  switch (e.data.command) {
    case "mountFiles":
      storeFiles(e.data.bucket, e.data.files);
      postMessage({
        eventType: "filesAdded",
      });
      break;

    case "nextPart":
      uploadSegment(e).catch((err) => {
        console.log("Failed uploading plain chunk");
        console.log(err);
        postMessage({
          eventType: "abort",
          reason: "error",
        });
      });
      break;

    case "createS3Client":
      createS3Client(e.data.access, e.data.secret, e.data.endpoint);
      break;

    case "uploadFinished":
      removeBucketFiles(e.data.bucket);
      postMessage({
        eventType: "filesRemoved",
      });
      break;
  }
});