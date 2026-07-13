// S3 operations for the frontend

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectsCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketAclCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { i18n } from "./i18n";
import { initS3 } from "./s3init";
import useStore from "./store";
import { DEV } from "./globalFunctions";
import { swiftGetBucketPublic, swiftSetBucketPublic } from "./api";

async function sendS3Command(command) {
  // Wrapper for S3 commands
  const store = useStore();
  await initS3(
    store.active.id,
    store.active.name,
    store,
    i18n.global.t,
  );
  try {
    const resp = await store.s3client.send(command);
    return resp;
  } catch (e) {
    if (DEV) {
      console.error(`Error executing ${command?.constructor?.name} on bucket ${command?.input?.Bucket}`);
    }
    throw e;
  }
}

/** BUCKETS */

export async function awsDeleteBucket(bucket) {
  const command = new DeleteBucketCommand({
    Bucket: bucket,
  });
  const response = await sendS3Command(command);
  return response;
}

export async function checkBucketAccessible(bucket) {
  const command = new HeadBucketCommand({
    Bucket: bucket,
  });
  try {
    const resp = await sendS3Command(command);
    if (resp?.$metadata?.httpStatusCode === 200) return true;
  } catch {
    return false;
  }
}

export async function checkBucketExists(bucket) {
  const command = new HeadBucketCommand({
    Bucket: bucket,
  });
  try {
    const resp = await sendS3Command(command);
    if (resp?.$metadata?.httpStatusCode === 200) return true;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 403) return true;
    return false;
  }
}

export async function getBucketStats(bucket) {
  // Returns Ceph-specific { count, bytes } from x-rgw-* response headers,
  // or null if headers are absent (non-Ceph S3) or the call fails.
  const store = useStore();
  await initS3(store.active.id, store.active.name, store, i18n.global.t);

  let capturedHeaders = null;

  const command = new HeadBucketCommand({ Bucket: bucket });
  // Intercept the raw HTTP response before the SDK deserializer discards
  // non-standard headers. Priority "low" = innermost deserialize middleware,
  // so next() returns the raw { response } from the HTTP handler.
  command.middlewareStack.add(
    (next) => async (args) => {
      const result = await next(args);
      capturedHeaders = result.response?.headers ?? null;
      return result;
    },
    { step: "deserialize", name: "captureRgwStats", priority: "low" },
  );

  try {
    await store.s3client.send(command);
  } catch {
    return null;
  }

  if (!capturedHeaders) return null;

  const count = parseInt(capturedHeaders["x-rgw-object-count"]);
  const bytes = parseInt(capturedHeaders["x-rgw-bytes-used"]);

  if (isNaN(count) || isNaN(bytes)) return null;

  return { count, bytes };
}

/** OBJECTS */

// Create a zero-byte object. Used for empty-folder markers
// (keys ending with "/").
export async function awsPutObject(bucket, key) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: new Uint8Array(0),
    ContentType: "application/x-directory",
  });
  const response = await sendS3Command(command);
  return response;
}

export async function awsDeleteObjects(bucket, objects) {
  const keys = objects.map(obj => ({ Key: obj }));
  const command = new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: {
      Objects: keys,
    },
  });
  const response = await sendS3Command(command);
  return response;
}

export async function awsHeadObject(bucket, object) {
  const command = new HeadObjectCommand({
    Bucket: bucket,
    Key: object,
  });
  const response = await sendS3Command(command);
  return response;
}

export async function awsListObjects(bucket, prefix = undefined) {
  let continuationToken;
  let objects = [];

  try {
    do {
      let listObjectsCommandParams = {
        Bucket: bucket,
        ContinuationToken: continuationToken,
      };
      if (prefix !== undefined) {
        listObjectsCommandParams.Prefix = prefix;
      }

      const command = new ListObjectsV2Command(listObjectsCommandParams);
      const response = await sendS3Command(command);

      if (response?.Contents) {
        response.Contents.map((item) => {
          objects.push({
            name: item.Key,
            bytes: item.Size,
            last_modified: item.LastModified.toISOString(),
          });
        });
      }

      continuationToken = response?.NextContinuationToken;
    } while (continuationToken);
  } catch (e) {
    if (DEV) console.error(`Failed to list objects for bucket ${bucket}`, e);
    if (DEV) console.error(`Returning empty listing for bucket ${bucket}`);
  }
  return objects;
}

export async function checkBucketEmpty(bucket) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    MaxKeys: 1,
  });
  const response = await sendS3Command(command);
  return response?.Contents?.length ? false : true;
}

/**UPLOAD */

export async function awsCreateMultipartUpload(
  bucket, key, acl = undefined, contentType = undefined, metadata = undefined,
) {
  const input = {
    Bucket: bucket,
    Key: key,
  };
  if (acl) input.ACL = acl;
  if (contentType) input.ContentType = contentType;
  if (metadata) input.Metadata = metadata;

  const command = new CreateMultipartUploadCommand(input);
  const response = await sendS3Command(command);
  return response;
}

export async function awsCompleteMultipartUpload(bucket, key, parts, uploadID) {
  const input = {
    Bucket: bucket,
    Key: key,
    MultipartUpload: {
      Parts: parts,
    },
    UploadId: uploadID,
  };

  const command = new CompleteMultipartUploadCommand(input);
  const response = await sendS3Command(command);
  return response;
}

export async function awsAbortMultipartUpload(bucket, key, uploadID) {
  const input = {
    Bucket: bucket,
    Key: key,
    UploadId: uploadID,
  };

  const command = new AbortMultipartUploadCommand(input);
  const response = await sendS3Command(command);
  return response;
}

/** POLICIES */

// Public read access is stored in the Swift container read ACL as the
// ".r:*,.rlistings" tokens, applied through the backend's Swift API
// proxy. That is the source of truth: it is the only public marker
// both this UI and the Swift UI can read AND write. (The S3 ACL API
// physically cannot express those tokens — RGW maps them to Swift-only
// permission bits — which is why an S3-side AllUsers grant was never
// visible to the Swift UI and vice versa.)
const ALL_USERS_URI = "http://acs.amazonaws.com/groups/global/AllUsers";

// The public state is additionally mirrored into a bucket-policy
// statement. The policy is what actually grants anonymous object
// reads on the S3 endpoint (and RGW evaluates it for Swift requests
// too), and it keeps public buckets working if the Swift API is ever
// retired.
const PUBLIC_READ_SID = "GrantAllasUIPublicRead";

export async function getBucketPublicStatus(bucket) {
  // TODO(swift-deprecation): flip the source of truth to the policy —
  // replace the backend call with a PUBLIC_READ_SID check via
  // getBucketPolicyStatements, drop the reconciler below, and build
  // the address from the S3 endpoint (or keep the Swift-style URL for
  // as long as RGW serves the /swift/v1 path)
  const store = useStore();
  const status = await swiftGetBucketPublic(store.active.id, bucket);

  // The Swift UI can only edit the container read ACL, so lazily
  // reconcile the policy mirror to match: add it after a Swift-side
  // enable, remove it after a Swift-side disable.
  try {
    const statements = (await getBucketPolicyStatements(bucket)) || [];
    const policyPublic = statements.some((s) => s?.Sid === PUBLIC_READ_SID);
    if (policyPublic !== status.public) {
      await applyPublicPolicy(bucket, status.public);
    }
  } catch (e) {
    console.warn(`Could not reconcile public policy for ${bucket}:`, e);
  }

  // { public: bool, address: publicly shareable listing URL }
  return status;
}

// Buckets made public by an older build carry an AllUsers READ grant
// on the S3 bucket ACL (it only ever granted anonymous listing).
// Drop it so the listing stops leaking object names once the bucket
// is made private.
async function removeLegacyPublicAclGrant(bucket) {
  try {
    const current = await sendS3Command(
      new GetBucketAclCommand({ Bucket: bucket }),
    );
    const grants = current.Grants || [];
    const kept = grants.filter(
      (grant) => grant?.Grantee?.URI !== ALL_USERS_URI,
    );
    if (kept.length === grants.length) return;
    await sendS3Command(new PutBucketAclCommand({
      Bucket: bucket,
      AccessControlPolicy: {
        Owner: current.Owner,
        Grants: kept,
      },
    }));
  } catch (e) {
    console.warn(`Could not remove legacy public ACL grant from ${bucket}:`, e);
  }
}

async function applyPublicPolicy(bucket, enabled) {
  let statements = (await getBucketPolicyStatements(bucket)) || [];
  statements = statements.filter((s) => s?.Sid !== PUBLIC_READ_SID);
  if (enabled) {
    statements.push({
      "Sid": PUBLIC_READ_SID,
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
    });
  }
  if (statements.length) {
    await putBucketPolicy(bucket, {
      "Version": "2012-10-17",
      "Statement": statements,
    });
  } else {
    await sendS3Command(new DeleteBucketPolicyCommand({ Bucket: bucket }));
  }
}

export async function setBucketPublic(bucket, enabled) {
  const store = useStore();

  if (!enabled) {
    // Must run before the Swift ACL update: PutBucketAcl replaces the
    // whole container ACL, which would wipe the tokens just written
    await removeLegacyPublicAclGrant(bucket);
  }

  // TODO(swift-deprecation): drop this call; the policy write below
  // then becomes the operative mechanism on its own
  //
  // The Swift container read ACL is the operative public marker,
  // shared with the Swift UI; the backend also mirrors it to the
  // legacy _segments twin bucket
  await swiftSetBucketPublic(store.active.id, bucket, enabled);

  try {
    await applyPublicPolicy(bucket, enabled);
  } catch (e) {
    if (enabled) {
      // Policy mirror missing but the bucket IS public via the ACL
      console.warn(`Could not write public policy mirror for ${bucket}:`, e);
    } else {
      // Failing to remove the policy would leave the bucket public
      // while the UI claims private — surface the error
      throw e;
    }
  }

  // Mirror the policy to the legacy segments twin as well
  try {
    await applyPublicPolicy(`${bucket}_segments`, enabled);
  } catch {
    // no segments bucket
  }
}

export async function getBucketPolicyStatements(bucket) {
  // Get a list of bucket policy statements from S3
  try {
    const command = new GetBucketPolicyCommand({ Bucket: bucket });
    const response = await sendS3Command(command);
    if (response?.Policy !== undefined) {
      const policy = JSON.parse(response.Policy);
      return policy?.Statement ?? [];
    }
  } catch(e) {
    if (e.name === "NoSuchBucket") {
      if (DEV) console.error(`Error retrieving bucket ${bucket} policy: bucket does not exist`);
    }
    else if (e.name === "NoSuchBucketPolicy") {
      return [];
    }
    throw e;
  }
}

export async function putBucketPolicy(bucket, policy) {
  // Override old bucket policy
  const command = new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: JSON.stringify(policy),
  });
  const response = await sendS3Command(command);
  return response;
}

export async function ensureCollaborateAccessPolicy(bucket) {
  // Check that the active project exists in owned bucket policy list
  // prior to starting the download
  const store = useStore();
  let project = store.active;
  let statements = await getBucketPolicyStatements(bucket);

  // If the project already has the read and write policies, skip
  for (const statement of statements) {
    if (statement["Sid"] === "GrantAllasUIPreserveOwnerAccess") return;
  }

  // As the owner we want all access
  statements.push({
    "Sid": "GrantAllasUIPreserveOwnerAccess",
    "Effect": "Allow",
    "Principal": {
      "AWS": `arn:aws:iam::${project.id}:root`,
    },
    "Action": [
      "s3:*",
    ],
    "Resource": [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
  });

  if (DEV) console.log(`Pushing preserve statement ${statements}`);

  let policy = {
    "Version": "2012-10-17",
    "Statement": statements,
  };

  // Override the old bucket policy
  const response = await putBucketPolicy(bucket, policy);
  return response;
}

/**
 * Adds access permissions to an S3 bucket policy.
 * @param {string} bucket - Name of the S3 bucket.
 * @param {string[]} rights - Array of permission flags: ["v"] or ["r"] or ["r","w"].
 * @param {string[]} receivers - Array of project IDs to grant access to.
 * @returns {Promise<object>} The response from the S3 PutBucketPolicy call.
 */

export async function addAccessControlBucketPolicy(
  bucket,
  rights,
  receivers,
) {
  // Add the bucket policy for receivers without touching existing policies
  // Fetch the existing bucket policy as a baseline
  const statements = await getBucketPolicyStatements(bucket);

  let policy = {
    "Version": "2012-10-17",
    "Statement": statements,
  };

  // Expand the policy with the new policy entries.
  for (const receiver of receivers) {
    let actions = [];
    if (rights.indexOf("r") >= 0 || rights.indexOf("v") >= 0) {
      actions = actions.concat([
        "s3:GetObject",
        "s3:ListBucket",
        "s3:GetObjectTagging",
        "s3:GetObjectVersion",
      ]);
    }
    if (rights.indexOf("w") >= 0) {
      actions = actions.concat([
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:ListBucketMultipartUploads",
      ]);
    }

    policy.Statement.push({
      "Sid": "GrantAllasUISharedAccessToProject",
      "Effect": "Allow",
      "Principal": {
        "AWS": `arn:aws:iam::${receiver}:root`,
      },
      "Action": actions,
      "Resource": [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
    });
  }

  // Override the old bucket policy
  const response = await putBucketPolicy(bucket, policy);
  return response;
}

export async function removeAccessControlBucketPolicy(
  bucket,
  receivers,
) {
  // Remove the bucket policy for receivers without purging other policies
  // Fetch the existing bucket policy
  const statements = await getBucketPolicyStatements(bucket);

  let policy = {
    "Version": "2012-10-17",
    "Statement": statements,
  };

  // Filter out the old policy entries. Statements not shaped like the
  // ones this UI writes (e.g. Principal "*" or externally attached
  // rules) are kept untouched.
  for (const receiver of receivers) {
    policy.Statement = policy.Statement.filter((statement) => {
      const principal = statement?.Principal?.AWS;
      if (typeof principal !== "string") return true;
      if (DEV) {
        console.log(statement);
        console.log(receiver);
        console.log(principal.match(receiver) == null);
      }
      return principal.match(receiver) == null;
    });
  }

  if (policy.Statement.length === 0) {
    let deleteBucketPolicyCommand = new DeleteBucketPolicyCommand({
      Bucket: bucket,
    });
    try {
      await sendS3Command(deleteBucketPolicyCommand);
    } catch (e) {
      if (DEV) console.log("Failed to delete bucket policy.");
      if (DEV) console.log(e);
    }
    return;
  }

  // Override the old bucket policy
  const response = await putBucketPolicy(bucket, policy);
  return response;
}
