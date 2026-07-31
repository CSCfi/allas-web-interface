<template>
  <c-card
    id="delete-objs-modal"
    ref="deleteObjsModal"
    class="no-padding-card"
    @keydown="handleKeyDown"
  >
    <c-alert
      v-if="!isDeleting"
      type="error"
    >
      <div slot="title">
        {{ $t("message.objects.deleteObjects") }}
      </div>

      {{ owner ?
        $t("message.objects.deleteSharedObjects") :
        $t("message.objects.deleteObjectsMessage")
      }}

      <c-card-actions justify="end">
        <c-button
          outlined
          @click="toggleDeleteModal(false)"
          @keyup.enter="toggleDeleteModal(true)"
        >
          {{ $t("message.cancel") }}
        </c-button>
        <c-button
          id="delete-objs-btn"
          data-testid="confirm-delete-objects"
          @click="deleteObjects()"
          @keyup.enter="deleteObjects()"
        >
          {{ $t("message.objects.deleteConfirm") }}
        </c-button>
      </c-card-actions>
    </c-alert>
    <c-alert
      v-else
      type="success"
    >
      <div slot="title">
        {{ $t("message.objects.deleteInProgress") }}
      </div>
      <c-progress-bar
        v-if="progressPercent !== undefined"
        :value="progressPercent"
        single-line
      />
      <c-progress-bar
        v-else
        single-line
        indeterminate
      />
    </c-alert>
  </c-card>
</template>

<script>
import { getDB } from "@/common/idb";
import { updateBucketStats } from "@/common/idbFunctions";
import { isFile } from "@/common/globalFunctions";
import {
  getFocusableElements,
  addFocusClass,
  removeFocusClass,
  moveFocusOutOfModal,
} from "@/common/keyboardNavigation";
import {
  awsDeleteBucket,
  awsDeleteObjects,
  awsListObjects,
  awsPutObject,
} from "@/common/s3commands";
import { deleteStaleShares } from "@/common/share";

export default {
  name: "DeleteModal",
  data() {
    return {
      isDeleting: false,
      bucketObjects: [],
      deleteTotal: 0,
      deletedSoFar: 0,
    };
  },
  computed: {
    selectedObjects() {
      return this.$store.deletableObjects.length > 0
        ? this.$store.deletableObjects
        : [];
    },
    progress() {
      return this.deleteTotal > 0 ? this.deletedSoFar / this.deleteTotal : undefined;
    },
    progressPercent() {
      if (this.progress === undefined) return undefined;
      return Math.min(100, Math.round(this.progress * 100));
    },
    folders() {
      return this.$route.query.prefix ?
        this.$route.query.prefix.split("/") : [];
    },
    prefix() {
      return this.$route.query.prefix;
    },
    projectID() {
      return this.$route.params.project;
    },
    container() {
      return this.$route.params.container;
    },
    owner() {
      return this.$route.params.owner;
    },
    renderedFolders() {
      return this.$store.renderedFolders;
    },
    modalVisible() {
      return this.$store.openDeleteModal;
    },
  },
  watch: {
    async modalVisible() {
      if (this.modalVisible) {
        this.isDeleting = false;
        this.deleteTotal = 0;
        this.deletedSoFar = 0;
        const isBucketDelete = (this.selectedObjects || []).some(o => o?.isContainer === true);
        if (!isBucketDelete && this.container) {
          this.bucketObjects = await awsListObjects(this.container);
        }
      }
    },
  },
  methods: {
    toggleDeleteModal: function(keypress) {
      this.$store.toggleDeleteModal(false);
      this.$store.setDeletableObjects([]);
      this.deleteTotal = 0;
      this.deletedSoFar = 0;

      /*
        Prev Active element is a popup menu and it is removed from DOM
        when we click it to open Delete Modal.
        Therefore, we need to make its focusable parent
        to be focused instead after we close the modal.
      */
      if (keypress) {
        const prevActiveElParent = document.getElementById("obj-table");
        moveFocusOutOfModal(prevActiveElParent, true);
      }
    },
    async batchDelete(keys, bucket) {
      const BATCH = 1000;
      for (let i = 0; i < keys.length; i += BATCH) {
        const chunk = keys.slice(i, i + BATCH);
        await awsDeleteObjects(bucket, chunk);
        this.deletedSoFar += chunk.length;
      }
    },
    deleteObjects: async function () {
      this.isDeleting = true;
      this.deletedSoFar = 0;
      this.deleteTotal = 0;
      await this.$nextTick();

      const unique = (arr) => Array.from(new Set(arr));

      // Bucket (container) deletion flow
      const containersToDelete = (this.selectedObjects || []).filter(o => o?.isContainer === true);
      if (containersToDelete.length) {
        const projectID = this.projectID;

        // Phase 1: list all objects so we can show accurate progress
        const deletionPlan = [];
        for (const { name: bucketName } of containersToDelete) {
          const allObjects = await awsListObjects(bucketName) || [];
          const segBucketName = `${bucketName}_segments`;
          let segObjects = [];
          try { segObjects = await awsListObjects(segBucketName) || []; } catch {}
          deletionPlan.push({ bucketName, segBucketName, objects: allObjects, segObjects });
        }
        this.deleteTotal = deletionPlan.reduce(
          (sum, p) => sum + p.objects.length + p.segObjects.length, 0,
        );

        // Phase 2: delete objects, then buckets
        for (const { bucketName, segBucketName, objects, segObjects } of deletionPlan) {
          if (objects.length) {
            await this.batchDelete(objects.map(o => o.name), bucketName);
          }
          if (segObjects.length) {
            await this.batchDelete(segObjects.map(o => o.name), segBucketName);
            try { await awsDeleteBucket(segBucketName); } catch {}
          }
          await awsDeleteBucket(bucketName);

          // Remove from IDB so liveQuery updates Containers.vue
          try {
            const cont = await getDB().containers.get({ projectID, name: bucketName });
            if (cont) await getDB().containers.delete(cont.id);
          } catch {}

          // Clean up stale shares
          try {
            const sharedDetails = await this.$store.sharingClient?.getShareDetails(
              projectID, bucketName,
            );
            if (sharedDetails?.length) await deleteStaleShares(projectID, bucketName);
          } catch {}
        }

        document.querySelector("#container-toasts")?.addToast({
          progress: false,
          type: "success",
          message: this.$t("message.container_ops.deleteSuccess"),
        });
        this.toggleDeleteModal();
        return;
      }

      // File / folder deletion inside a bucket
      let to_remove = [];
      let segments_to_remove = [];
      let segment_container = null;

      const isSegmentsContainer = this.container?.endsWith("_segments");

      // Expand a folder name to all file keys using the already-loaded bucketObjects
      const expandFolderToKeys = (folderName) => {
        const prefix = folderName.endsWith("/") ? folderName : `${folderName}/`;
        return this.bucketObjects
          .filter(obj => obj.name.startsWith(prefix))
          .map(f => f.name);
      };

      if (!isSegmentsContainer && this.selectedObjects?.length) {
        segment_container = await getDB().containers.get({
          projectID: this.projectID,
          name: `${this.selectedObjects[0].container}_segments`,
        });
      }

      let segment_objects = [];
      if (segment_container) {
        try { segment_objects = await awsListObjects(segment_container.name) || []; } catch {}
      }

      for (const object of this.selectedObjects) {
        const isAFile = isFile(object.name, this.$route);
        const explicitFolder = object?.isFolder === true;
        const treatAsFolder = explicitFolder || (!isAFile && this.renderedFolders);

        if (!treatAsFolder) {
          to_remove.push(object.name);
          if (segment_container && segment_objects.length) {
            for (const seg of segment_objects) {
              if (seg.name.includes(`${object.name}/`)) {
                segments_to_remove.push(seg.name);
              }
            }
          }
        } else {
          // Folders: expand to all contained files
          const folderFiles = expandFolderToKeys(object.name);
          to_remove.push(...folderFiles);
          // Include folder marker object itself if not already in the list
          if (!folderFiles.includes(object.name)) {
            to_remove.push(object.name);
          }
          if (segment_container && segment_objects.length) {
            const prefixNorm = object.name.endsWith("/") ? object.name : `${object.name}/`;
            for (const seg of segment_objects) {
              if (
                seg.name.startsWith(prefixNorm) ||
                folderFiles.some(f => seg.name.includes(`${f}/`))
              ) {
                segments_to_remove.push(seg.name);
              }
            }
          }
        }
      }

      to_remove = unique(to_remove);
      segments_to_remove = unique(segments_to_remove);
      this.deleteTotal = to_remove.length + segments_to_remove.length;

      this.$store.setDeleting(true);
      if (to_remove.length) {
        try {
          await this.batchDelete(to_remove, this.container);
        } catch {
          document.querySelector("#objects-toasts").addToast({
            progress: false,
            type: "error",
            message: this.$t("message.objects.deleteObjectsError"),
          });
          this.clearDelete();
          return;
        }
      }
      if (segments_to_remove.length && segment_container) {
        try { await this.batchDelete(segments_to_remove, segment_container.name); } catch {}
      }

      this.bucketObjects = this.bucketObjects.filter(item => !to_remove.includes(item.name));

      // If the folder we're currently inside became empty (and the user
      // didn't explicitly delete the folder itself), recreate its marker
      // object so it survives as an empty folder
      const rawPrefix = (this.$route.query.prefix || "").replace(/^\/+/, "");
      const markerName = rawPrefix
        ? (rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`)
        : "";
      const explicitlyDeletedCurrent = !!markerName &&
        this.selectedObjects.some(o => o?.name === markerName);
      if (!isSegmentsContainer && this.renderedFolders && markerName &&
        !explicitlyDeletedCurrent) {
        const remaining = this.bucketObjects
          .filter(o => o.name.startsWith(markerName)).length;
        if (remaining === 0) {
          try {
            await awsPutObject(this.container, markerName);
            this.bucketObjects.push({ name: markerName, bytes: 0 });
          } catch {
            // folder simply disappears if the marker can't be created
          }
        }
      }

      if (to_remove.length) {
        await updateBucketStats(this.projectID, this.container, null, null);
      }
      this.getDeleteMessage(to_remove);
      this.clearDelete();
    },
    getDeleteMessage: async function(to_remove) {
      if (to_remove.length > 0) {
        let msg;
        to_remove.length === 1
          ? msg = to_remove.length + this.$t("message.objects.deleteOneSuccess")
          : msg = to_remove.length + this.$t("message.objects.deleteManySuccess");

        if (this.folders.length && this.renderedFolders) {
          const folderExists = this.bucketObjects
            .find(obj => obj.name.startsWith(this.folders[0]));
          if (!folderExists) {
            this.folders.length > 1
              ? msg = this.$t("message.folders.deleteManySuccess")
              : msg = this.$t("message.folders.deleteOneSuccess");
            this.$router.push({name: "ObjectsView"});
          } else {
            let newPrefix = this.prefix;
            for (let level = 0; level < this.folders.length; level++) {
              let found = this.bucketObjects.find(obj => obj.name.startsWith(newPrefix));
              if (found !== undefined) {
                if (level > 0) {
                  level > 1
                    ? msg = this.$t("message.folders.deleteManySuccess")
                    : msg = this.$t("message.folders.deleteOneSuccess");
                  this.$router.push({name: "ObjectsView", query: { prefix: newPrefix}});
                }
                break;
              } else {
                newPrefix = newPrefix.substring(0, newPrefix.lastIndexOf("/"));
              }
            }
          }
        }
        document.querySelector("#objects-toasts").addToast({
          progress: false,
          type: "success",
          message: msg,
        });
      }
    },
    clearDelete: function () {
      this.$store.setDeleting(false);
      const dataTable = document.getElementById("obj-table");
      dataTable.clearSelections();
      this.toggleDeleteModal();
    },
    handleKeyDown: function (e) {
      const focusableList = this.$refs.deleteObjsModal.querySelectorAll(
        "c-button",
      );
      const { first, last } = getFocusableElements(focusableList);

      if (e.key === "Tab" && !e.shiftKey) {
        if (e.target === last) {
          removeFocusClass(last);
          first.tabIndex="0";
          first.focus();
          addFocusClass(first);
        } else if (e.target === first) {
          removeFocusClass(first);
          last.tabIndex="0";
          last.focus();
          addFocusClass(last);
        }
      }
      else if (e.key === "Tab" && e.shiftKey) {
        if (e.target === first) {
          e.preventDefault();
          last.tabIndex = "0";
          last.focus();
          if (last === document.activeElement) {
            addFocusClass(last);
          }
        } else if (e.target === last) {
          removeFocusClass(last);
        }
      }
    },
  },
};
</script>

<style scoped>

c-progress-bar {
  padding: 0.5rem;
}

</style>
