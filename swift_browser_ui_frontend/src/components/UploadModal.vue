
<template>
  <c-card
    ref="uploadContainer"
    class="modal-card"
    data-testid="upload-modal"
    @keydown="handleKeyDown"
  >
    <div
      id="upload-modal-content"
      class="modal-content-wrapper"
      tabindex="-1"
    >
      <c-toasts
        id="uploadModal-toasts"
        data-testid="uploadModal-toasts"
        vertical="bottom"
        absolute
      />
      <c-card-content class="modal-card-content">
        <h2 class="title is-4">
          {{ $t("message.uploadDialog.uploadFiles") }}
        </h2>
        <div v-if="!currentBucket" class="content-div">
          <h3 class="title is-6">
            1. {{ $t("message.uploadDialog.uploadStep1.title") }}
          </h3>
          <p>
            {{ $t('message.uploadDialog.uploadStep1.createAtRoot') }}
          </p>
          <p>
            {{ $t('message.uploadDialog.uploadStep1.nonModifiable') }}
          </p>
          <c-text-field
            id="upload-bucket-input"
            v-model="inputBucket"
            v-csc-control
            data-testid="upload-bucket-input"
            :label="$t('message.container_ops.bucketName')"
            aria-required="true"
            hide-details
            required
            trim-whitespace
            @changeValue="checkBucketName"
          />
          <BucketNameValidation
            :result="validationResult"
          />
          <h3 class="title is-6">
            2. {{ $t("message.uploadDialog.uploadStep2") }}
          </h3>
        </div>
        <div v-else>
          <p>
            <b>{{ $t("message.uploadDialog.uploadDestination") }}</b>
            {{ currentBucket }}
          </p>
        </div>
        <div
          class="dropArea"
          @dragover="dragHandler"
          @dragleave="dragLeaveHandler"
          @drop="navUpload"
        >
          <span>{{ $t("message.dropFiles") }}</span>
          <CUploadButton
            v-model="files"
            v-csc-control
            @add-files="buttonAddingFiles=true"
            @cancel="buttonAddingFiles=false"
          >
            <span>
              {{ $t("message.uploadDialog.dropMsg") }}
            </span>
          </CUploadButton>
        </div>
        <template v-for="error in dropFileErrors">
          <c-alert
            v-if="error.show"
            :key="error.id"
            type="error"
            data-testid="drop-files-error"
          >
            <div class="drop-file-notification">
              {{ $t(`message.upload.${error.id}`) }}
              <c-button
                text
                size="small"
                @click="error.show = false"
              >
                <c-icon :path="mdiClose" />
                {{ $t("message.close") }}
              </c-button>
            </div>
          </c-alert>
        </template>
        <c-alert
          v-show="existingFiles.length"
          type="warning"
        >
          <span
            v-if="existingFiles.length === 1"
          >
            {{ $t("message.objects.file") }}
            <b>
              {{ existingFiles[0].name }}
            </b>
            {{ $t("message.objects.overwriteConfirm") }}
          </span>
          <span
            v-else
          >
            {{ $t("message.objects.files") }}
            <b>
              {{ existingFileNames }}
            </b>
            {{ $t("message.objects.overwriteConfirmMany") }}
          </span>
          <c-card-actions justify="end">
            <c-button
              outlined
              @click="overwriteFiles"
              @keyup.enter="overwriteFiles"
            >
              {{ $t("message.objects.overwrite") }}
            </c-button>
            <c-button
              @click="clearExistingFiles"
              @keyup.enter="clearExistingFiles"
            >
              {{ $t("message.cancel") }}
            </c-button>
          </c-card-actions>
        </c-alert>
        <!-- Footer options needs to be in CamelCase,
        because csc-ui wont recognise it otherwise. -->
        <c-data-table
          v-if="dropFiles.length > 0 || emptyFolders.length > 0"
          class="files-table"
          :data.prop="paginatedDropFiles"
          :headers.prop="fileHeaders"
          :no-data-text="$t('message.uploadDialog.empty')"
          :pagination.prop="filesPagination"
          :sort-by="sortBy"
          :sort-direction="sortDirection"
          external-data
          @click="checkPage($event,false)"
          @sort="onSort"
          @paginate="getDropTablePage"
        />
        <p
          class="info-text is-6"
        >
          {{ $t("message.uploadDialog.uploadedFiles") }}
          <b>{{ active.name }}</b>{{ !owner ? "." : " (" }}
          <c-link
            :href="projectInfoLink"
            underline
            target="_blank"
          >
            {{ $t("message.container_ops.viewProjectMembers") }}
            <c-icon :path="mdiOpenInNew" />
          </c-link>
          {{ !owner ? "" :
            ") " + $t("message.uploadDialog.uploadedToShared") }}
        </p>
      </c-card-content>
    </div>
    <c-card-actions justify="space-between">
      <c-button
        outlined
        size="large"
        @click="cancelUpload"
        @keyup.enter="cancelUpload"
      >
        {{ $t("message.uploadDialog.cancel") }}
      </c-button>
      <c-button
        data-testid="start-upload"
        size="large"
        :loading="addingFiles || buttonAddingFiles"
        @click="onUploadClick"
        @keyup.enter="onUploadClick"
      >
        {{ $t("message.uploadDialog.normup") }}
      </c-button>
    </c-card-actions>
  </c-card>
</template>

<script>
import { getDB } from "@/common/idb";

import {
  DEV,
  getProjectNumber,
  validateBucketName,
  addErrorToastOnMain,
} from "@/common/globalFunctions";
import {
  checkIfItemIsLastOnPage,
  getHumanReadableSize,
  sortItems,
  truncate,
} from "@/common/tableFunctions";
import { captureKeyboardNavInsideModal } from "@/common/keyboardNavigation";
import CUploadButton from "@/components/CUploadButton.vue";
import BucketNameValidation from "./BucketNameValidation.vue";
import {
  awsListObjects,
  awsPutObject,
  checkBucketAccessible,
} from "@/common/s3commands";
import { awsAddBucketCors, awsCreateBucket } from "@/common/api";

import { debounce, delay } from "lodash";
import { mdiDelete, mdiClose, mdiOpenInNew } from "@mdi/js";

export default {
  name: "UploadModal",
  components: {
    CUploadButton,
    BucketNameValidation,
  },
  filters: {
    truncate,
  },
  data() {
    return {
      mdiClose,
      mdiOpenInNew,
      inputBucket: "",
      CUploadButton,
      projectInfoLink: "",
      addingFiles: false,
      buttonAddingFiles: false,
      validationResult: {},
      toastMsg : "",
      containers: [],
      objects: [],
      existingFiles: [],
      filesToOverwrite: [],
      dropFileErrors: [
        {id: "duplicate", show: false},
        {id: "sizeZero", show: false},
      ],
      paginatedDropFiles: [],
      emptyFolders: [],
      sortBy: "name",
      sortDirection: "asc",
      filesPagination: {
        itemCount: 0,
        itemsPerPage: 20,
        currentPage: 1,
      },
      uploadError: "",
    };
  },
  computed: {
    active() {
      return this.$store.active;
    },
    locale() {
      return this.$i18n.locale;
    },
    currentBucket() {
      return this.$route.params.container;
    },
    modalVisible() {
      return this.$store.openUploadModal;
    },
    owner() {
      return this.$route.params.owner;
    },
    s3socket() {
      return this.$store.s3upload;
    },
    abortReason() {
      return this.$store.uploadAbortReason;
    },
    fileHeaders() {
      return [
        {
          key: "name",
          value: this.$t("message.uploadDialog.table.name"),
          width: "30%",
          sortable: this.dropFiles.length > 1,
        },
        {
          key: "type",
          value: this.$t("message.uploadDialog.table.type"),
          width: "15%",
          sortable: this.dropFiles.length > 1,
        },
        {
          key: "size",
          value: this.$t("message.uploadDialog.table.size"),
          width: "10%",
          sortable: this.dropFiles.length > 1,
        },
        {
          key: "relativePath",
          value: this.$t("message.uploadDialog.table.path"),
          width: "30%",
          sortable: this.dropFiles.length > 1,
        },
        {
          key: "delete",
          value: null,
          sortable: false,
        },
      ];
    },
    dropFiles() {
      return this.$store.dropFiles;
    },
    files: {
      get() {
        return this.$store.dropFiles.message;
      },
      set(value) {
        const files = Array.from(value);
        files.forEach(file => {
          if (this.addFiles) {
            file.relativePath = file.name;
            this.appendDropFiles(file);
          }
        });
        this.buttonAddingFiles = false;
      },
    },
    addFiles() {
      return this.$store.addUploadFiles;
    },
    existingFileNames() {
      return this.existingFiles.reduce((array, item) => {
        array.push(item.name);
        return array;
      }, []).join(", ");
    },
  },
  watch: {
    modalVisible: async function() {
      if (this.modalVisible) {
        //inputBucket not cleared when modal toggled,
        //in case there's a delay in upload start
        //reset when modal visible
        this.clearExistingFiles();
        this.objects = [];
        this.filesToOverwrite = [];
        this.inputBucket = "";
        this.containers = await getDB().containers
          .where({ projectID: this.active.id })
          .toArray();
        if (this.currentBucket) {
          this.objects = await awsListObjects(this.currentBucket);
        }
      }
    },
    dropFiles: {
      deep: true,
      handler() {
        if (this.modalVisible) this.getDropTablePage();
      },
    },
    active: function () {
      this.projectInfoLink = this.$t("message.supportMenu.projectInfoBaseLink")
        + getProjectNumber(this.active);
    },
    addingFiles() {
      //see if drag&drop adding of files is done:
      if (this.addingFiles) {
        let fileCount = this.dropFiles.length;
        let check = setInterval(() => {
          if (this.dropFiles.length === fileCount) {
            //the amount of dropFiles didn't change
            //in the interval
            this.addingFiles = false;
            clearInterval(check);
          } else {
            fileCount = this.dropFiles.length;
          }
        }, 200);
      }
    },
    abortReason() {
      if (this.abortReason !== undefined) {
        if (this.abortReason
          ?.match("Could not create or access the container.")) {
          this.uploadError = this.currentBucket ?
            this.$t("message.upload.accessFail")
            : this.$t("message.error.createFail")
              .concat(" ", this.$t("message.error.inUseOtherPrj"));
        }
        else if (this.abortReason?.match("cancel")) {
          this.uploadError = this.$t("message.upload.cancelled");
        }
        this.$store.setUploadAbortReason(undefined);
      }
    },
    uploadError() {
      if (this.uploadError) addErrorToastOnMain(this.uploadError);
    },
  },
  updated() {
    if (this.dropFiles.length) {
      //hide itemsPerPageOptions
      const table = document.querySelector("c-data-table.files-table");
      const pagination = table?.shadowRoot.querySelector("c-pagination");
      const menu = pagination?.shadowRoot.querySelector("c-menu");
      menu?.setAttribute("hidden", "true");
    }
  },
  methods: {
    getHumanReadableSize,
    checkPage(event) {
      const page = checkIfItemIsLastOnPage(
        {
          currentPage: event.target.pagination.currentPage ,
          itemsPerPage: event.target.pagination.itemsPerPage,
          itemCount: event.target.pagination.itemCount,
        });
      this.filesPagination.currentPage = page;
    },
    appendDropFiles(file, overwrite = false) {
      if (file?.size === 0) {
        this.dropFileErrors[1].show = true;
        setTimeout(() => this.dropFileErrors[1].show = false, 6000);
        return;
      }

      // Destination key is the current folder prefix + relative path.
      // prefixApplied guards against prepending twice when a file
      // re-enters via the overwrite confirmation.
      const rp = file.relativePath || file.name;
      const effectivePath = file.prefixApplied
        ? rp
        : `${this.getCurrentPrefix()}${rp}`;

      //Check if file path already exists in dropFiles
      if (
        this.dropFiles.find(
          ({ relativePath }) => relativePath === effectivePath,
        ) === undefined
      ) {
        if (this.objects && !overwrite) {
          //Check if file already exists in container objects
          const existingFile = this.objects.find(obj => obj.name === effectivePath);
          if (existingFile) {
            file.relativePath = effectivePath;
            file.prefixApplied = true;
            this.existingFiles.push(file);
            return;
          }
        }
        file.relativePath = effectivePath;
        file.prefixApplied = true;
        this.$store.appendDropFiles(file);
      } else {
        this.dropFileErrors[0].show = true;
        setTimeout(() => this.dropFileErrors[0].show = false, 6000);
      }
    },
    // Get the current folder prefix from the route query
    getCurrentPrefix() {
      const raw = (this.$route.query.prefix || "").replace(/^\/+/, "");
      return raw && !raw.endsWith("/") ? `${raw}/` : raw;
    },
    // Create marker objects for any empty folders that were dropped
    async createEmptyFolders() {
      if (this.emptyFolders.length === 0) return;

      const container = this.currentBucket || (this.inputBucket || "").trim();
      if (!container) return;

      // Ensure the bucket exists and has CORS when uploading to a new one
      if (!this.currentBucket) {
        const accessible = await checkBucketAccessible(container);
        if (!accessible) {
          try {
            await awsCreateBucket(this.active.id, container);
            await awsAddBucketCors(this.active.id, container);
          } catch (e) {
            if (DEV) console.log("Couldn't create bucket", container, e);
            this.uploadError = this.$t("message.container_ops.folderCreateFail");
            return;
          }
        }
      }

      const prefix = this.getCurrentPrefix();
      const folders = Array.from(new Set(this.emptyFolders)).sort();

      for (const p of folders) {
        const path = `${prefix}${p.endsWith("/") ? p : p + "/"}`;
        try {
          await awsPutObject(container, path);
        } catch {
          this.uploadError = this.$t("message.container_ops.folderCreateFail");
        }
      }
      this.emptyFolders = [];
    },
    getDropTablePage() {
      const offset =
        this.filesPagination.currentPage
        * this.filesPagination.itemsPerPage
        - this.filesPagination.itemsPerPage;

      const limit = this.filesPagination.itemsPerPage;
      const fileRows = this.dropFiles
        .sort((a, b) => sortItems(
          a, b, this.sortBy, this.sortDirection))
        .map(file => {
          return {
            name: { value: file.name || truncate(100) },
            type: { value: file.type },
            size: { value: getHumanReadableSize(file.size, this.locale) },
            relativePath: {
              value: file.relativePath || truncate(100),
            },
            delete: {
              children: [
                {
                  value: "",
                  component: {
                    tag: "c-button",
                    params: {
                      text: true,
                      size: "small",
                      onClick: () => {
                        this.deleteDropFile(file);
                      },
                      onKeyUp: (e) => {
                        if(e.keyCode === 13) {
                          this.deleteDropFile(file);
                        }
                      },
                    },
                  },
                  children: [
                    {
                      value: "",
                      component: {
                        tag: "c-icon",
                        params: {
                          path: mdiDelete,
                          size: "18",
                        },
                      },
                    },
                    {
                      value: this.$t("message.upload.remove"),
                      component: {
                        tag: "span",
                      },
                    },
                  ],
                },
              ],
            },
          };
        });

      // Empty folders dropped for creation as marker objects
      const folderRows = Array.from(new Set(this.emptyFolders))
        .sort()
        .map(p => ({
          name: { value: p.replace(/\/$/, "") },
          type: { value: this.$t("message.objects.folder") },
          size: { value: "-" },
          relativePath: { value: `${this.getCurrentPrefix()}${p}` },
          delete: {
            children: [
              {
                value: "",
                component: {
                  tag: "c-button",
                  params: {
                    text: true,
                    size: "small",
                    onClick: () => {
                      this.emptyFolders =
                        this.emptyFolders.filter(x => x !== p);
                      this.getDropTablePage();
                    },
                  },
                },
                children: [
                  {
                    value: "",
                    component: {
                      tag: "c-icon",
                      params: {
                        path: mdiDelete,
                        size: "18",
                      },
                    },
                  },
                  {
                    value: this.$t("message.upload.remove"),
                    component: {
                      tag: "span",
                    },
                  },
                ],
              },
            ],
          },
        }));

      this.paginatedDropFiles = [...fileRows, ...folderRows]
        .slice(offset, offset + limit);

      this.filesPagination = {
        ...this.filesPagination,
        itemCount: this.dropFiles.length
          + new Set(this.emptyFolders).size,
      };
    },
    onSort(event) {
      this.sortBy = event.detail.sortBy;
      this.sortDirection = event.detail.direction;
      this.getDropTablePage();
    },
    deleteDropFile(file) {
      this.$store.eraseDropFile(file);
      const i = this.filesToOverwrite.findIndex(
        (f) => f.relativePath === file.relativePath);
      if (i > -1) {
        this.filesToOverwrite.splice(i, 1);
      }
    },
    overwriteFiles() {
      //if new duplicate files appear after confirmation
      // alert will show again
      for (let i = 0; i < this.existingFiles.length; i++) {
        this.appendDropFiles(this.existingFiles[i], true);
        this.filesToOverwrite.push(this.existingFiles[i]);
      }
      this.clearExistingFiles();
    },
    clearExistingFiles() {
      this.existingFiles = [];
    },
    checkBucketName: debounce(async function () {
      this.validationResult = await validateBucketName(
        this.active.id, this.inputBucket);
    }, 300),
    setFile: function (item, path) {
      let entry = undefined;
      if (item.isFile) {
        item.file(file => {
          if (this.addFiles) {
            file.relativePath = path + file.name;
            this.appendDropFiles(file);
          } else return;
        });
      } else if (item instanceof File) {
        this.appendDropFiles(item);
      } else if (item.isDirectory) {
        entry = item;
      }
      if ("function" === typeof item.webkitGetAsEntry) {
        entry = item.webkitGetAsEntry();
      }
      // Recursively process items inside a directory
      if (entry && entry.isDirectory) {
        let newPath = path + entry.name + "/";
        let dirReader = entry.createReader();
        let allEntries = [];

        let readEntries = () => {
          dirReader.readEntries(entries => {
            if (this.addFiles) {
              if (entries.length) {
                allEntries = allEntries.concat(entries);
                return readEntries();
              }
              // No entries at all — an empty folder was dropped
              if (allEntries.length === 0) {
                this.emptyFolders.push(newPath);
                this.getDropTablePage();
              }
              for (let item of allEntries) {
                if (this.addFiles) {
                  this.setFile(item, newPath);
                }
              }
            } else return; //modal was closed
          });
        };
        readEntries();
      } else if ("function" === typeof item.getAsFile) {
        item = item.getAsFile();
        if (item instanceof File) {
          item.relativePath = path + item.name;
          this.appendDropFiles(item);
        }
      }
    },
    setFiles: function (files) {
      if (files.length > 0) {
        for (let file of files) {
          let entry = file;
          this.setFile(entry, "");
        }
      }
    },
    dragHandler: function (e) {
      e.preventDefault();
      let dt = e.dataTransfer;
      if (dt.types.indexOf("Files") >= 0) {
        const el = document.querySelector(".dropArea");
        el.classList.add("over-dropArea");
        e.stopPropagation();
        dt.dropEffect = "copy";
        dt.effectAllowed = "copy";
      } else {
        dt.dropEffect = "none";
        dt.effectAllowed = "none";
      }
    },
    dragLeaveHandler: function () {
      const el = document.querySelector(".dropArea");
      el.classList.remove("over-dropArea");
    },
    navUpload: function (e) {
      this.addingFiles = true;
      e.stopPropagation();
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.items) {
        this.setFiles(e.dataTransfer.items);
      } else if (e.dataTransfer && e.dataTransfer.files) {
        this.setFiles(e.dataTransfer.files);
      }
      const el = document.querySelector(".dropArea");
      el.classList.remove("over-dropArea");
    },
    cancelUpload() {
      this.$store.setFilesAdded(false);
      this.$store.eraseDropFiles();
      this.toggleUploadModal();
    },
    toggleUploadModal() {
      document.querySelector("#uploadModal-toasts").removeToast("upload-toast");
      for (let i = 0; i < this.dropFileErrors.length; i++) {
        this.dropFileErrors[i].show = false;
      }
      this.$store.toggleUploadModal(false);
      this.addingFiles = false;
      this.tags = [];
      this.files = [];
      this.emptyFolders = [];
      this.validationResult = {};
      this.toastMsg = "";
      this.sortBy = "name";
      this.sortDirection = "asc";
      this.filesPagination.currentPage = 1;
      this.uploadError = "";
    },
    checkIfCanUpload() {
      if (this.dropFiles.length === 0 && this.emptyFolders.length === 0) {
        return this.$t("message.upload.addFiles");
      }
      return "";
    },
    async onUploadClick() {
      if (!this.currentBucket) {
        this.validationResult =
          await validateBucketName(this.active.id, this.inputBucket);
        const validationError =
          Object.values(this.validationResult).some(val => !val);
        if (validationError) return;
      }
      this.toastMsg = this.checkIfCanUpload();
      if (this.toastMsg) {
        document.querySelector("#uploadModal-toasts").addToast(
          {
            id: "upload-toast",
            type: "error",
            duration: 4000,
            progress: false,
            message: this.toastMsg,
          },
        );
        return;
      }
      // Only empty folders, no files: create the markers and close
      if (this.dropFiles.length === 0) {
        await this.createEmptyFolders();
        this.toggleUploadModal();
        return;
      }
      if (this.emptyFolders.length > 0) {
        await this.createEmptyFolders();
      }
      this.beginUpload();
    },
    async startUpload() {
      const bucketName = this.currentBucket ?
        this.currentBucket :
        this.inputBucket;

      this.$store.setUploadBucket(
        { name: bucketName, owner: this.$route.params.owner },
      );
      this.$store.setNewBucket(bucketName);

      this.s3socket.addUploads(
        bucketName,
        this.$store.dropFiles.map(item => item),
      );
    },
    beginUpload() {
      this.startUpload().then(() => {
        delay(() => {
          if (this.$store.uploadProgress === undefined && this.dropFiles.length) {
            //upload didn't start
            this.uploadError = this.$t("message.upload.error");
            this.$store.stopUploading(true);
            this.$store.toggleUploadNotification(false);
          }
        }, 3000);
        this.toggleUploadModal();
      });
    },
    handleKeyDown: function (e) {
      if (e.key === "Escape") {
        this.toggleUploadModal();
      } else {
        captureKeyboardNavInsideModal(e, this.$refs.uploadContainer);
      }
    },
  },
};
</script>

<style scoped>

c-card-actions {
  padding: 0;
}

.title.is-6 {
  margin: 0 !important;
}

.dropArea {
  border: 1px dashed var(--csc-medium-grey);
  padding: 2rem 0;
  display: flex;
  align-items: center;
  justify-content: center;
  & > span:first-of-type {
    margin-right: 1rem;
  }
}

.over-dropArea {
  border: 2px dashed var(--c-primary-600);
}

c-data-table.files-table {
  margin-top: -24px;
}

c-data-table.publickey-table {
  margin-top: 1rem;
}

.drop-file-notification {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

c-accordion c-button {
  margin-top: 0.5rem;
}

c-accordion h3 {
  padding: 1rem 0;
}

.content-div {
  & > * {
    margin: 1rem 0;
  }
}

</style>
