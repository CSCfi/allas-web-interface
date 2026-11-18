//bucket that the UI can't list, e.g. due to a bucket policy

// The bucket list and the object listing of a test bucket are stubbed,
// so no real bucket or bucket policy is needed.
// Name sorts last, so the bucket list pagination marker ends the listing.
const BUCKET = "zzz-cy-unavailable";

// GET /api/{project}, not /api/username or /api/projects
const BUCKET_LIST = /\/api\/(?!(?:username|projects)(?:\?|$))[^/?]+(?:\?.*)?$/;
const BUCKET_LISTING = new RegExp(`/api/[^/]+/${BUCKET}(?:\\?.*)?$`);
const BUCKET_META = new RegExp(`/api/meta/[^/]+/${BUCKET}(?:\\?.*)?$`);

const OBJECT = {
  name: "keep.txt",
  bytes: 10,
  hash: "d41d8cd98f00b204e9800998ecf8427e",
  content_type: "text/plain",
  last_modified: "2026-11-18T10:00:00.000000",
};

function stubBucket(count) {
  cy.intercept({ method: "GET", url: BUCKET_LIST }, (req) => {
    req.reply(req.url.includes("marker=") ? [] : [{
      name: BUCKET,
      count,
      bytes: count * OBJECT.bytes,
      last_modified: OBJECT.last_modified,
    }]);
  });
  cy.intercept({ method: "GET", url: BUCKET_META }, (req) => {
    req.reply(req.url.includes("objects=") ? [] : [BUCKET, {}]);
  });
}

function stubListing(status, objects = []) {
  // newer intercepts take precedence, so this replaces the previous stub
  cy.intercept({ method: "GET", url: BUCKET_LISTING }, (req) => {
    if (status !== 200) {
      req.reply({ statusCode: status, body: "" });
    } else {
      req.reply(req.url.includes("marker=") ? [] : objects);
    }
  }).as("listing");
}

function visitAndLogin() {
  //skip the cookie consent dialog, it covers the login button
  cy.visit(Cypress.config("baseUrl"), {
    onBeforeLoad(win) {
      win.localStorage.setItem("cookiesAcknowledged", "true");
    },
  });
  cy.login(Cypress.env("username"), Cypress.env("password"));
}

describe("Bucket that the UI can't list", function () {
  beforeEach(() => {
    cy.deleteDB();
  });

  it("is labelled Unavailable without redirecting to /forbid", () => {
    stubBucket(1);
    stubListing(403);
    visitAndLogin();
    cy.wait("@listing");

    cy.get("c-data-table")
      .contains("c-status", "Unavailable")
      .should("exist");
    cy.location("pathname").should("not.include", "forbid");

    //open the bucket, the reason is shown instead of an empty bucket
    cy.get("c-data-table").contains(BUCKET).click();
    cy.contains("The web interface can't access this bucket")
      .should("exist");
  });

  it("keeps the label when listing fails, clears it when listing works", () => {
    stubBucket(1);
    stubListing(403);
    visitAndLogin();
    cy.wait("@listing");
    cy.get("c-data-table")
      .contains("c-status", "Unavailable")
      .should("exist");

    //a server error must not clear the label
    stubListing(500);
    cy.reload();
    cy.wait("@listing");
    //let the UI handle the failed listing before checking
    cy.wait(3000);
    cy.get("c-data-table").contains(BUCKET).should("exist");
    cy.get("c-data-table")
      .contains("c-status", "Unavailable")
      .should("exist");

    //listing works again, the label goes away
    stubListing(200, [OBJECT]);
    cy.reload();
    cy.wait("@listing");
    cy.get("c-data-table").contains(BUCKET).should("exist");
    cy.get("c-data-table")
      .contains("c-status", "Unavailable")
      .should("not.exist");
  });

  it("keeps cached objects when listing fails", () => {
    stubBucket(1);
    stubListing(200, [OBJECT]);
    visitAndLogin();

    //open the bucket so its object is listed and cached
    cy.get("c-data-table").contains(BUCKET).click();
    cy.get("[data-testid='object-table']")
      .contains(OBJECT.name)
      .should("exist");

    //changed count makes the UI list the bucket again, which fails
    stubBucket(2);
    stubListing(500);
    cy.reload();
    cy.wait("@listing");
    //let the UI handle the failed listing before checking
    cy.wait(3000);

    cy.get("[data-testid='object-table']")
      .contains(OBJECT.name)
      .should("exist");
  });
});
