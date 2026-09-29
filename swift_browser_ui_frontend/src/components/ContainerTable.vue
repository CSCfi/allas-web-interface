<template>
  <!-- Footer options needs to be in CamelCase,
  because csc-ui wont recognise it otherwise. -->
  <c-data-table
    v-if="paginationReady"
    id="container-table"
    data-testid="container-table"
    :data.prop="containers"
    :headers.prop="headers"
    :pagination.prop="disablePagination ? null : paginationOptions"
    :hide-footer="disablePagination"
    :footerOptions.prop="footerOptions"
    :no-data-text="getEmptyText()"
    :sort-by="sortBy"
    :sort-direction="sortDirection"
    external-data
    @paginate="getPage"
    @sort="onSort"
  />
</template>

<script>
import {
  checkIfItemIsLastOnPage,
  getHumanReadableSize,
  getPaginationOptions,
  parseDateTime,
  parseDateFromNow,
  sortObjects,
  truncate,
} from "@/common/tableFunctions";
import {
  mdiTrayArrowDown,
  mdiShareVariantOutline,
  mdiDeleteOutline,
  mdiPail,
  mdiPailPlus,
} from "@mdi/js";
import {
  DEV,
  toggleCopyBucketModal,
  addErrorToastOnMain,
  checkAndAddBucketCors,
  isS3CompatibleBucketName,
} from "@/common/globalFunctions";
import {
  deleteStaleShares,
} from "@/common/share";
import {
  awsDeleteBucket,
  awsDeleteObjects,
  awsListObjects,
  checkBucketEmpty,
  getBucketPublicStatus,
  setBucketPublic,
} from "@/common/s3commands";
import { updatePaginationOptions } from "@/common/idbFunctions";

export default {
  name: "ContainerTable",
  props: {
    conts: {
      type: Array,
      default: () => {return [];},
    },
    showTimestamp: {
      type: Boolean,
      default: false,
    },
    disablePagination: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      containers: [],
      direction: "asc",
      footerOptions: {
        itemsPerPageOptions: [10, 25, 50, 100, 200, 300],
      },
      paginationOptions: {},
      sortBy: "name",
      sortDirection: "asc",
      publicStatus: {},
      publicLinks: {},
      publicBusy: {},
    };
  },
  computed: {
    locale () {
      return this.$i18n.locale;
    },
    active() {
      return this.$store.active;
    },
    newBucket() {
      return this.$store.newBucket;
    },
    paginationReady() {
      return this.disablePagination || !!this.paginationOptions?.itemsPerPage;
    },
  },
  watch: {
    disablePagination() {
      this.getPage();
    },
    conts() {
      if (this.conts.length && this.paginationReady) {
        this.getPage();
      }
    },
    showTimestamp() {
      this.getPage();
    },
    async locale() {
      this.setHeaders();
      await this.setPagination();
      this.getPage();
    },
    "paginationOptions.itemsPerPage": async function (newVal, oldVal) {
      if (oldVal && newVal) {
        await updatePaginationOptions({ itemsPerPage: newVal });
      }
    },
  },
  async created() {
    this.setHeaders();
    await this.setPagination();
  },
  methods: {
    getPage (event) {
      if (!this.paginationReady) {
        return;
      }
      if (this.newBucket) {
        if (event?.detail?.currentPage > 1) {
          // Moving from page 1, remove highlight
          this.$store.setNewBucket("");
        } else {
          // Move to page 1 to highlight new bucket
          this.paginationOptions.currentPage = 1;
        }
      }

      let offset = 0;
      let limit = this.conts?.length;

      if (!this.disablePagination || this.conts?.length > 500) {
        offset =
          this.paginationOptions.currentPage
          * this.paginationOptions.itemsPerPage
          - this.paginationOptions.itemsPerPage;

        limit = this.paginationOptions.itemsPerPage;
      }

      // Access-level suffix: legacy view-only shares get no suffix.
      // Compact R / R+W badge (language-neutral).
      const permLabel = (access) => {
        if (!access?.length) return "";
        return access.includes("w") ? "R+W" : "R";
      };

      const getSharedStatus = (item) => {
        if (item.sharing === "sharing") {
          const labels = [
            ...new Set((item.sharedAccess || []).map(permLabel).filter(Boolean)),
          ];
          return this.$t("message.table.sharing")
            + (labels.length ? ` (${labels.join(", ")})` : "");
        }
        if (item.sharing === "shared") {
          const label = permLabel(item.accessRights);
          return this.$t("message.table.shared") + (label ? ` (${label})` : "");
        }
        return "";
      };

      const mappedContainers = this.conts;
      let containersPage = [];
      sortObjects(mappedContainers, this.sortBy, this.sortDirection);


      if (this.newBucket) {
        const idx = mappedContainers.findIndex(c => c.name === this.newBucket);
        if (idx > 0) {
          mappedContainers.unshift(mappedContainers.splice(idx, 1)[0]);
        }
      }

      const pageItems = mappedContainers.slice(offset, offset + limit);
      this.fetchPublicStatus(pageItems);

      pageItems.map((
        item,
      ) => {
        const isLegacy = !isS3CompatibleBucketName(item.name);
        const tags = [];
        if (isLegacy) {
          tags.push({
            value: this.$t("message.table.legacy_swift"),
            component: {
              tag: "c-tag",
              params: { flat: true, style: { "--c-primary-600": "#b71c1c" } },
            },
          });
        } else if (item.hasSegments) {
          tags.push({
            value: this.$t("message.table.swift"),
            component: { tag: "c-tag", params: { flat: true } },
          });
        }
        const nameChildren = [
          {
            value: "",
            component: {
              tag: "c-icon",
              params: {
                path: mdiPail,
                color: "var(--c-primary-600)",
                size: "18",
              },
            },
          },
          {
            value: truncate(item.name),
            component: {
              tag: "c-link",
              params: {
                href: "javascript:void(0)",
                style: {
                  "--c-link-color": "var(--c-tertiary-700)",
                  "--c-link-hover": "none",
                  marginLeft: "1rem",
                },
                onClick: () => {
                  if(item.owner) {
                    this.$router.push({
                      name: "SharedObjects",
                      params: {
                        container: item.name,
                        owner: item.owner,
                      },
                    });
                  } else {
                    this.$router.push({
                      name: "ObjectsView",
                      params: {
                        container: item.name,
                      },
                    });
                  }
                },
              },
            },
          },
          ...tags,
        ];
        containersPage.push({
          name: {
            value: "",
            children: nameChildren,
          },
          items: {
            value: item.count != null && (item.count > 0 || isS3CompatibleBucketName(item.name))
              ? item.count.toLocaleString(this.locale) : "—",
          },
          size: {
            value: item.bytes != null && (item.bytes > 0 || isS3CompatibleBucketName(item.name))
              ? getHumanReadableSize(item.bytes, this.locale) : "—",
          },
          sharing: {
            value: getSharedStatus(item),
          },
          public: {
            value: null,
            children: [
              {
                key: `pub_toggle_${item.name}_${this.publicStatus[item.name] ? "on" : "off"}`,
                value: null,
                component: {
                  tag: "input",
                  params: {
                    type: "checkbox",
                    class: "public-switch-input",
                    checked: this.publicStatus[item.name] === true,
                    disabled: !!item.owner
                      || !!this.publicBusy[item.name]
                      || this.publicStatus[item.name] == null,
                    onChange: (ev) => {
                      const host = ev?.currentTarget || ev?.target;
                      this.togglePublic(item.name, !!host?.checked);
                    },
                    onInput: (ev) => {
                      const host = ev?.currentTarget || ev?.target;
                      this.togglePublic(item.name, !!host?.checked);
                    },
                  },
                },
              },
              ...(this.publicStatus[item.name] !== true ? [{
                key: `pub_disabled_${item.name}`,
                value: this.$t("message.public.disabled"),
                component: {
                  tag: "span",
                  params: {
                    class: "public-status",
                  },
                },
              }] : []),
              ...(this.publicStatus[item.name] === true && this.publicLinks[item.name] ? [{
                key: `pub_link_${item.name}`,
                value: this.$t("message.public.link"),
                component: {
                  tag: "c-link",
                  params: {
                    class: "public-link",
                    href: this.publicLinks[item.name],
                    target: "_blank",
                    rel: "noopener noreferrer",
                    style: {
                      "--c-link-color": "var(--c-primary-600)",
                    },
                  },
                },
              }] : []),
            ],
          },
          last_activity: {
            value: this.showTimestamp
              ? parseDateTime(this.locale, item.last_modified, this.$t, false)
              : parseDateFromNow(this.locale, item.last_modified, this.$t),
          },
          actions: {
            value: null,
            sortable: null,
            children: [
              {
                value: "",
                component: {
                  tag: "c-button",
                  params: {
                    testid: "download-container",
                    text: true,
                    size: "small",
                    onClick: ({ event }) => {
                      this.handleDownloadClick(
                        item.name,
                        item.owner ? item.owner : "",
                        event.isTrusted,
                      );
                    },
                    target: "_blank",
                    disabled: isLegacy || (
                      item.owner && item.accessRights?.length === 0
                    ),
                  },
                },
                children: [
                  {
                    value: "",
                    component: {
                      tag: "c-icon",
                      params: {
                        path: mdiTrayArrowDown,
                        size: "18",
                      },
                    },
                  },
                  {
                    value: this.$t("message.download.download"),
                    component: {
                      tag: "span",
                    },
                  },
                ],
              },
              // Share button is disabled for Shared (with you) buckets
              {
                value: "",
                component: {
                  tag: "c-button",
                  params: {
                    testid: "share-container",
                    text: true,
                    size: "small",
                    onClick: () =>
                      this.onOpenShareModal(item.name),
                    onKeyUp: (event) => {
                      if(event.keyCode === 13)
                        this.onOpenShareModal(item.name);
                    },
                    disabled: item.owner || isLegacy,
                  },
                },
                children: [
                  {
                    value: "",
                    component: {
                      tag: "c-icon",
                      params: {
                        path: mdiShareVariantOutline,
                        size: "18",
                      },
                    },
                  },
                  {
                    value: this.$t("message.share.share"),
                    component: {
                      tag: "span",
                    },
                  },
                ],
              },
              {
                value: "",
                component: {
                  tag: "c-button",
                  params: {
                    testid: "copy-container",
                    text: true,
                    size: "small",
                    onClick: () => this.handleCopyClick(item.name, item.owner),
                    onKeyUp: (event) => {
                      if (event.keyCode === 13)
                        this.handleCopyClick(item.name, item.owner);
                    },
                    // Legacy view-only shares can't read objects, so a
                    // copy would fail — gate like the download button
                    disabled: !item.bytes || item.hasSegments
                      || (item.owner && item.accessRights?.length === 0),
                  },
                },
                children: [
                  {
                    value: "",
                    component: {
                      tag: "c-icon",
                      params: {
                        path: mdiPailPlus,
                        size: "18",
                      },
                    },
                  },
                  {
                    value: this.$t("message.copy"),
                    component: {
                      tag: "span",
                    },
                  },
                ],
              },
              {
                value: "",
                component: {
                  tag: "c-button",
                  params: {
                    testid: "delete-container",
                    text: true,
                    size: "small",
                    onClick: () => this.handleDeleteClick(item.name),
                    onKeyUp: (event) => {
                      if (event.keyCode === 13)
                        this.handleDeleteClick(item.name);
                    },
                    disabled: item.owner || isLegacy,
                  },
                },
                children: [
                  {
                    value: "",
                    component: {
                      tag: "c-icon",
                      params: {
                        path: mdiDeleteOutline,
                        size: "18",
                      },
                    },
                  },
                  {
                    value: this.$t("message.delete"),
                    component: {
                      tag: "span",
                    },
                  },
                ],
              },
            ],
          },
        });
      });

      this.containers = containersPage;

      this.paginationOptions = {
        ...this.paginationOptions,
        itemCount: mappedContainers.length,
      };
    },
    onSort(event) {
      this.$store.setNewBucket("");

      this.sortBy = event.detail.sortBy;
      this.sortDirection = event.detail.direction;

      this.getPage();
    },
    async fetchPublicStatus(items) {
      // Lazily resolve the public flag for own buckets on the current
      // page only; results are cached for the component's lifetime
      const missing = (items || []).filter(
        (item) => !item.owner && !(item.name in this.publicStatus),
      );
      if (!missing.length) return;

      // Mark as pending so concurrent getPage calls don't refetch
      for (const item of missing) {
        this.publicStatus[item.name] = null;
      }
      await Promise.all(missing.map(async (item) => {
        try {
          const status = await getBucketPublicStatus(item.name);
          this.publicStatus[item.name] = status.public;
          this.publicLinks[item.name] = status.address;
        } catch {
          this.publicStatus[item.name] = false;
        }
      }));
      this.getPage();
    },
    async togglePublic(containerName, nextEnabled) {
      if (!containerName || this.publicBusy[containerName]) return;
      this.publicBusy = { ...this.publicBusy, [containerName]: true };

      const prev = this.publicStatus[containerName] === true;
      this.publicStatus[containerName] = nextEnabled;
      this.getPage();

      try {
        await setBucketPublic(containerName, nextEnabled);
      } catch (e) {
        if (DEV) console.log(e);
        this.publicStatus[containerName] = prev;
        addErrorToastOnMain(this.$t("message.public.updateFail"));
      } finally {
        const rest = { ...this.publicBusy };
        delete rest[containerName];
        this.publicBusy = rest;
        this.getPage();
      }
    },
    setHeaders() {
      this.headers = [

        {
          key: "name",
          value: this.$t("message.table.name"),
          sortable: true,
        },
        {
          key: "items",
          value: this.$t("message.table.items"),
          sortable: true,
        },
        {
          key: "size",
          value: this.$t("message.table.size"),
          sortable: true,
        },
        {
          key: "sharing",
          value: this.$t("message.table.shared_status"),
          sortable: true,
        },
        {
          key: "public",
          value: this.$t("message.public.public"),
          sortable: false,
        },
        {
          key: "last_activity",
          value: this.$t("message.table.activity"),
          sortable: true,
        },
        {
          key: "actions",
          align: "end",
          justify: "end",
          value: null,
          sortable: false,
          ariaLabel: "test",
        },
      ];
    },
    setPagination: async function () {
      const paginationOptions = await getPaginationOptions(this.$t);
      this.paginationOptions = paginationOptions;
    },
    ensureBucketState: async function (bucket, shouldBeEmpty, errorMsg) {
      // There is no CORS check on bucket list fetch, only share sync
      // Make sure it is in place before fetching objects
      await checkAndAddBucketCors(this.active.id, bucket);
      const isEmpty = await checkBucketEmpty(bucket);
      if (isEmpty === shouldBeEmpty) {
        return true;
      }
      addErrorToastOnMain(errorMsg);
      return false;
    },
    handleDeleteClick: function (bucket) {
      this.$store.toggleDeleteModal(true);
      this.$store.setDeletableObjects([
        { name: bucket, isContainer: true },
      ]);
    },
    handleDownloadClick: async function(container, owner, eventTrusted) {
      // Don't attempt to download an empty bucket
      const bucketHasContent = await this.ensureBucketState(
        container, false, this.$t("message.container_ops.downloadNotEmpty"));
      if (!bucketHasContent) return;

      //add test param to test direct downloads
      //by using origin private file system (OPFS)
      //automated testing creates untrusted events
      const test = eventTrusted === undefined ? false : !eventTrusted;

      this.$store.s3download.addDownload(
        container,
        [],
        owner,
        test,
      ).then(() => {
        if (DEV) console.log(`Started downloading all objects from container ${container}`);
      }).catch(() => {
        addErrorToastOnMain(this.$t("message.download.error"));
      });
    },
    getEmptyText() {
      if (this.$route.name == "SharedFrom") {
        return this.$t("message.emptyProject.sharedFrom");
      }

      if (this.$route.name == "SharedTo") {
        return this.$t("message.emptyProject.sharedTo");
      }

      return this.$t("message.emptyProject.all");
    },
    onOpenShareModal(itemName) {
      this.$store.toggleShareModal(true);
      this.$store.setBucketName(itemName);
    },
    handleCopyClick: async function(bucket, owner) {
      // Don't attempt to copy an empty bucket
      const bucketHasContent = await this.ensureBucketState(
        bucket, false, this.$t("message.container_ops.copyNotEmpty"));
      if (!bucketHasContent) return;

      owner
        ? toggleCopyBucketModal(bucket, owner)
        : toggleCopyBucketModal(bucket);
    },
  },
};
</script>
