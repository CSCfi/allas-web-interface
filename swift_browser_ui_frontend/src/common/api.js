// API fetch functions.

import { DEV } from "@/common/globalFunctions";

async function fetchWithCookie({method, url, body, signal, suppressAuthRedirect = false}) {
  return fetch(url, {
    method,
    body,
    signal,
    credentials: "same-origin",
  })
    .then(response => {
      switch (response.status) {
        case 401:
          if (!suppressAuthRedirect && window.location.pathname !== "/accessibility") {
            window.location.pathname = "/unauth";
          }
          break;
        case 403:
          window.location.pathname = "/forbid";
          break;
        case 503:
          window.location.pathname = "/uidown";
          break;
      }

      return response;
    })
    .catch(error => {
      if (!signal?.aborted) {
        if (DEV) {
          console.log("Fetch error. Might be a networking issue", error);
        }
        throw new Error(error);
      }
    });
}
export async function GET(url, signal, suppressAuthRedirect = false) {
  return fetchWithCookie({
    url,
    signal,
    method: "GET",
    suppressAuthRedirect,
  });
}
export async function POST(url, body) {
  return fetchWithCookie({
    url,
    body,
    method: "POST",
  });
}
export async function PUT(url, body) {
  return fetchWithCookie({
    url,
    body,
    method: "PUT",
  });
}
export async function DELETE(url, body) {
  return fetchWithCookie({
    url,
    body,
    method: "DELETE",
  });
}

export async function getUser() {
  // Get username of the currently displayed user.
  let getUserURL = new URL("/api/username", document.location.origin);
  let uname = await GET(getUserURL);

  if (uname.status !== 401) {
    return await uname.json();
  }
  else {
    return "";
  }
}

export async function getProjects() {
  // Get available projects from the API.
  let getProjectsURL = new URL("/api/projects", document.location.origin);
  let ret = await GET(getProjectsURL);
  return await ret.json();
}

export async function copyBucket(
  project,
  bucket,
  source_project,
  source_bucket,
  project_name,
  source_project_name,
) {
  // Replicate the bucket from a specified source to the location
  let fetchURL = new URL("/replicate/".concat(
    encodeURI(project), "/",
    encodeURI(bucket),
  ), document.location.origin);

  fetchURL.searchParams.append("from_bucket", source_bucket);
  fetchURL.searchParams.append("from_project", source_project);
  if (project_name) {
    fetchURL.searchParams.append("project_name", project_name);
  }
  if (source_project_name) {
    fetchURL.searchParams.append("from_project_name", source_project_name);
  }

  let ret = await POST(fetchURL);

  if (ret.status != 202) {
    throw new Error("Bucket replication not successful.");
  }

  return ret;
}


// Proxy ListBuckets command through the backend
export async function awsListBuckets(
  project,
  continuation_token = undefined,
  max_buckets = undefined,
) {
  let fetchURL = new URL(`/api/s3/${encodeURI(project)}`, document.location.origin);

  if (continuation_token !== undefined) {
    fetchURL.searchParams.append("continuation_token", continuation_token);
  }
  if (max_buckets !== undefined && max_buckets > 0) {
    fetchURL.searchParams.append("max_buckets", max_buckets);
  }

  // Suppress the global auth redirect here: a 401 on this endpoint means
  // this specific project is inaccessible (e.g. suspended in Ceph while
  // still listed by Keystone), not that the user's session is invalid.
  let resp = await GET(fetchURL, undefined, true);
  if (resp.status === 401) {
    return { Buckets: [], inaccessible: true };
  }
  if (resp.status != 200) {
    throw new Error("Failed to retrieve the bucket page.");
  }

  let ret = await resp.json();
  for (const bucket of ret.Buckets) {
    bucket.CreationDate = new Date(bucket.CreationDate);
  }

  if (DEV) console.log(ret);

  return ret;
}

// Proxy CreateBucket command through the backend
export async function awsCreateBucket(
  project,
  bucket,
) {
  let fetchURL = new URL(`/api/s3/${encodeURI(project)}/${encodeURI(bucket)}`, document.location.origin);
  let resp = await PUT(fetchURL);

  return resp;
}

// Update all bucket cors
export async function awsBulkAddBucketCors(
  project,
) {
  let fetchURL = new URL(`/api/s3/${encodeURI(project)}/cors`, document.location.origin);
  let resp = await POST(fetchURL);

  if (resp.status != 204) {
    throw new Error("Failed to fix the bucket cors in all buckets.");
  }
}

// Update CORS for a list of buckets
export async function awsBulkAddBucketListCors(
  project,
  buckets,
) {
  let fetchURL = new URL(`/api/s3/${encodeURI(project)}/cors`, document.location.origin);
  fetchURL.searchParams.append("buckets", buckets.join(";"));

  let resp = await POST(fetchURL);

  if (resp.status != 204) {
    throw new Error("Failed to fix the bucket cors in the listed buckets.");
  }
}

// Update single bucket cors
export async function awsAddBucketCors(
  project,
  bucket,
) {
  let fetchURL = new URL(`/api/s3/${encodeURI(project)}/${bucket}/cors`, document.location.origin);
  let resp = await POST(fetchURL);

  if (resp.status != 204) {
    throw new Error("Failed to fix the bucket cors.");
  }
}
