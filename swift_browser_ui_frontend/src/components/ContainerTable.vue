<template>
  <!-- Footer options needs to be in CamelCase,
  because csc-ui wont recognise it otherwise. -->
  <c-data-table
    id="container-table"
    data-testid="container-table"
    :data.prop="containers"
    :headers.prop="hideTags ?
      headers.filter(header => header.key !== 'tags'): headers"
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
  getHumanReadableSize,
  truncate,
  sortObjects,
  parseDateTime,
  parseDateFromNow,
  deleteStaleSharedContainers,
  DEV,
} from "@/common/conv";
import {
  mdiTrayArrowDown,
  mdiShareVariantOutline,
  mdiDotsHorizontal,
  mdiPail,
} from "@mdi/js";
import {
  toggleEditTagsModal,
  getSharingContainers,
  getSharedContainers,
  getAccessDetails,
  getPaginationOptions,
  toggleCopyFolderModal,
  checkIfItemIsLastOnPage,
  addErrorToastOnMain,
  toggleDeleteModal,
} from "@/common/globalFunctions";
import {
  setPrevActiveElement,
  disableFocusOutsideModal,
} from "@/common/keyboardNavigation";
import { toRaw } from "vue";
import {
  getObjects,
  swiftDeleteContainer,
  swiftDeleteObjects,
  removeAccessControlMeta,
} from "@/common/api";

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
    hideTags: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      containers: [],
      sharingContainers: [],
      sharedContainers: [],
      direction: "asc",
      footerOptions: {
        itemsPerPageOptions: [5, 10, 25, 50, 100],
      },
      paginationOptions: {},
      sortBy: "name",
      sortDirection: "asc",
      abortController: null,
    };
  },
  computed: {
    locale () {
      return this.$i18n.locale;
    },
    active() {
      return this.$store.state.active;
    },
    sharingUpdated () {
      return this.$store.state.sharingUpdated;
    },
  },
  watch: {
    disablePagination() {
      this.getPage();
    },
    hideTags() {
      this.getPage();
    },
    conts() {
      Promise.all([this.getSharingContainers(), this.getSharedContainers()])
        .then(() => this.getPage());
    },
    showTimestamp() {
      this.getPage();
    },
    locale() {
      this.setHeaders();
      this.getPage();
      this.setPagination();
    },
    sharingUpdated() {
      if (this.sharingUpdated) {
        this.getSharingContainers().then(() => this.getPage());
        this.$store.commit("setSharingUpdated", false);
      }
    },
  },
  created() {
    this.abortController = new AbortController();
    this.setHeaders();
    this.setPagination();
    Promise.all([this.getSharingContainers(), this.getSharedContainers()]);
  },
  beforeMount () {
  },
  beforeUnmount () {
    this.abortController.abort();
  },
  expose: ["toFirstPage"],
  methods: {
    toFirstPage() {
      this.paginationOptions.currentPage = 1;
    },
    async getSharingContainers () {
      try {
        this.sharingContainers =
          await getSharingContainers(this.active.id, this.abortController.signal);
        this.$store.commit("setSharingContainers", this.sharingContainers);
      } catch (e) {
        if (e?.name !== "AbortError") throw e;
      }
    },
    async getSharedContainers () {
      try {
        this.sharedContainers =
          await getSharedContainers(this.active.id, this.abortController.signal);
        this.$store.commit("setSharedContainers", this.sharedContainers);
      } catch (e) {
        if (e?.name !== "AbortError") throw e;
      }
    },
    async getPage () {
      let offset = 0;
      let limit = this.conts?.length;

      if (!this.disablePagination || this.conts?.length > 500) {
        offset =
          this.paginationOptions.currentPage
          * this.paginationOptions.itemsPerPage
          - this.paginationOptions.itemsPerPage;

        limit = this.paginationOptions.itemsPerPage;
      }

      const getSharedStatus = (folderName) => {
        if (this.sharingContainers.indexOf(folderName) > -1) {
          return this.$t("message.table.sharing");
        } else if (this.sharedContainers.findIndex(
          cont => cont.container === folderName) > -1) {
          return this.$t("message.table.shared");
        }
        return "";
      };

      // Filter out segment folders for rendering
      // Map the 'accessRights' to the container if it's a shared container
      const mappedContainers = await Promise.all(
        this.conts.filter(cont => !cont.name.endsWith("_segments"))
          .map(async(cont) => {
            const sharedDetails = cont.owner ? await getAccessDetails(
              this.$route.params.project,
              cont.name,
              cont.owner,
              this.abortController.signal) : null;
            const accessRights = sharedDetails ? sharedDetails.access : null;
            return sharedDetails && accessRights
              ? {...cont, accessRights} : {...cont};
          }));

      this.containers = mappedContainers
        .slice(offset, offset + limit).reduce((
          items,
          item,
        ) => {
          items.push({
            name: {
              value: truncate(item.name),
              component: {
                tag: "c-link",
                params: {
                  href: "javascript:void(0)",
                  color: "dark-grey",
                  path: mdiPail,
                  iconFill: "primary",
                  iconStyle: {
                    marginRight: "1rem",
                    flexShrink: "0",
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
            items: {
              value: item.count,
            },
            size: {
              value: getHumanReadableSize(item.bytes, this.locale),
            },
            ...(this.hideTags ? {} : {
              tags: {
                value: null,
                children: [
                  ...(item.tags?.length ?
                    item.tags.map((tag, index) => ({
                      key: "tag_" + index + "",
                      value: tag,
                      component: {
                        tag: "c-tag",
                        params: {
                          flat: true,
                        },
                      },
                    })) : [{ key: "no_tags", value: "-" }]),
                ],
              },
            }),
            sharing: {
              value: getSharedStatus(item.name),
            },
            last_activity: {
              value: this.showTimestamp? parseDateTime(
                this.locale, item.last_modified, this.$t, false) :
                parseDateFromNow(this.locale, item.last_modified, this.$t),
            },
            actions: {
              value: null,
              sortable: null,
              align: "end",
              children: [
                {
                  value: this.$t("message.download.download"),
                  component: {
                    tag: "c-button",
                    params: {
                      testid: "download-container",
                      text: true,
                      size: "small",
                      title: this.$t("message.download.download"),
                      onClick: ({ event }) => {
                        this.beginDownload(
                          item.name,
                          item.owner ? item.owner : "",
                          event.isTrusted,
                        );
                      },
                      target: "_blank",
                      path: mdiTrayArrowDown,
                      disabled: (item.owner && item.accessRights?.length === 0)
                        || !item.bytes,
                    },
                  },
                },
                // Share button is disabled for Shared (with you) Folders
                {
                  value: this.$t("message.share.share"),
                  component: {
                    tag: "c-button",
                    params: {
                      testid: "share-container",
                      text: true,
                      size: "small",
                      title: this.$t("message.share.share"),
                      path: mdiShareVariantOutline,
                      onClick: () =>
                        this.onOpenShareModal(item.name),
                      onKeyUp: (event) => {
                        if(event.keyCode === 13)
                          this.onOpenShareModal(item.name, true);
                      },
                      disabled: item.owner,
                    },
                  },
                },
                {
                  value: null,
                  component: {
                    tag: "c-menu",
                    params: {
                      items: [
                        {
                          name: this.$t("message.copy"),
                          action: () => {
                            this.openCopyFolderModal(item.name, item.owner);
                            const menuItems = document
                              .querySelector("c-menu-items");
                            menuItems.addEventListener("keydown", (e) =>{
                              if (e.keyCode === 13) {
                                this.openCopyFolderModal(
                                  item.name, item.owner, true,
                                );
                              }
                            });
                          },
                          disabled: !item.bytes,
                        },
                        {
                          name: this.$t("message.editTags"),
                          action: () => {
                            this.openEditTagsModal(item.name);
                            const menuItems = document
                              .querySelector("c-menu-items");
                            menuItems.addEventListener("keydown", (e) =>{
                              if (e.keyCode === 13) {
                                this.openEditTagsModal(item.name, true);
                              }
                            });
                          },
                          disabled: item.owner,
                        },
                        {
                          name: this.$t("message.delete"),
                          action: () => this.delete(
                            item.name, item.count,
                          ),
                          disabled: item.owner,
                        },
                      ],
                      customTrigger: {
                        value: this.$t("message.options"),
                        component: {
                          tag: "c-button",
                          params: {
                            text: true,
                            path: mdiDotsHorizontal,
                            title: this.$t("message.options"),
                            size: "small",
                            disabled: (item.owner &&
                              (item.accessRights?.length === 0 ||
                                !item.bytes)),
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          });

          return items;
        }, []);

      this.paginationOptions = {
        ...this.paginationOptions,
        itemCount: mappedContainers.length,
      };
    },
    async onSort(event) {
      this.$store.commit("setNewFolder", "");

      this.sortBy = event.detail.sortBy;
      this.sortDirection = event.detail.direction;

      if (this.sortBy === "sharing") {
        let allSharing = this.conts.map(x =>
          this.sharingContainers.includes(x.name)
            ? this.$t("message.table.sharing") : "");
        let allShared = this.conts.map(x =>
          this.sharedContainers.some(cont => cont.container === x.name)
            ? this.$t("message.table.shared") : "");

        let combined = allSharing.map((value, idx) =>
          value !== "" ? value : allShared[idx]);
        this.conts.forEach((cont, idx) => (cont.sharing = combined[idx]));
      }

      // Use toRaw to mutate the original array, not the proxy
      sortObjects(toRaw(this.conts), this.sortBy, this.sortDirection);
      this.getPage();
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
          key: "tags",
          value: this.$t("message.table.tags"),
          sortable: true,
        },
        {
          key: "sharing",
          value: this.$t("message.table.shared_status"),
          sortable: true,
        },
        {
          key: "last_activity",
          value: this.$t("message.table.activity"),
          sortable: true,
        },
        {
          key: "actions",
          align: "end",
          value: null,
          sortable: false,
          ariaLabel: "test",
        },
      ];
    },
    setPagination: function () {
      const paginationOptions = getPaginationOptions(this.$t);
      this.paginationOptions = paginationOptions;
    },
    delete: async function (container, objects) {
      if (objects > 0) { //if bucket not empty
        // open modal with all objects for confirmation
        toggleDeleteModal([
          { name: container, container: container, isContainer: true },
        ]);
        return; // nothing deleted yet
      }

      const projectID = this.$route.params.project;
      swiftDeleteContainer(
        projectID,
        container,
      ).then(async() => {
        /*
            In case the upload was initially cancelled and
            regular container has no uploaded objects yet (0 item), but
            segment container does have, we need to check and delete
            segment objects first before deleting the segment container
          */
        const segment_objects =  await getObjects(
          projectID,
          `${container}_segments`,
        );

        // Delete segment objects if they exist
        if(segment_objects && segment_objects.length) {
          await swiftDeleteObjects(
            projectID,
            `${container}_segments`,
            segment_objects.map(obj => obj.name),
          );
        }

        // Delete segment bucket if it exists
        try {
          await swiftDeleteContainer(projectID, `${container}_segments`);
        } catch (e) {}

        // Show success message
        document.querySelector("#container-toasts").addToast(
          { progress: false,
            type: "success",
            message: this.$t("message.container_ops.deleteSuccess")},
        );

        this.$emit("delete-container", container);

        // Remove access control metadata if it was a shared container
        try {
          const sharedDetails = await this.$store.state.client.getShareDetails(
            projectID,
            container,
          );

          if (sharedDetails?.length) {
            await removeAccessControlMeta(projectID, container);
            await deleteStaleSharedContainers(this.$store);
          }
        } catch (e) {}

        this.paginationOptions.currentPage =
          checkIfItemIsLastOnPage({
            currentPage:
              this.paginationOptions.currentPage,
            itemsPerPage:
              this.paginationOptions.itemsPerPage,
            itemCount:
              this.paginationOptions.itemCount - 1,
          });
      })
        .catch(() => {
          addErrorToastOnMain(
            this.$t("message.container_ops.deleteFail") || "Delete failed",
          );
        });
    },
    beginDownload(container, owner, eventTrusted) {
      //add test param to test direct downloads
      //by using origin private file system (OPFS)
      //automated testing creates untrusted events
      const test = eventTrusted === undefined ? false : !eventTrusted;

      const MAX_DOWNLOAD_SIZE = 5 * 1024 * 1024 * 1024; // 5GiB in bytes

      // Find the container details to check its size
      const containerData = this.conts.find(cont => cont.name === container);

      if (containerData && containerData.bytes > MAX_DOWNLOAD_SIZE) {
        addErrorToastOnMain(this.$t("message.download.errorSizeExceeded"));
        return;
      }

      this.$store.state.socket.addDownload(
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
    onOpenShareModal(itemName, keypress) {
      this.$store.commit("toggleShareModal", true);
      this.$store.commit(
        "setFolderName", itemName);

      if (keypress) {
        setPrevActiveElement();
        const shareModal = document.getElementById("share-modal");
        disableFocusOutsideModal(shareModal);
      }
      setTimeout(() => {
        const shareIDsInput = document.getElementById("share-ids")?.children[0];
        shareIDsInput.focus();
      }, 300);
    },
    openEditTagsModal(itemName, keypress) {
      toggleEditTagsModal(null, itemName);
      if (keypress) {
        setPrevActiveElement();
        const editTagsModal = document.getElementById("edit-tags-modal");
        disableFocusOutsideModal(editTagsModal);
      }
      setTimeout(() => {
        const editTagsInput = document.getElementById("edit-tags-input")
          ?.children[0];
        editTagsInput.focus();
      }, 300);
    },
    openCopyFolderModal(itemName, itemOwner, keypress) {
      itemOwner
        ? toggleCopyFolderModal(itemName, itemOwner)
        : toggleCopyFolderModal(itemName);
      if (keypress) {
        setPrevActiveElement();
        const copyFolderModal = document.getElementById("copy-folder-modal");
        disableFocusOutsideModal(copyFolderModal);
      }
      setTimeout(() => {
        const copyFolderInput = document
          .querySelector("#new-copy-folderName input");
        copyFolderInput.focus();
      }, 300);
    },
  },
};
</script>
