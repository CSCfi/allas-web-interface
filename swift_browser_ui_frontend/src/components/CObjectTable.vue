<template>
  <div class="object-table-wrapper">
    <!-- Footer options needs to be in CamelCase,
    because csc-ui wont recognise it otherwise. -->
    <c-data-table
      id="obj-table"
      data-testid="object-table"
      :data.prop="objects"
      :headers.prop="hideTags ?
        headers.filter(header => header.key !== 'tags'): headers"
      :pagination.prop="disablePagination ? null : paginationOptions"
      :hide-footer="disablePagination"
      :footerOptions.prop="footerOptions"
      :no-data-text="noDataText"
      :sort-by="sortBy"
      :sort-direction="sortDirection"
      selection-property="name"
      external-data
      :selectable="selectable"
      @selection="handleSelection"
      @paginate="getPage"
      @sort="onSort"
    />
    <c-loader v-show="isLoaderVisible">
      {{ $t('message.upload.uploadedItems') }}
    </c-loader>
  </div>
</template>

<script>
import {
  sortItems,
  parseDateTime,
  parseDateFromNow,
  getHumanReadableSize,
  DEV,
  makeGetObjectsMetaURL,
} from "@/common/conv";

import {
  toggleEditTagsModal,
  isFile,
  getFolderName,
  getPrefix,
  getPaginationOptions,
  checkIfItemIsLastOnPage,
  addErrorToastOnMain,
  toggleObjectInfoModal,
} from "@/common/globalFunctions";
import {
  setPrevActiveElement,
  disableFocusOutsideModal,
} from "@/common/keyboardNavigation";
import {
  mdiTrayArrowDown,
  mdiPencilOutline,
  mdiDeleteOutline,
  mdiFolder,
  mdiFileOutline,
  mdiInformationOutline,
  mdiEyeOutline,
} from "@mdi/js";

import { getObjectsMeta } from "@/common/api";
import { DateTime } from "luxon";

export default {
  name: "CObjectTable",
  props: {
    objs: {
      type: Array,
      default: () => [],
    },
    disablePagination: {
      type: Boolean,
      default: false,
    },
    hideTags: {
      type: Boolean,
      default: false,
    },
    renderFolders: {
      type: Boolean,
      default: true,
    },
    showTimestamp: {
      type: Boolean,
      default: false,
    },
    accessRights: {
      type: Array,
      default: () => [],
    },
    breadcrumbClickedProp: {
      type: Boolean,
      default: false,
    },
    noDataText: {
      type: String,
      default: "",
    },
  },
  data() {
    return {
      currentDownload: undefined,
      objects: [],
      footerOptions: {
        itemsPerPageOptions: [5, 10, 25, 50, 100],
      },
      paginationOptions: {},
      sortBy: "name",
      sortDirection: "asc",
    };
  },
  computed: {
    container () {
      return this.$route.params.container;
    },
    prefix () {
      return this.$route.query.prefix;
    },
    locale () {
      return this.$i18n.locale;
    },
    active () {
      return this.$store.state.active;
    },
    selectable () {
      return this.$route.name !== "SharedObjects"
        || this.accessRights.length === 2;
    },
    isLoaderVisible() {
      return this.$store.state.isLoaderVisible
        && this.$store.state.uploadFolder.name === this.container;
    },
    owner() {
      return this.$route.params.owner;
    },
    isSharedContainer() {
    const container = this.$route.params.container;
    if (this.$route.params.owner) return true; // browsing someone else’s bucket
    const sharedToMe = (this.$store.state.sharedContainers || [])
      .some(c => c.container === container); // check if container is in shared containers
    const sharedOut = (this.$store.state.sharingContainers || [])
      .includes(container); // check if container is being shared out
    return sharedToMe || sharedOut;
  },
  },
  watch: {
    prefix() {
      this.getPage();
    },
    locale() {
      this.setHeaders();
      this.setPagination();
    },
  },
  created() {
    this.setHeaders();
    this.setPagination();
  },
  beforeUpdate() {
    this.getPage();
    if(this.breadcrumbClickedProp) this.paginationOptions.currentPage = 1;
  },
  mounted() {
    window.addEventListener("popstate", this.handlePopState);
  },
  beforeUnmount() {
    window.removeEventListener("popstate", this.handlePopState);
  },
  updated(){
    this.paginationOptions.currentPage =
      checkIfItemIsLastOnPage(this.paginationOptions);
  },
  methods: {
    normalizeHeaders(metaHeaders) {
      const h = metaHeaders || {};
      return Object.fromEntries(Object.entries(h).map(([k, v]) => [String(k).toLowerCase(), v]));
    },
    async buildInfoForItem(item) {
      const isFolder = !!item?.subfolder;

      const base = {
        name: this.renderFolders ? getFolderName(item.name, this.$route) : item.name,
        fullPath: `${this.container}/${item.name}`,
        sizeHuman: getHumanReadableSize(Number(item.bytes) || 0, this.locale),
        itemCount: isFolder ? item.itemCount ?? "-" : undefined,
        lastModified: item.last_modified
          ? parseDateTime(this.locale, item.last_modified, this.$t, false)
          : "-",
        contentType: item.content_type || item.type || (isFolder ? "application/x-directory" : "-"),
        created: "-",
        etag: item.etag || "-",
        checksum: "-",
        meta: {},
        isFolder,
      };

      if (isFolder) return base;

      const projectID = this.owner || this.active?.id;
      const container = this.container;
      const objects = [item.name];

      const url = makeGetObjectsMetaURL(projectID, container, [...objects]);
      if (this.owner) url.searchParams.append("owner", this.owner);

      const meta = await getObjectsMeta(projectID, container, objects, url);
      const headers = meta?.[0]?.[1] || {};
      const lower = this.normalizeHeaders(headers);

      const contentType =
        lower["content-type"] ||
        lower["x-object-meta-content-type"] ||
        base.contentType;

      const lastMod =
        lower["last-modified"] ||
        item.last_modified ||
        "";

      const ts = lower["x-timestamp"] || lower["x-object-meta-created"] || "";
      let created = "-";
      if (ts && !Number.isNaN(Number(ts))) {
        created = parseDateTime(
          this.locale,
          DateTime.fromSeconds(Number(ts)).toISO(),
          this.$t,
          false
        );
      }

      const etag = (lower["etag"] || "").replaceAll('"', "") || base.etag;

      const checksum =
        lower["x-object-meta-sha256"] ||
        lower["x-object-meta-checksum"] ||
        "-";

      const customMeta = {};
      for (const [k, v] of Object.entries(lower)) {
        if (k.startsWith("x-object-meta-")) customMeta[k] = v;
      }

      return {
        ...base,
        contentType,
        lastModified: lastMod
          ? parseDateTime(this.locale, lastMod, this.$t, false)
          : base.lastModified,
        created,
        etag,
        checksum,
        meta: customMeta,
      };
    },
    async onOpenInfoModal(item, keypress) {
      try {
        const info = await this.buildInfoForItem(item);
        toggleObjectInfoModal(info, this.container);

        if (keypress) {
          setPrevActiveElement();
          const modal = document.getElementById("object-info-modal");
          disableFocusOutsideModal(modal);
        }
      } catch (e) {
        addErrorToastOnMain(this.$t("message.objects.metaFetchFailed") || "Failed to fetch object metadata.");
      }
    },
    handlePopState(event) {
      // reset page to 1 after reversing a page
      if (event.type === "popstate") {
        this.paginationOptions.currentPage = 1;
      }
    },
    changeFolder(folder) {
      this.paginationOptions.currentPage = 1;
      const base = getPrefix(this.$route) || "";
      const next = `${base}${folder}`.replace(/\/?$/, "/");
      this.$router.push({
        name: this.$route.name,
        params: this.$route.params,
        query: { ...this.$route.query, page: 1, prefix: next },
      });
    },
    formatItem: function (item) {
      const name = this.renderFolders ?
        getFolderName(item.name, this.$route)
        : item.name;

      return {
        name: {
          value: name,
          ...(item?.subfolder ? {
            component: {
              tag: "c-link",
              params: {
                href: "javascript:void(0)",
                color: "dark-grey",
                path: mdiFolder,
                iconFill: "primary",
                iconStyle: {
                  marginRight: "1rem",
                  flexShrink: "0",
                },
                onClick: () => this.changeFolder(name),
              },
            },
          } : {
            value: name,
            component: {
              tag: "c-link",
              params: {
                href: "javascript:void(0)",
                color: "dark-grey",
                path: mdiFileOutline,
                iconFill: "primary",
                iconStyle: {
                  marginRight: "1rem",
                  flexShrink: "0",
                },
              },
            },
          }),
        },
        size: {
          value: getHumanReadableSize(Number(item.bytes) || 0, this.locale)
        },
        last_modified: {
          value: this.showTimestamp? parseDateTime(
            this.locale, item.last_modified, this.$t, false) :
            parseDateFromNow(this.locale, item.last_modified, this.$t),
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
                  testid: "download-object",
                  text: true,
                  size: "small",
                  title: "Download",
                  path: mdiTrayArrowDown,
                  onClick: ({ event }) => {
                    const isSharedRoute = !!this.$route.params.owner;
                    const isFolder = !!item?.subfolder;
                    const hasNonAscii = /[^\x20-\x7E]/.test(item.name);
                    const hasSpaceOrTab = /[ \t]/.test(item.name);
                    const hasNonAsciiBucket = /[^\x20-\x7E]/.test(this.container);
                    const hasSpaceOrTabBucket = /[ \t]/.test(this.container);
                    const hasUnsafeUrlChars = /[^A-Za-z0-9\-._~\/]/.test(item.name);


                    const needsProxy =
                      isSharedRoute ||
                      this.isSharedContainer ||
                      isFolder ||
                      hasNonAscii ||
                      hasSpaceOrTab ||
                      hasNonAsciiBucket ||
                      hasSpaceOrTabBucket ||
                      hasUnsafeUrlChars;

                    if (needsProxy) {
                      this.beginDownload(item, event.isTrusted); // proxy path
                    } else {
                      this.navDownload(item.url); // TempURL path
                    }
                  },
                  disabled: this.owner != undefined &&
                    this.accessRights.length === 0,
                },
              },
            },
            {
              value: this.$t("message.objects.info") || "Info",
              component: {
                tag: "c-button",
                params: {
                  testid: "object-info",
                  text: true,
                  size: "small",
                  title: "Info",
                  path: mdiInformationOutline,
                  onClick: () => this.onOpenInfoModal(item),
                  onKeyUp: (event) => {
                    if (event.keyCode === 13) this.onOpenInfoModal(item, true);
                  },
                  disabled: this.owner != undefined && this.accessRights.length === 0,
                },
              },
            },
            {
              value: this.$t("message.objects.preview") || "Preview",
              component: {
                tag: "c-button",
                params: {
                  testid: "object-preview",
                  text: true,
                  size: "small",
                  title: "Preview",
                  path: mdiEyeOutline,
                  disabled: true, // Preview not implemented yet
                  onClick: () => {},
                },
              },
            },
            {
              value: this.$t("message.table.editTags"),
              component: {
                tag: "c-button",
                params: {
                  testid: "edit-object-tags",
                  text: true,
                  size: "small",
                  title: "Edit tags",
                  path: mdiPencilOutline,
                  onClick: () =>
                    this.onOpenEditTagsModal(item.name),
                  onKeyUp: (event) => {
                    if(event.keyCode === 13) {
                      this.onOpenEditTagsModal(item.name, true);
                    }
                  },
                  disabled: item?.subfolder ||
                    (this.owner != undefined && this.accessRights.length <= 1),
                },
              },
            },
            {
              value: this.$t("message.delete"),
              component: {
                tag: "c-button",
                params: {
                  testid: "delete-object",
                  text: true,
                  size: "small",
                  title: "Delete object",
                  path: mdiDeleteOutline,
                  onClick: () => {
                    this.$emit("delete-object", item);
                  },
                  onKeyUp: (event) => {
                    if(event.keyCode === 13) {
                      this.$emit("delete-object", item, true);
                    }
                  },
                  disabled:
                    this.owner != undefined && this.accessRights.length <= 1,
                },
              },
            },
          ],
        },
      };
    },

    getPage: function () {
      let offset = 0;
      let limit = this.objs.length;
      if (!this.disablePagination || this.objs.length > 500) {
        offset =
          this.paginationOptions.currentPage
          * this.paginationOptions.itemsPerPage
          - this.paginationOptions.itemsPerPage;

        limit = this.paginationOptions.itemsPerPage;
      }

      // Filter objects by prefix
      const prefix = getPrefix(this.$route);
      const filteredObjs = this.objs
        .filter(obj => obj.name.startsWith(prefix))
        .filter(obj => obj.name !== prefix);


      const p = this.$route.query.prefix || "";
      if (p && !this.$store.state.openDeleteModal &&
          !this.objs.some(o => o.name === p || o.name.startsWith(p))) {
        let up = p.replace(/[^/]+\/?$/, "");
        if (up && !up.endsWith("/")) up += "/";
        this.$router.replace({
          query: { ...this.$route.query, prefix: up || undefined }
        });
      }


      let pagedLength = 0;

      this.objects = filteredObjs.reduce((items, item) => {
        if (isFile(item.name, this.$route) || !this.renderFolders) {
          items.push(item);
        } else {
          let subName = getFolderName(item.name, this.$route);
          //check if subfolder already added
          if (items.find(el => getFolderName(el.name, this.$route)
            === subName)) {
            return items;
          } else {
            //filter objs that would belong to subfolder
            let subfolderObjs = filteredObjs.filter(obj => {
              if (getFolderName(obj.name, this.$route) ===
                subName) {
                return obj;
              }
            });
            //sort by latest last_modified
            subfolderObjs.sort((a, b) => sortItems(
              a, b, "last_modified", "desc"));
            const subSize = subfolderObjs.reduce((sum, obj) => {
              return sum += obj.bytes;
            }, 0);
            const fullSubName = getPrefix(this.$route) + subName + "/";
            //add new subfolder
            const subfolder = {
              container: item.container,
              name: fullSubName,
              bytes: subSize,
              last_modified: subfolderObjs[0].last_modified,
              tags: [],
              subfolder: true,
              itemCount: subfolderObjs.length,
            };
            items.push(subfolder);
          }
        }
        pagedLength = items.length;
        return items;
      }, [])
        .sort((a, b) => sortItems(a, b, this.sortBy, this.sortDirection))
        .slice(offset, offset + limit)
        .map(item => this.formatItem(item));

      this.paginationOptions = {
        ...this.paginationOptions,
        itemCount: pagedLength,
      };
      if (this.objs.length > 0) this.setPageByFileName(this.$route.query.file);
    },
    setPageByFileName: function(file){
      if(file != undefined){
        let objectList = this.objs;
        // check if file is in subfolder
        if(file.includes("/")){
          let subfolderItems = [];
          objectList.forEach(element => {
            if(element.name.substr(0, element.name.lastIndexOf("/") + 1)
              === file.substr(0, file.lastIndexOf("/") + 1)){
              subfolderItems.push(element);
            }
          });
          objectList = subfolderItems;
        }
        let index = objectList.findIndex(item => item.name == file);
        if(index <= 0){
          index = 1;
        }
        this.paginationOptions.currentPage =
          Math.floor(index  / this.paginationOptions.itemsPerPage) + 1;
        let queryWithOutFile = {
          ...this.$route.query,
          file: null,
        };
        this.$router.replace({"query": queryWithOutFile});
      }
    },
    setPagination: function () {
      const paginationOptions = getPaginationOptions(this.$t);
      this.paginationOptions = paginationOptions;
    },
    onSort(event) {
      this.sortBy = event.detail.sortBy;
      this.sortDirection = event.detail.direction;
      //sorted in getPage()
    },
    handleSelection(event) {
      if (event.detail.length > 0 && this.renderFolders) {
        const prefix = getPrefix(this.$route);
        const selectedRows = event.detail.map(item => prefix.concat(item));
        this.$emit("selected-rows", selectedRows);
      } else {
        this.$emit("selected-rows", event.detail);
      }
    },
    beginDownload(object, eventTrusted) {
      //add test param to test direct downloads
      //by using origin private file system (OPFS)
      //automated testing creates untrusted events
      const test = eventTrusted === undefined ? false: !eventTrusted;

      const MAX_DOWNLOAD_SIZE = 5 * 1024 * 1024 * 1024; // 5GiB in bytes

      if (object?.subfolder) {
         // Check if folder size exceeds the limit
         if (object.bytes > MAX_DOWNLOAD_SIZE) {
          addErrorToastOnMain(this.$t("message.download.errorSizeExceeded"));
          return;
        }
        const subfolderFiles = this
          .objs
          .filter((obj) => {
            return obj.name.startsWith(object.name);
          })
          .map(item => item.name);

        this.$store.state.socket.addDownload(
          this.$route.params.container,
          subfolderFiles,
          this.$route.params.owner ? this.$route.params.owner : "",
          test,
        ).then(() => {
          if (DEV) console.log(`Started downloading subfolder ${object.name}`);
        }).catch(() => {
          addErrorToastOnMain(this.$t("message.download.error"));
        });
      } else {
        this.$store.state.socket.addDownload(
          this.$route.params.container,
          [object.name],
          this.$route.params.owner ? this.$route.params.owner : "",
          test,
        ).then(() => {
          if (DEV) console.log(`Started downloading object ${object.name}`);
        }).catch(() => {
          addErrorToastOnMain(this.$t("message.download.error"));
        });
      }
    },
    navDownload(url) {
      window.open(url, "_blank");
    },
    setHeaders() {
      this.headers = [
        {
          key: "name",
          value: this.$t("message.table.name"),
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
          key: "last_modified",
          value: this.$t("message.table.modified"),
          sortable: true,
        },
        {
          key: "actions",
          align: "end",
          value: null,
          sortable: false,
        },
      ];
    },
    onOpenEditTagsModal(itemName, keypress) {
      toggleEditTagsModal(itemName, null);
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
  },
};
</script>

<style lang="scss" scoped>

 .object-table-wrapper{
    position: relative;
  }

</style>
