//container

describe("Create a container", function () {
  beforeEach(() => {
    cy.task("resetDB");
    cy.deleteDB();
    cy.visit(Cypress.config("baseUrl"));
    cy.login(Cypress.env("username"), Cypress.env("password"));
  });

  it("Creates a container with a random unique name and deletes it", () => {
    //create a unique name
    const bucketName = Math.random().toString(36).substring(2, 7);

    // add new bucket with a unique name and show it
    cy.addbucket(bucketName);
    cy.wait(3000);

    //check the bucket exists with search field
    cy.searchbucket(bucketName);
    cy.get("[data-testid='search-result']")
      .contains(bucketName)
      .should("exist");

    //then delete container
    cy.deletebucket(bucketName);
    cy.wait(1000);

    cy.get("[data-testid='container-toasts']")
      .find("c-toast")
      .should("have.class", "success");

    //check it was deleted
    cy.reload();
    cy.wait(3000);
    cy.contains(bucketName).should("not.exist");
  });

  it("Several containers with different names are created and visible", function () {
    //create two buckets
    const nameOne = Math.random().toString(36).substring(2, 7);
    const nameTwo = Math.random().toString(36).substring(2, 7);

    cy.addbucket(nameOne);
    cy.wait(3000);

    //check the bucket 1 exists with search field
    cy.searchbucket(nameOne);
    cy.wait(3000);
    cy.get("[data-testid='search-result']").contains(nameOne).should("exist");

    cy.addbucket(nameTwo);
    cy.reload();
    cy.wait(3000);

    //check the bucket 2 exists with search field
    cy.searchbucket(nameTwo);
    cy.wait(3000);
    cy.get("[data-testid='search-result']").contains(nameTwo).should("exist");

    //check there are multiple buckets in the project
    cy.get("[data-testid='container-table']")
      .find("c-link")
      .should("have.length.gte", 2); //check
  });

  it("Creating more than 1 container with the same name is not possible in a project", () => {
    cy.visit(Cypress.config().baseUrl);
    cy.login(Cypress.env("username"), Cypress.env("password"));

    //create a unique name
    const bucketName = Math.random().toString(36).substring(2, 7);

    // add new bucket with a unique name and show it
    cy.addbucket(bucketName);
    cy.wait(3000);

    cy.addbucket(bucketName);

    //bucket name input field should have a validation error
    cy.get("#error-newbucket-input_1").should("be.visible");
  });
});
