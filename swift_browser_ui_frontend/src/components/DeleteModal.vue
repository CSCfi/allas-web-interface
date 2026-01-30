<template>
  <c-card
    id="delete-objs-modal"
    ref="deleteObjsModal"
    class="delete-modal"
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
import {
  swiftDeleteObjects,
  getObjects,
  swiftDeleteContainer,
  removeAccessControlMeta,
  getContainerMeta,
  swiftCreateEmptyObject,
} from "@/common/api";
import { deleteStaleSharedContainers } from "@/common/conv";
import { getDB } from "@/common/db";

import { isFile } from "@/common/globalFunctions";
import {
  getFocusableElements,
  addFocusClass,
  removeFocusClass,
  moveFocusOutOfModal,
} from "@/common/keyboardNavigation";

export default {
  name: "DeleteModal",
  data() {
    return {
      isDeleting: false,
      deleteTotal: 0,
      deletedSoFar: 0,
    };
  },
  computed: {
    selectedObjects() {
      return this.$store.state.deletableObjects.length > 0
        ? this.$store.state.deletableObjects
        : [];
    },
    progress() {
      return this.deleteTotal > 0 ? this.deletedSoFar / this.deleteTotal : undefined;
    },
    progressPercent() {
      if (this.progress === undefined) return undefined;
      return Math.min(100, Math.round(this.progress * 100));
    },
    subfolders() {
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
      return this.$store.state.renderedFolders;
    },
    modalVisible() {
      return this.$store.state.openDeleteModal;
    },
  },
  watch: {
    modalVisible() {
      if (this.modalVisible) this.isDeleting = false;
    },
  },
  methods: {
    toggleDeleteModal: function(keypress) {
      this.$store.commit("toggleDeleteModal", false);
      this.$store.commit("setDeletableObjects", []);
      this.deletedSoFar = 0;
      this.deleteTotal = 0;

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
    // Extract object count from container metadata
    countFromMeta(metaTuple) {
      try {
        const headers = metaTuple?.[1] || {};
        const v = headers["X-Container-Object-Count"] ?? headers["x-container-object-count"];
        return Number(v) || 0;
      } catch { return 0; }
    },

    // Batch delete utility
    async batchDelete(keys, projectID, containerName) {
      const BATCH = 1000;
      for (let i = 0; i < keys.length; i += BATCH) {
        const chunk = keys.slice(i, i + BATCH);
        await swiftDeleteObjects(projectID, containerName, chunk);
        this.deletedSoFar += chunk.length;
      }
    },
    deleteObjects: async function () {
      this.isDeleting = true;
      this.deletedSoFar = 0;
      this.deleteTotal = 0;

      // wait for the modal to update
      await this.$nextTick();

      // get unique values from an array
      const unique = (arr) => Array.from(new Set(arr));

      // list all files under a given folder recursively from IndexedDB
      const expandFolderToKeys = async (folderName) => {
        const prefix = folderName.endsWith("/") ? folderName : `${folderName}/`;
        const files = await getDB().objects
          .filter(obj => obj.container === this.container && obj.name.startsWith(prefix))
          .toArray();
        return files.map(f => f.name);
      };

      // Delete all objects in a container using pagination
      const deleteContainerObjectsByMarker = async (projectID, contName) => {
        let marker = ""; // first page
        while (true) {
          // get next page of objects
          const page = await getObjects(projectID, contName, marker) || [];
          if (!page.length) break;

          // delete this page of objects
          const keys = page.map(o => o.name);
          await this.batchDelete(keys, projectID, contName);

          // set marker for next page
          marker = page[page.length - 1].name;
        }
      };

      // Multiple container deletion check
      const containersToDelete = (this.selectedObjects || []).filter(o => o?.isContainer === true);
      if (containersToDelete.length) {
        const projectForCalls = this.owner || this.projectID;

        // progress total (main + _segments for each)
        this.deletedSoFar = 0;
        this.deleteTotal = 0;
        for (const c of containersToDelete) {
          try {
            const mainMeta = await getContainerMeta(projectForCalls, c.name);
            this.deleteTotal += this.countFromMeta(mainMeta);
          } catch {}
          try {
            const segMeta = await getContainerMeta(projectForCalls, `${c.name}_segments`);
            this.deleteTotal += this.countFromMeta(segMeta);
          } catch {}
        }

        // delete each bucket fully
        for (const { name: containerName } of containersToDelete) {
          // main container objects
          await deleteContainerObjectsByMarker(projectForCalls, containerName);

          // Delete segments buckets if exists and its objects
          const segContainer = `${containerName}_segments`;
          try {
            await deleteContainerObjectsByMarker(projectForCalls, segContainer);
            try { await swiftDeleteContainer(projectForCalls, segContainer); } catch (e) {}
          } catch (e) {}

          // Delete the main bucket
          await swiftDeleteContainer(projectForCalls, containerName);

          // shared metadata cleanup
          try {
            const sharedDetails = await this.$store.state.client.getShareDetails(
              this.projectID,
              containerName,
            );

            if (sharedDetails?.length) {
              await removeAccessControlMeta(this.projectID, containerName);
              await deleteStaleSharedContainers(this.$store);
            }
          } catch (e) {}

          // Delete from IndexedDB
          try {
            const db = getDB();
            const cont = await db.containers.get({ projectID: this.projectID, name: containerName });
            if (cont) {
              const objs = await db.objects.where({ containerID: cont.id }).toArray();
              if (objs?.length) await db.objects.bulkDelete(objs.map(o => o.id));
              await db.containers.delete(cont.id);
            }
          } catch (e) {}
        }

        // Show success message
        document.querySelector("#container-toasts")?.addToast({
          progress: false,
          type: "success",
          message: this.$t("message.container_ops.deleteSuccess"),
        });

        try {
          await this.$store.dispatch("updateContainers", {
            projectID: this.projectID,
          });
        } catch (e) {}

        this.toggleDeleteModal();
        return; // bucket flow done
      }

      // File / folder (prefix) deletion inside a bucket
      let to_remove = [];
      let segments_to_remove = []; // Array for segment objects to be deleted
      let segment_container = null;

      const isSegmentsContainer = this.container.endsWith("_segments");

      if (!isSegmentsContainer && this.selectedObjects?.length) {
        // find sibling segments bucket for the SAME main bucket
        segment_container = await getDB().containers.get({
          projectID: this.projectID,
          name: `${this.selectedObjects[0].container}_segments`,
        });
      }

      // Pre-fetch segment objects if segment container exists
      let segment_objects = [];
      if (segment_container) {
        try {
          segment_objects = await getObjects(
            this.owner || this.projectID,
            segment_container.name,
          );
        } catch (e) {
          segment_objects = [];
        }
      }

      for (const object of this.selectedObjects) {
        // Determine if object is a file or folder
        const isAFile = isFile(object.name, this.$route);
        const explicitFolder = object?.isFolder === true;
        const treatAsFolder = explicitFolder || (!isAFile && this.renderedFolders);

        if (!treatAsFolder)  {
          // Files: delete directly
          to_remove.push(object.name);

          if (segment_container && segment_objects.length) {
            for (const seg of segment_objects) {
              if (seg.name.includes(`${object.name}/`)) {
                segments_to_remove.push(seg.name);
              }
            }
          }
        } else {
          // Folders: need to expand to all files inside
          const folderFiles = await expandFolderToKeys(object.name);
          to_remove.push(...folderFiles);

          // If the folder is empty, delete the folder marker too
          if (!folderFiles.includes(object.name)) {
            to_remove.push(object.name);
          }

          // Also delete any segments that match the folder prefix
          if (segment_container && segment_objects.length) {
            const prefixNorm = object.name.endsWith("/") ? object.name : `${object.name}/`;
            for (const seg of segment_objects) {
              if (seg.name.startsWith(prefixNorm) || (folderFiles.length && folderFiles.some(f => seg.name.includes(`${f}/`)))) {
                segments_to_remove.push(seg.name);
              }
            }
          }
        }
      }

      // Check if any subfolder is selected for deletion
      to_remove = unique(to_remove);
      segments_to_remove = unique(segments_to_remove);

      // Initialize progress tracking
      this.deleteTotal = (to_remove?.length || 0) + (segments_to_remove?.length || 0);
      this.deletedSoFar = 0;

      // Perform batch deletions
      if (to_remove.length) {
        await this.batchDelete(to_remove, this.owner || this.projectID, this.container);
      }
      if (segment_container && segments_to_remove.length) {
        await this.batchDelete(segments_to_remove, this.owner || this.projectID, segment_container.name);
      }


      // Delete from IndexedDB
      const db = getDB();
      const cont = await db.containers.get({ projectID: this.projectID, name: this.container });
      if (cont && to_remove.length) {
        const rows = await db.objects
          .where({ containerID: cont.id })
          .filter(o => to_remove.includes(o.name))
          .toArray();
        if (rows.length) await db.objects.bulkDelete(rows.map(r => r.id));
      }

      // If we deleted all objects inside a folder, recreate the folder marker
      try {
        const isSegmentsContainer = this.container.endsWith("_segments");
        const currentPrefix = (this.$route.query.prefix || "").replace(/^\/+/, "");
        const markerName = currentPrefix ? (currentPrefix.endsWith("/") ? currentPrefix : currentPrefix + "/") : "";

        const userExplicitlyDeletedFolder =
          !!markerName && this.selectedObjects.some(o => o?.name === markerName);

        if (!isSegmentsContainer && this.renderedFolders && markerName && !userExplicitlyDeletedFolder && cont) {
          const remaining = await db.objects
            .where({ containerID: cont.id })
            .filter(o => o.name.startsWith(currentPrefix))
            .count();

          if (remaining === 0) {
            // Recreate the folder marker so the folder remains visible
            await swiftCreateEmptyObject(
              this.owner || this.projectID,
              this.container,
              markerName,
              this.owner,
            );
          }
        }
      } catch (_) {}

      // Update the store with the new object list
      try {
        await this.$store.dispatch("updateObjects", {
          projectID: this.projectID,
          container: cont,
        });
      } catch (e) {}

      // Refresh the object list after deletion
      document.getElementById("obj-table")?.clearSelections();
      this.toggleDeleteModal();
      this.getDeleteMessage(to_remove);
    },
    getDeleteMessage: async function(to_remove) {
      // Only files can be deleted
      // Show warnings when deleting subfolders
      if (to_remove.length > 0) {
        let msg;
        to_remove.length === 1?
          msg = to_remove.length + this.$t("message.objects.deleteOneSuccess")
          : msg = to_remove.length +
            this.$t("message.objects.deleteManySuccess");

        if (this.subfolders.length && this.renderedFolders) {
          //get all files uppermost subfolder contains
          const folderFiles = await getDB().objects
            .filter(obj => obj.name.startsWith(this.subfolders[0])
              && obj.container === this.container)
            .toArray();
          if (folderFiles.length < 1) {
            //if all subfolders empty, go to container
            //see if more than one subfolder removed
            this.subfolders.length > 1 ?
              msg = this.$t("message.subfolders.deleteManySuccess") :
              msg = this.$t("message.subfolders.deleteOneSuccess");
            this.$router.push({name: "ObjectsView"});
          }
          else {
            let newPrefix = this.prefix;
            for (let level=0; level < this.subfolders.length; level++) {
              let found = folderFiles.find(obj =>
                obj.name.startsWith(newPrefix));
              if (found !== undefined) {
                //if file with this prefix found
                //go to containing subfolder
                //files found at same level: leave "file(s) deleted" ^
                //otherwise show "subfolder(s) deleted"
                if (level > 0) {
                  level > 1 ?
                    msg = this.$t("message.subfolders.deleteManySuccess") :
                    msg = this.$t("message.subfolders.deleteOneSuccess");
                  let path =
                    {name: "ObjectsView", query: { prefix: newPrefix}};
                  this.$router.push(path);
                }
                break;
              } else {
                //files with this prefix not found
                //go up a subfolder and check again
                newPrefix = newPrefix
                  .substring(0, newPrefix.lastIndexOf("/"));
              }
            }
          }
        }
        document.querySelector("#objects-toasts").addToast(
          { progress: false,
            type: "success",
            message: msg,
          },
        );
      }
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

.delete-modal {
  padding: 0px;
}

c-progress-bar {
  padding: 0.5rem;
}

</style>
