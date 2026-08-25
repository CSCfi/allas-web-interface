<template>
  <div class="object-table-wrapper">
    <!-- Footer options needs to be in CamelCase,
    because csc-ui wont recognise it otherwise. -->
    <c-data-table
      v-if="paginationReady"
      :key="tableKey"
      id="obj-table"
      data-testid="object-table"
      :data.prop="objects"
      :headers.prop="headers"
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
  checkIfItemIsLastOnPage,
  getPaginationOptions,
  sortItems,
  parseDateTime,
  parseDateFromNow,
  getHumanReadableSize,
} from "@/common/tableFunctions";

import {
  DEV,
  // toggleEditTagsModal, (re-add when the edit-tags cell below is restored)
  toggleObjectInfoModal,
  isFile,
  getFolderName,
  getPrefix,
  addErrorToastOnMain,
} from "@/common/globalFunctions";
import { awsHeadObject } from "@/common/s3commands";
import { getPreviewUrl } from "@/common/api";
import { DateTime } from "luxon";
import {
  mdiTrayArrowDown,
  //mdiPencilOutline,
  mdiDeleteOutline,
  mdiFolder,
  mdiFileOutline,
  mdiInformationOutline,
} from "@mdi/js";
import { updatePaginationOptions } from "@/common/idbFunctions";

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
      // Remounts the c-data-table when the visible rows' folder/file pattern
      // changes: v3 renders cell-children (our name icon) with no vdom key, so
      // c-icon elements get reused by position and keep a stale path across
      // folder navigation/sort (files inheriting a folder icon).
      tableKey: "",
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
      return this.$store.active;
    },
    selectable () {
      return this.$route.name !== "SharedObjects"
        || this.accessRights.length === 2;
    },
    isLoaderVisible() {
      return this.$store.isLoaderVisible
        && this.$store.uploadBucket.name === this.container;
    },
    owner() {
      return this.$route.params.owner;
    },
    paginationReady() {
      return this.disablePagination || !!this.paginationOptions?.itemsPerPage;
    },
  },
  watch: {
    prefix() {
      this.getPage();
    },
    async locale() {
      this.setHeaders();
      await this.setPagination();
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
    async buildInfoForItem(item) {
      const isFolder = !!item?.folder;

      const base = {
        name: this.renderFolders
          ? getFolderName(item.name, this.$route)
          : item.name,
        fullPath: `${this.container}/${item.name}`,
        sizeHuman: getHumanReadableSize(Number(item.bytes) || 0, this.locale),
        itemCount: isFolder
          ? this.objs.filter(
            obj => obj.name.startsWith(item.name) && obj.name !== item.name,
          ).length
          : undefined,
        lastModified: item.last_modified
          ? parseDateTime(this.locale, item.last_modified, this.$t, false)
          : "-",
        contentType: isFolder ? "application/x-directory" : "-",
        etag: undefined,
        created: "-",
        checksum: "-",
        isFolder,
      };

      if (isFolder) return base;

      const head = await awsHeadObject(this.container, item.name);
      const meta = head.Metadata || {};

      // "created" and "sha256" are user metadata stamped by this UI's
      // upload workers; objects uploaded elsewhere won't have them
      let created = "-";
      const createdSec = Number.parseInt(meta.created ?? "", 10);
      if (Number.isFinite(createdSec) && createdSec > 0) {
        const iso = DateTime.fromSeconds(createdSec).toUTC().toISO();
        if (iso) created = parseDateTime(this.locale, iso, this.$t, false);
      }

      return {
        ...base,
        contentType: head.ContentType || "-",
        etag: (head.ETag || "").replaceAll("\"", "") || "-",
        created,
        checksum: meta.sha256 || "-",
      };
    },
    async onOpenInfoModal(item) {
      try {
        const info = await this.buildInfoForItem(item);
        toggleObjectInfoModal(info, this.container);
      } catch (e) {
        if (DEV) console.error("Info modal failed:", e);
        addErrorToastOnMain(this.$t("message.objects.noInfo"));
      }
    },
    handlePopState(event) {
      // reset page to 1 after reversing a page
      if (event.type === "popstate") {
        this.paginationOptions.currentPage = 1;
      }
    },
    changeFolder: function (folder) {
      this.paginationOptions.currentPage = 1;
      this.$router.push(
        `${window.location.pathname}?prefix=${getPrefix(this.$route)}${folder}`,
      );
    },
    openPreview: function (item) {
      const projectID = this.active?.id;
      if (!projectID) {
        addErrorToastOnMain("No active project selected.");
        return;
      }
      const url = getPreviewUrl(projectID, this.container, item.name);
      window.open(url, "_blank");
      this.$store.togglePreviewOpenedToast(true);
    },
    formatItem: function (item) {
      const name = this.renderFolders ?
        getFolderName(item.name, this.$route)
        : item.name;

      return {
        name: {
          // `value` must carry the real name: c-data-table's
          // selection-property="name" reads row.name.value to identify
          // selected rows (falls back to row index when empty, which
          // breaks checkbox selection + bulk delete). The icon + clickable
          // name are rendered via `children`; the raw value is wrapped in a
          // display:none span so it isn't shown twice.
          value: name,
          component: {
            tag: "span",
            params: { style: { display: "none" } },
          },
          children: [
            {
              value: "",
              component: {
                tag: "c-icon",
                params: {
                  // Empty folders exist as zero-byte "name/" placeholder
                  // objects: in the flat file-path view they aren't reduced
                  // into pseudo-folders (item.folder stays unset), but they
                  // should still read as folders, not files.
                  path: item?.folder || item.name.endsWith("/")
                    ? mdiFolder : mdiFileOutline,
                  color: "var(--c-primary-600)",
                  size: "18",
                },
              },
            },
            {
              value: name,
              component: {
                tag: "c-link",
                params: {
                  href: "javascript:void(0)",
                  style: {
                    "--c-link-color": "var(--c-tertiary-700)",
                    "--c-link-hover": "none",
                    marginLeft: "1rem",
                  },
                  onClick: item?.folder
                    ? () => this.changeFolder(name)
                    : () => this.openPreview(item),
                },
              },
            },
          ],
        },
        size: {
          value: getHumanReadableSize(item.bytes, this.locale),
        },
        last_modified: {
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
              value: "",
              component: {
                tag: "c-button",
                params: {
                  testid: "download-object",
                  text: true,
                  size: "small",
                  onClick: ({ event }) => {
                    this.beginDownload(item, event.isTrusted);
                  },
                  disabled: this.owner != undefined &&
                    this.accessRights.length === 0,
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
            {
              value: "",
              component: {
                tag: "c-button",
                params: {
                  testid: "object-info",
                  text: true,
                  size: "small",
                  onClick: () => this.onOpenInfoModal(item),
                  onKeyUp: (event) => {
                    if (event.keyCode === 13) this.onOpenInfoModal(item);
                  },
                  disabled: this.owner != undefined &&
                    this.accessRights.length === 0,
                },
              },
              children: [
                {
                  value: "",
                  component: {
                    tag: "c-icon",
                    params: {
                      path: mdiInformationOutline,
                      size: "18",
                    },
                  },
                },
                {
                  value: this.$t("message.objects.info"),
                  component: {
                    tag: "span",
                  },
                },
              ],
            },
            /*{
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
                    toggleEditTagsModal(item.name, null),
                  onKeyUp: (event) => {
                    if(event.keyCode === 13) {
                      toggleEditTagsModal(item.name, null);
                    }
                  },
                  disabled: item?.folder ||
                    (this.owner != undefined && this.accessRights.length <= 1),
                },
              },
            },*/
            {
              value: "",
              component: {
                tag: "c-button",
                params: {
                  testid: "delete-object",
                  text: true,
                  size: "small",
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
      };
    },

    getPage: function () {
      if (!this.paginationReady) {
        return;
      }
      let offset = 0;
      let limit = this.objs.length;
      if (!this.disablePagination || this.objs.length > 500) {
        offset =
          this.paginationOptions.currentPage
          * this.paginationOptions.itemsPerPage
          - this.paginationOptions.itemsPerPage;

        limit = this.paginationOptions.itemsPerPage;
      }

      // Filtered objects based on prefix; the current folder's own
      // marker object (zero-byte key equal to the prefix) is hidden
      const filteredObjs = this
        .objs
        .filter((obj) => {
          return obj.name.startsWith(getPrefix(this.$route));
        })
        .filter((obj) => obj.name !== getPrefix(this.$route));

      // If the prefix no longer matches anything (e.g. the folder was
      // deleted in another tab), navigate up one level instead of erroring
      const p = this.$route.query.prefix || "";
      if (p && this.objs.length && !this.$store.openDeleteModal &&
        !this.objs.some(o => o.name === p || o.name.startsWith(getPrefix(this.$route)))) {
        let up = p.replace(/[^/]+\/?$/, "");
        if (up && !up.endsWith("/")) up += "/";
        this.$router.replace({
          query: { ...this.$route.query, prefix: up || undefined },
        });
      }

      let pagedLength = 0;

      const rows = filteredObjs.reduce((items, item) => {
        if (isFile(item.name, this.$route) || !this.renderFolders) {
          items.push(item);
        } else {
          let name = getFolderName(item.name, this.$route);
          //check if folder already added
          if (items.find(el => getFolderName(el.name, this.$route)
            === name)) {
            return items;
          } else {
            //filter objs that would belong to folder
            let folderObjs = filteredObjs.filter(obj => {
              if (getFolderName(obj.name, this.$route) ===
                name) {
                return obj;
              }
            });
            //sort by latest last_modified
            folderObjs.sort((a, b) => sortItems(
              a, b, "last_modified", "desc"));
            const folderSize = folderObjs.reduce((sum, obj) => {
              return sum += obj.bytes;
            }, 0);
            const fullName = getPrefix(this.$route) + name + "/";
            //add new folder
            const folder = {
              container: item.container,
              name: fullName,
              bytes: folderSize,
              last_modified: folderObjs[0].last_modified,
              tags: [],
              folder: true,
            };
            items.push(folder);
          }
        }
        pagedLength = items.length;
        return items;
      }, []);

      const pageRows = rows
        .sort((a, b) => sortItems(a, b, this.sortBy, this.sortDirection))
        .slice(offset, offset + limit);

      this.tableKey = getPrefix(this.$route) + "|"
        + pageRows.map(o => (o.folder ? "d" : "f")).join("");
      this.objects = pageRows.map(item => this.formatItem(item));

      this.paginationOptions = {
        ...this.paginationOptions,
        itemCount: pagedLength,
      };
      if (this.objs.length > 0) this.setPageByFileName(this.$route.query.file);
    },
    setPageByFileName: function(file){
      if(file != undefined){
        let objectList = this.objs;
        // check if file is in folder
        if(file.includes("/")){
          let folderItems = [];
          objectList.forEach(element => {
            if(element.name.substr(0, element.name.lastIndexOf("/") + 1)
              === file.substr(0, file.lastIndexOf("/") + 1)){
              folderItems.push(element);
            }
          });
          objectList = folderItems;
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
    setPagination: async function () {
      const paginationOptions = await getPaginationOptions(this.$t);
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

      if (object?.folder) {
        const folderFiles = this
          .objs
          .filter((obj) => {
            return obj.name.startsWith(object.name);
          })
          .map(item => item.name);

        this.$store.s3download.addDownload(
          this.$route.params.container,
          folderFiles,
          this.$route.params.owner ? this.$route.params.owner : "",
          test,
        ).then(() => {
          if (DEV) console.log(`Started downloading folder ${object.name}`);
        }).catch((error) => {
          if (DEV) {
            console.log(error);
          }
          addErrorToastOnMain(this.$t("message.download.error"));
        });
      } else {
        this.$store.s3download.addDownload(
          this.$route.params.container,
          [object.name],
          this.$route.params.owner ? this.$route.params.owner : "",
          test,
        ).then(() => {
          if (DEV) console.log(`Started downloading object ${object.name}`);
        }).catch((error) => {
          if (DEV) {
            console.log(error);
          }
          addErrorToastOnMain(this.$t("message.download.error"));
        });
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
          key: "size",
          value: this.$t("message.table.size"),
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
  },
};
</script>

<style scoped>

.object-table-wrapper{
  position: relative;
}

</style>
