<template>
  <div
    id="object-table"
  >
    <BreadcrumbNav @breadcrumbClicked="breadcrumbClickHandler" />
    <div class="bucket-info">
      <div class="bucket-info-heading">
        <c-icon :path="mdiPailOutline" />
        <span>{{ containerName }}</span>
      </div>
      <ul class="bucket-details">
        <li>
            <span><b>{{ $t("message.bucketDetails.size") }}: </b>{{ bucketSize }}</span>
            <span id="count"><b>{{ $t("message.table.items") }}: </b>{{ metadata.count }}</span>
        </li>
        <li>
          <b>{{ $t("message.table.shared_status") }}: </b>
          {{ sharedStatus }}&nbsp;
          <c-link
            v-show="!owner"
            underline
            tabindex="0"
            data-testid="edit-sharing"
            @click="toggleShareModal"
            @keydown.enter="toggleShareModal"
          >
            {{ $t("message.table.edit_sharing") }}
          </c-link>
        </li>
        <li v-show="owner">
          <b>{{ $t("message.table.source_project_id") }}: </b>
          {{ ownerProject }}
        </li>
        <li v-show="owner">
          <b>{{ $t("message.table.date_of_sharing") }}: </b>
          {{ dateOfSharing }}
        </li>
        <li v-show="!owner && bucketIsPublic !== null">
          <b>{{ $t("message.public.public") }}: </b>
          {{ bucketIsPublic
            ? $t("message.public.yes")
            : $t("message.public.no") }}
        </li>
        <li v-show="!owner">
          <b>{{ $t("message.bucketDetails.created") }}: </b>{{ bucketCreated }}
        </li>
        <li><b>{{ $t("message.table.modified") }}: </b>{{ bucketLastModified }}</li>
      </ul>
    </div>

    <c-row
      id="optionsbar"
      justify="space-between"
    >
      <!--<c-text-field
        id="search"
        v-model="searchQuery"
        v-csc-control
        name="search"
        :placeholder="$t('message.objects.filterBy')"
        type="search"
      >
        <c-icon :path="mdiFilterVariant" size="24" />
      </c-text-field>-->
      <c-button
        v-if="showGoUp"
        id="go-up-btn"
        size="small"
        text
        @click="goUpOneLevel"
        @keyup.enter="goUpOneLevel"
      >
        <c-icon :path="mdiArrowUpLeft" size="20" />
        {{ atBucketRoot
          ? $t("message.objects.backToBuckets")
          : $t("message.objects.upOneLevel") }}
      </c-button>
      <div class="row-end">
        <c-button
          id="create-folder-btn"
          size="small"
          outlined
          data-testid="create-folder"
          :disabled="owner != undefined && accessRights.length <= 1"
          @click="openFolderModal"
          @keyup.enter="openFolderModal"
        >
          <c-icon :path="mdiFolderPlusOutline" size="20" />
          {{ $t("message.objects.createFolder") }}
        </c-button>
        <c-menu
          :key="optionsKey"
          :items.prop="tableOptions"
          data-testid="table-options-selector"
        >
          <c-icon :path="mdiTune" size="20" />
          <span class="menu-active display-options-menu">
            {{ $t("message.tableOptions.displayOptions") }}
          </span>
        </c-menu>
      </div>
    </c-row>
    <div
      v-if="checkedRows.length"
      class="selection-bar"
    >
      <div class="info">
        <c-icon :path="mdiInformationOutline" size="20" />
        <span>
          {{ checkedRows.length }}
          {{ checkedRows.length === 1
            ? $t("message.table.itemSelected")
            : $t("message.table.itemsSelected") }}
        </span>
      </div>

      <div class="action-buttons">
        <c-button
          v-for="button in selectionActionButtons"
          :id="`${button.label.toLowerCase()}-selections`"
          :key="button.label"
          :data-testid="button.testid"
          inverted
          text
          @click="button.action"
          @keyup.enter="button.action"
        >
          <c-icon :path="button.icon" size="20" />
          {{ button.label }}
        </c-button>
      </div>
    </div>
    <div id="obj-table-wrapper">
      <CObjectTable
        :breadcrumb-clicked-prop="breadcrumbClicked"
        :objs="filtering ? filteredObjects : oList"
        :disable-pagination="hidePagination"
        :hide-tags="true"
        :render-folders="renderFolders"
        :show-timestamp="showTimestamp"
        :access-rights="accessRights"
        :no-data-text="filtering ?
          $t('message.search.empty') : $t('message.emptyContainer')"
        @selected-rows="handleSelection"
        @delete-object="confirmDelete"
      />
      <c-loader v-show="objsLoading" />
    </div>
    <c-toasts
      id="objects-toasts"
      data-testid="objects-toasts"
    />
  </div>
</template>

<script>
import {
  mdiPailOutline,
  mdiTune,
  mdiInformationOutline,
  mdiArrowUpLeft,
  mdiFolderPlusOutline,
  mdiRefresh,
  mdiTrashCanOutline,
} from "@mdi/js";
import {
  DEV,
  toggleDeleteModal,
  toggleCreateBucketModal,
  isFile,
  addErrorToastOnMain,
  checkAndAddBucketCors,
} from "@/common/globalFunctions";
import {
  getSharedContainers,
  getAccessDetails,
} from "@/common/share";
import {
  parseDateTime,
  getHumanReadableSize,
  truncate,
} from "@/common/tableFunctions";
import { getDB } from "@/common/idb";
import { getBucketMetadata, saveBucketMetadata, updateContainers } from "@/common/idbFunctions";
import CObjectTable from "@/components/CObjectTable.vue";
import { debounce, escapeRegExp } from "lodash";
import BreadcrumbNav from "@/components/BreadcrumbNav.vue";
import { toRaw } from "vue";
import { awsListObjects, getBucketPublicStatus } from "@/common/s3commands";

export default {
  name: "ObjectTable",
  components: {
    CObjectTable,
    BreadcrumbNav,
  },
  filters: {
    truncate,
  },
  data: function () {
    return {
      mdiPailOutline,
      mdiTune,
      mdiInformationOutline,
      mdiArrowUpLeft,
      mdiFolderPlusOutline,
      accessRights: [],
      sharedStatus: "",
      sharedContainers: [],
      ownerProject: "",
      dateOfSharing: "",
      oList: [],
      showTimestamp: false,
      hidePagination: false,
      renderFolders: true,
      //hideTags: false,
      searchQuery: "",
      checkedRows: [],
      optionsKey: 1,
      abortController: null,
      filteredObjects: [],
      tableOptions: [],
      currentContainer: {},
      bucketIsPublic: null,
      breadcrumbClicked: false,
      objsLoading: false,
      filtering: false,
      metadata: {
        count: 0,
        bytes: 0,
        created: null,
        last_modified: null,
      },
    };
  },
  computed: {
    readyToFetch() {
      return (this.active?.id && this.containerName && this.sharingClient);
    },
    prefix () {
      return this.$route.query.prefix || "";
    },
    atBucketRoot() {
      return !this.prefix;
    },
    showGoUp() {
      return this.$route.name === "ObjectsView"
        || this.$route.name === "SharedObjects";
    },
    project () {
      return this.$route.params.project;
    },
    containerName () {
      return this.$route.params.container;
    },
    sharingClient () {
      return this.$store.sharingClient;
    },
    active () {
      return this.$store.active;
    },
    openCreateBucketModal() {
      return this.$store.openCreateBucketModal;
    },
    locale () {
      return this.$i18n.locale;
    },
    isBucketUploading() {
      return this.$store.isUploading;
    },
    isDeletingObjects() {
      return this.$store.isDeleting;
    },
    createModalOpen() {
      return this.$store.openCreateBucketModal;
    },
    uploadModalOpen() {
      return this.$store.openUploadModal;
    },
    owner() {
      return this.$route.params.owner;
    },
    shareModal() {
      return this.$store.openShareModal;
    },
    bucketSize() {
      return getHumanReadableSize(this.metadata.bytes, this.locale);
    },
    bucketCreated() {
      return parseDateTime(this.locale, this.metadata.created, this.$t, true);
    },
    bucketLastModified() {
      return parseDateTime(this.locale, this.metadata.last_modified, this.$t, true);
    },
  },
  watch: {
    readyToFetch: function() {
      this.fetchIfReady();
    },
    containerName: function() {
      // For cases of navigating with upload "view destination"
      this.fetchIfReady();
    },
    searchQuery: function () {
      // Run debounced search every time the search box input changes
      this.debounceFilter();
    },
    currentContainer: async function() {
      if (this.currentContainer === undefined) return;
      const savedDisplayOptions = toRaw(this.currentContainer.displayOptions);
      if (savedDisplayOptions) {
        this.renderFolders = savedDisplayOptions.renderFolders;
        this.showTimestamp = savedDisplayOptions.showTimestamp;
        //this.hideTags = savedDisplayOptions.hideTags;
        this.hidePagination = savedDisplayOptions.hidePagination;
        this.setTableOptionsMenu();
      }
    },
    locale () {
      this.setLocalizedContent();
      this.getBucketSharedStatus();
    },
    isBucketUploading: function () {
      if (!this.isBucketUploading) {
        setTimeout(async () => {
          await this.updateObjectsAndMetadata();
        }, 1000);
      }
    },
    isDeletingObjects: function () {
      if (!this.isDeletingObjects) {
        this.objsLoading = true;
        setTimeout(async () => {
          await this.updateObjectsAndMetadata();
          this.objsLoading = false;
        }, 1000);
      }
    },
    createModalOpen: function () {
      // Refresh the object list after the create-folder modal closes
      // so a newly created folder appears immediately
      if (!this.createModalOpen) {
        this.updateObjectsAndMetadata();
      }
    },
    uploadModalOpen: function () {
      // Refresh after the upload modal closes; covers empty folders
      // created without any file upload (no isUploading toggle)
      if (!this.uploadModalOpen) {
        this.updateObjectsAndMetadata();
      }
    },
    shareModal: async function(){
      if (!this.shareModal) await this.getBucketSharedStatus();
    },
    oList() {
      if (this.objsLoading) setTimeout(() => this.objsLoading = false, 100);
    },
  },

  created: function () {
    // Lodash debounce to prevent the search execution from executing on
    // every keypress, thus blocking input
    this.debounceFilter = debounce(this.filter, 400);
    this.setLocalizedContent();
  },
  beforeMount () {
    this.abortController = new AbortController();
  },
  mounted () {
    this.fetchIfReady();
  },
  beforeUnmount () {
    this.abortController.abort();
  },
  updated () {
    if (this.breadcrumbClicked) this.breadcrumbClicked = false;
  },
  methods: {
    fetchIfReady: async function () {
      this.objsLoading = true;
      if (this.readyToFetch) {
        if (!this.owner) await checkAndAddBucketCors(this.active.id, this.containerName);
        await this.getData();
      }
    },
    getData: async function () {
      // First look for bucket metadata in idb; it is updated after objects are fetched
      const idbMetadata = await getBucketMetadata(this.active.id, this.containerName);
      if (idbMetadata) this.metadata = {...idbMetadata};
      if (!this.owner) {
        try {
          this.bucketIsPublic = (await getBucketPublicStatus(this.containerName)).public;
        } catch {
          this.bucketIsPublic = null;
        }
      }
      await this.getSharedContainers();
      await this.getBucketSharedStatus();
      await this.updateObjectsAndMetadata();
    },
    breadcrumbClickHandler(value) {
      this.breadcrumbClicked = value;
    },
    goUpOneLevel() {
      const current = this.prefix;

      // Reset table pagination the same way a breadcrumb click does
      this.breadcrumbClicked = true;

      if (current) {
        // go up one pseudofolder level; unlike master, prefixes on
        // this branch carry no trailing slash ("Demo/web", not "Demo/web/")
        const trimmed = current.replace(/\/+$/, "");
        const parent = trimmed.includes("/")
          ? trimmed.slice(0, trimmed.lastIndexOf("/"))
          : "";

        const query = { ...this.$route.query };
        delete query.file;
        if (parent) query.prefix = parent;
        else delete query.prefix;

        this.$router.push({
          name: this.$route.name,
          params: this.$route.params,
          query,
        });
        return;
      }

      // at bucket root, go back to the bucket listing
      this.$router.push({ name: "AllBuckets" });
    },
    openFolderModal() {
      toggleCreateBucketModal();
      this.$nextTick(() => {
        setTimeout(() => {
          const input = document.querySelector("#newFolder-input input");
          if (input) {
            input.tabIndex = "0";
            input.focus();
          }
        }, 300);
      });
    },
    getSharedContainers: async function () {
      this.sharedContainers =
        await getSharedContainers(this.active.id, this.abortController.signal);
    },
    getBucketSharedStatus: async function() {
      if (this.sharingClient) {
        await this.sharingClient.getShareDetails(
          this.project,
          this.containerName,
          this.abortController.signal,
        ).then(
          async (ret) => {
            if (ret.length > 0) {
              ret.length === 1
                ? this.sharedStatus
                  = this.$t("message.bucketDetails.sharing_to_one_project")
                : this.sharedStatus
                  = this.$t("message.bucketDetails.sharing_to_many_projects");
            }
            else if (ret.length === 0) {
              if (this.sharedContainers.findIndex(
                cont => cont.container === this.containerName) > -1) {

                const sharedDetails
                  = await getAccessDetails(
                    this.project,
                    this.containerName,
                    this.owner,
                    this.abortController.signal,
                  );

                this.accessRights = sharedDetails.access;
                switch (this.accessRights.length) {
                  case 0:
                    this.sharedStatus
                      = this.$t("message.bucketDetails.shared_with_view");
                    break;
                  case 1:
                    this.sharedStatus
                      = this.$t("message.bucketDetails.shared_with_read");
                    break;
                  case 2:
                    this.sharedStatus
                      = this.$t("message.bucketDetails.shared_with_read_write");
                    break;
                }
                this.ownerProject = sharedDetails.owner;
                this.dateOfSharing =
                  parseDateTime(
                    this.locale, sharedDetails.sharingDate, this.$t, true);
              }
              else this.sharedStatus
                = this.$t("message.bucketDetails.notShared");
            }
          },
        );
      }
    },
    toggleShareModal: function () {
      this.$store.toggleShareModal(true);
      this.$store.setBucketName(this.containerName);
    },
    confirmDelete: function(item) {
      const isFolder = !isFile(item.name, this.$route) && this.renderFolders;
      toggleDeleteModal([{ ...item, isFolder }]);
    },
    getCurrentContainer: function () {
      return getDB().containers
        .get({
          projectID: this.project,
          name: this.containerName,
        });
    },
    updateObjectsAndMetadata: async function () {
      if (
        this.containerName === undefined
        || (
          this.active.id === undefined
          && this.project
        )
      ) {
        return;
      }
      this.currentContainer = await this.getCurrentContainer();

      if (this.currentContainer === undefined) {
        //container not in DB when clicking "view destination"
        // while / right after uploading
        await updateContainers(this.active.id, this.abortController.signal);
        this.currentContainer = await this.getCurrentContainer();
        if (this.currentContainer === undefined) {
          if (DEV) console.log("Error with uploaded container");
          return;
        }
      }

      this.oList = await awsListObjects(
        this.containerName,
      );
      this.$store.setLoaderVisible(false);

      // Update bucket metadata if needed
      await this.updateBucketMetadata();
    },
    updateBucketMetadata: async function () {
      let updated = { ...this.metadata, bytes: 0, count: 0 };
      if (this.oList?.length) {
        updated.count = this.oList.length;

        this.oList.forEach((obj) => {
          updated.bytes += obj.bytes;
          if (!updated.last_modified || obj.last_modified > updated.last_modified) {
            updated.last_modified = obj.last_modified;
          }
        });
      }
      if (updated.count === this.metadata.count &&
        updated.bytes === this.metadata.bytes &&
        updated.last_modified === this.metadata.last_modified) {
        return;
      }
      await saveBucketMetadata(this.active.id, this.containerName, updated);
      this.metadata = { ...updated } ;
    },
    getPrefix: function () {
      // Get current pseudofolder prefix
      if (this.$route.query.prefix == undefined) {
        return "";
      }
      return this.$route.query.prefix;
    },
    filter: function () {
      if(this.searchQuery.length === 0) {
        this.filtering = false;
        this.filteredObjects = [];
        return;
      }
      this.filtering = true;
      // request parameter should be sanitized first
      var safeKey = escapeRegExp(this.searchQuery);
      var name_re = new RegExp(safeKey, "i");
      function search (prev, element) {
        if (
          element.name.match(name_re) ||
          (
            element.tags &&
            element.tags.join("\n").match(name_re)
          )
        ) {
          return prev;
        }
        prev.push(element.name);
        return prev;
      }

      const filteredNames = this.oList.reduce(search, []);

      this.filteredObjects = this.oList.
        filter(obj => filteredNames.indexOf(obj.name) === -1);
    },
    handleSelection(selection) {
      const objects = this.oList;
      this.checkedRows = objects.filter(
        item => selection.indexOf(item.name) > -1,
      );

      /* Selections that don't match a real object are folder rows:
        the table only carries the folder's display name, so rebuild
        the folder key (trailing slash) and let DeleteModal expand it
      */
      if (this.checkedRows.length < selection.length) {
        for (let i = 0; i < selection.length; i++) {
          if(!this.checkedRows.some(row => row && row.name === selection[i])) {
            this.checkedRows.push({
              name: `${selection[i]}/`,
              container: this.containerName,
              isFolder: true,
            });
          }
        }
      }
    },
    clearSelections() {
      const dataTable = document.getElementById("obj-table");
      dataTable.clearSelections();
    },
    setTableOptionsMenu() {
      this.$store.toggleRenderedFolders(this.renderFolders);
      const displayOptions = {
        renderFolders: this.renderFolders,
        showTimestamp: this.showTimestamp,
        //hideTags: this.hideTags,
        hidePagination: this.hidePagination,
      };

      this.tableOptions = [
        {
          name: this.renderFolders
            ? this.$t("message.tableOptions.text")
            : this.$t("message.tableOptions.render"),
          action: async () => {
            this.renderFolders = !(this.renderFolders);

            const newContainer = {
              ...toRaw(this.currentContainer),
              displayOptions: {
                ...displayOptions, renderFolders: this.renderFolders }};
            await getDB().containers.put(newContainer);

            this.setTableOptionsMenu();
          },
        },
        {
          name: this.showTimestamp
            ? this.$t("message.tableOptions.fromNow")
            : this.$t("message.tableOptions.timestamp"),
          action: async () => {
            this.showTimestamp = !(this.showTimestamp);

            const newContainer = {
              ...toRaw(this.currentContainer),
              displayOptions: {
                ...displayOptions, showTimestamp: this.showTimestamp }};
            await getDB().containers.put(newContainer);

            this.setTableOptionsMenu();
          },
        },
        /*{
          name: this.hideTags
            ? this.$t("message.tableOptions.showTags")
            : this.$t("message.tableOptions.hideTags"),
          action: async () => {
            this.hideTags = !(this.hideTags);

            const newContainer = {
              ...toRaw(this.currentContainer),
              displayOptions: {
                ...displayOptions, hideTags: this.hideTags }};
            await getDB().containers.put(newContainer);

            this.setTableOptionsMenu();
          },
        },*/
        {
          name: this.hidePagination
            ? this.$t("message.tableOptions.showPagination")
            : this.$t("message.tableOptions.hidePagination"),
          action: async () => {
            this.hidePagination = !(this.hidePagination);

            const newContainer = {
              ...toRaw(this.currentContainer),
              displayOptions: {
                ...displayOptions, hidePagination: this.hidePagination }};
            await getDB().containers.put(newContainer);

            this.setTableOptionsMenu();
          },
        },
      ];

      this.optionsKey++;
    },
    setSelectionActionButtons() {
      this.selectionActionButtons = [
        {
          label: this.$t("message.table.clearSelected"),
          icon: mdiRefresh,
          testid: "clear-checkboxes",
          action: () => this.clearSelections(),
        },
        {
          label: this.$t("message.table.deleteSelected"),
          icon: mdiTrashCanOutline,
          testid: "delete-checked-files",
          action: () => {
            const rows = this.checkedRows.map(item => ({
              ...item,
              isFolder: item.isFolder === true ||
                (!isFile(item.name, this.$route) && this.renderFolders),
            }));
            toggleDeleteModal(rows);
          },
        },
      ];
    },
    setLocalizedContent() {
      this.setTableOptionsMenu();
      this.setSelectionActionButtons();
    },
  },
};
</script>

<style scoped>

#count {
  margin-left: 1.5rem;
}

#search {
  flex: 0.4;
}

.row-end {
  display: flex;
  gap: 1.5rem;
  align-items: baseline;
}

.bucket-info {
  border: 1px solid var(--c-primary-600);
  margin: 0rem 0rem;
}

.bucket-info-heading, .bucket-details {
  padding: 1rem 2rem;
}

.bucket-info-heading {
  display: flex;
  color: #FFF;
  font-size: 1rem;
  font-weight: 700;
  background: var(--csc-dark-blue);
  align-items: center;
  & span {
    margin-left: 0.5rem;
    align-self: center;
    display: inline-block;
  }
}

.bucket-details {
  color: var(--csc-dark);

  & li {
    padding: .25rem 0;
  }
}

.selection-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  color: #FFF;
  background: var(--csc-blue);
  border-radius: .25rem;
  padding: 0 1rem;
  margin: 1.5rem 0 0;
  position: sticky;
  top: 0;
  z-index: 10;

  & .info {
    display: flex;
    flex: 1;
    min-width: 12rem;
    padding: 1rem;
    & span {
      margin-left: 0.5rem;
      align-self: center;
      display: inline-block;
    }
  }

  & .action-buttons {
    display: flex;
    flex: 0;
    padding: .5rem 0;
  }
}

#objects-toasts {
  bottom: 40vh;
}

#obj-table-wrapper {
  position: relative;
}

</style>
