// Vuex store for the variables that need to be globally available.
import { createStore } from "vuex";
import { isEqual, isEqualWith } from "lodash";

import {
  getContainers,
  getObjects,
  getCopyStatus,
  cancelCopy,
  getPublicBaseAddress,
} from "@/common/api";
import {
  getTagsForContainer,
  getMetadataForSharedContainer,
  getTagsForObjects,
  makeGetObjectsMetaURL,
  tokenize,
  addSegmentContainerSize,
  sortContainer,
} from "@/common/conv";

import { getDB } from "@/common/db";
import {
  getSharedContainers,
  getContainerLastmodified,
  updateContainerLastmodified,
} from "@/common/globalFunctions";

const pollers = {};

const store = createStore({
  state: {
    projects: [],
    active: {},
    uname: "",
    multipleProjects: false,
    langs: [
      { ph: "In English", value: "en" },
      { ph: "Suomeksi", value: "fi" },
    ],
    client: undefined,
    requestClient: undefined,
    socket: undefined,
    isUploading: false,
    uploadProgress: undefined,
    uploadNotification: {
      visible: false,
      maximized: true,
    },
    downloadCount: 0,
    downloadProgress: undefined,
    downloadNotification: {
      visible: false,
      maximized: true,
    },
    downloadAbortReason: undefined,
    dropFiles: [],
    openConfirmRouteModal: false,
    routeTo: {},
    openCreateFolderModal: false,
    selectedFolderName: "",
    uploadFolder: {name: "", owner: ""},
    openUploadModal: false,
    openShareModal: false,
    openEditTagsModal: false,
    selectedObjectName: "",
    openCopyFolderModal: false,
    openDeleteModal: false,
    openTokenModal: false,
    deletableObjects: [],
    isFolderCopied: false,
    sourceProjectId: "",
    uploadAbortReason: undefined,
    renderedFolders: true,
    addUploadFiles: false,
    isLoaderVisible: false,
    prevActiveEl: null,
    newFolder: "",
    sharingUpdated: false,
    sharingContainers: [],
    sharedContainers: [],
    downloadStartedToastVisible: false,
    copyJobs: {},
    openObjectInfoModal: false,
    selectedObjectInfo: null,
    previewOpenedToastVisible: false,
    publicBase: "",
  },
  mutations: {
    setProjects(state, newProjects) {
      // Update the project listing in store
      state.projects = newProjects;
      if (newProjects.length > 1) {
        state.multipleProjects = true;
      } else {
        state.multipleProjects = false;
      }
    },
    setActive(state, newActive) {
      // Update the active project in store
      state.active = newActive;
    },
    setUname(state, newUname) {
      // Update the username in store
      state.uname = newUname;
    },
    setSharingClient(state, newClient) {
      state.client = newClient;
    },
    setRequestClient(state, newClient) {
      state.requestClient = newClient;
    },
    setUploading(state) {
      state.isUploading = true;
      if (!state.uploadNotification.visible) {
        state.uploadNotification.visible = true;
      }
    },
    stopUploading(state, cancelled = false) {
      state.isUploading = false;
      if (!cancelled) state.isLoaderVisible = true;
    },
    toggleUploadNotification(state, payload) {
      state.uploadNotification.visible = payload;
    },
    toggleUploadNotificationSize(state) {
      state.uploadNotification.maximized =
        !state.uploadNotification.maximized;
    },
    toggleDownloadNotification(state, payload) {
      state.downloadNotification.visible = payload;
    },
    toggleDownloadNotificationSize(state) {
      state.downloadNotification.maximized =
        !state.downloadNotification.maximized;
    },
    toggleDownloadStartedToast(state, val) {
      state.downloadStartedToastVisible = val;
    },
    updateProgress(state, progress) {
      state.uploadProgress = progress;
    },
    eraseProgress(state) {
      state.uploadProgress = undefined;
    },
    setDownloadAbortReason(state, payload) {
      state.downloadAbortReason = payload;
      if (state.downloadNotification.visible) {
        state.downloadNotification.visible = false;
      }
    },
    addDownload(state) {
      state.downloadCount += 1;
      if (!state.downloadNotification.visible) {
        state.downloadNotification.visible = true;
      }
    },
    removeDownload(state, all = false) {
      if (all) state.downloadCount = 0;
      else state.downloadCount -= 1;
    },
    updateDownloadProgress(state, progress) {
      state.downloadProgress = progress;
    },
    eraseDownloadProgress(state) {
      state.downloadProgress = undefined;
    },
    appendDropFiles(state, file) {
      state.dropFiles.push(file);
    },
    eraseDropFile(state, file) {
      state.dropFiles.splice(
        state.dropFiles.findIndex(
          ({ name, relativePath }) =>
            relativePath === file.relativePath &&
            name === file.name,
        ),
        1,
      );
    },
    eraseDropFiles(state) {
      state.dropFiles = [];
    },
    toggleConfirmRouteModal(state, payload) {
      state.openConfirmRouteModal = payload;
    },
    setRouteTo(state, payload) {
      state.routeTo = payload;
    },
    toggleCreateFolderModal(state, payload) {
      state.openCreateFolderModal = payload;
    },
    setFolderName(state, payload) {
      state.selectedFolderName = payload;
    },
    setUploadFolder(state, payload) {
      //separate for upload because it's needed
      //for the duration of upload for "view destination"
      state.uploadFolder.name = payload.name;
      state.uploadFolder.owner = payload.owner;
    },
    toggleUploadModal(state, payload) {
      state.openUploadModal = payload;
    },
    toggleShareModal(state, payload) {
      state.openShareModal = payload;
    },
    setUploadAbortReason(state, payload) {
      state.uploadAbortReason = payload;
    },
    setSocket(state, payload) {
      state.socket = payload;
    },
    toggleEditTagsModal(state, payload) {
      state.openEditTagsModal = payload;
    },
    setObjectName(state, payload) {
      state.selectedObjectName = payload;
    },
    toggleCopyFolderModal(state, payload) {
      state.openCopyFolderModal = payload;
    },
    toggleDeleteModal(state, payload) {
      state.openDeleteModal = payload;
    },
    toggleTokenModal(state, payload) {
      state.openTokenModal = payload;
    },
    setDeletableObjects(state, payload) {
      state.deletableObjects = payload;
    },
    setFolderCopiedStatus(state, payload) {
      state.isFolderCopied = payload;
    },
    setSourceProjectId(state, payload) {
      state.sourceProjectId = payload;
    },
    toggleRenderedFolders(state, payload) {
      state.renderedFolders = payload;
    },
    setFilesAdded(state, payload) {
      state.addUploadFiles = payload;
    },
    setLoaderVisible(state, payload) {
      state.isLoaderVisible = payload;
    },
    setPreviousActiveEl(state, payload) {
      state.prevActiveEl = payload;
    },
    setNewFolder(state, payload) {
      state.newFolder = payload;
    },
    setSharingUpdated(state, payload) {
      state.sharingUpdated = payload;
    },
    setSharingContainers(state, arr) {
      state.sharingContainers = arr || [];
    },
    setSharedContainers(state, arr) {
      state.sharedContainers = arr || [];
    },
    setCopyJob(state, job) {
      state.copyJobs[job.jobId] = job;
    },
    updateCopyJob(state, { jobId, patch }) {
      if (!state.copyJobs[jobId]) return;
      state.copyJobs[jobId] = { ...state.copyJobs[jobId], ...patch };
    },
    removeCopyJob(state, jobId) {
      delete state.copyJobs[jobId];
    },
    toggleObjectInfoModal(state, payload) {
      state.openObjectInfoModal = payload;
    },
    setSelectedObjectInfo(state, payload) {
      state.selectedObjectInfo = payload;
    },
    togglePreviewOpenedToast(state, val) {
      state.previewOpenedToastVisible = val;
    },
    setPublicBase(state, payload) {
      state.publicBase = payload || "";
    },
  },
  actions: {
    updateContainers: async function (
      { dispatch },
      { projectID, signal, routeContainer = undefined },
    ) {
      const existingContainers = await getDB()
        .containers.where({ projectID })
        .toArray();

      if (!signal) {
        const controller = new AbortController();
        signal = controller.signal;
      }

      let containers;
      let marker = "";
      let newContainers = [];
      do {
        containers = [];
        containers = await getContainers(projectID, marker, signal)
          .catch(() => {});

        if (containers?.length > 0) {
          containers.forEach(cont => {
            cont.tokens = cont.name.endsWith("_segments") ?
              [] : tokenize(cont.name);
            cont.projectID = projectID;
            cont.last_modified =  cont.name.endsWith("_segments") ?
              cont.last_modified :
              getContainerLastmodified(existingContainers, cont);
          });
          newContainers = newContainers.concat(containers);
          marker = containers[containers.length - 1].name;
        }
      } while (containers?.length > 0);

      const sharedContainers = await getSharedContainers(projectID, signal);

      if (sharedContainers.length > 0) {
        for (let i in sharedContainers) {
          let cont = sharedContainers[i];
          const { bytes, count } = await getMetadataForSharedContainer(
            projectID,
            cont.container,
            signal,
            cont.owner,
          );
          cont.tokens =  cont.container.endsWith("_segments") ?
            [] : tokenize(cont.container);
          cont.projectID = projectID;
          cont.bytes = bytes;
          cont.count = count;
          cont.name = cont.container;

          const idb_last_modified = getContainerLastmodified(
            existingContainers, cont);
          cont.last_modified = !cont.container.endsWith("_segments") &&
            idb_last_modified  && idb_last_modified > cont.sharingdate ?
            idb_last_modified : cont.sharingdate;
        }

        await getDB()
          .containers.bulkPut(sharedContainers)
          .catch(() => {});
        newContainers = newContainers.concat(sharedContainers);
      }


      const toDelete = [];
      for (let i = 0; i < existingContainers.length; i++) {
        const oldCont = existingContainers[i];
        if (!newContainers.find(cont => cont.name == oldCont.name)) {
          toDelete.push(oldCont.id);
        }
      }

      if (toDelete.length) {
        await getDB().containers.bulkDelete(toDelete);
        await getDB().objects.where("containerID").anyOf(toDelete).delete();
      }
      const containersFromDB = await getDB()
        .containers.where({ projectID })
        .toArray();

      // sort "_segments" folder before original folder
      // so that "_segments" folder could be updated first
      newContainers = sortContainer(newContainers);

      for (let i = 0; i < newContainers.length; i++) {
        addSegmentContainerSize(newContainers[i], newContainers);
      }

      let containers_to_update_objects = [];
      for (let i = 0; i < newContainers.length; i++) {
        const container = newContainers[i];
        const oldContainer = containersFromDB.find(
          cont => cont.name === container.name,
        );
        let key;
        let updateObjects = true;
        let dbObjects = 0;

        if (oldContainer !== undefined) {
          key = oldContainer.id;
          dbObjects = await getDB()
            .objects.where({ containerID: oldContainer.id })
            .count();
        }

        if (oldContainer !== undefined) {
          if (
            container.count === oldContainer.count &&
            container.bytes === oldContainer.bytes &&
            !(dbObjects === 0)
          ) {
            updateObjects = false;
          }

          if (container.count === 0) {
            updateObjects = false;
            await getDB()
              .objects.where({ containerID: oldContainer.id })
              .delete();
          }

          // Check if shared containers should be updated objects
          if (
            container.count === oldContainer.count &&
            container.bytes === oldContainer.bytes &&
            container.owner && dbObjects === 0
          ) {
            updateObjects = false;
          }
          await getDB().containers.update(oldContainer.id, container);
        } else {
          key = await getDB().containers.put(container);
        }

        if (routeContainer && container.owner) {
          if (container.name !== routeContainer &&
            container.name !== `${routeContainer}_segments`) {
          //Update the object cache only for shared container and segments
          //in current route to avoid objects flashing in UI
            updateObjects = false;
          }
        }

        if (updateObjects && !container.name.endsWith("_segments") ) {
          // Have a separate array contained containers that
          // their objects should be updated
          containers_to_update_objects.push({ container, key });
        }
      }

      await dispatch("updateContainerTags", {
        projectID: projectID,
        containers: newContainers,
        signal,
      });
      return containers_to_update_objects;
    },
    updateContainerTags: async function (_, {
      projectID, containers, signal,
    }) {
      const idbContainers = await getDB()
        .containers.where({ projectID })
        .toArray();

      for (let i = 0; i < containers.length; i++) {
        const container = containers[i];
        // Update tags for non-segment containers and for those that
        // have difference between new tags and existing tags from IDB
        if (!container.name.endsWith("_segments")) {
          const fetched =
          (await getTagsForContainer(
            projectID, container.name, signal, container.owner));
          const tags = Array.isArray(fetched) ? fetched : [];
          idbContainers.forEach(async (cont) => {
            if (cont.name === container.name && !isEqual(tags, cont.tags)) {
              await getDB().containers
                .where({ projectID, name: container.name })
                .modify({ tags });
            }
          });
        }
      }
    },
    updateObjects: async function (
      { dispatch, state },
      { projectID, owner, container, signal, updateTags },
    ) {
      const isSegmentsContainer = container.name.endsWith("_segments");
      const existingObjects = await getDB().objects
        .where({ containerID: container.id })
        .toArray();
      let newObjects = [];
      let objects;
      let marker = "";

      if (!signal) {
        const controller = new AbortController();
        signal = controller.signal;
      }

      do {
        if (owner) {
          objects = await getObjects(
            projectID,
            container.name,
            marker,
            signal,
            true,
            owner,
          );
        } else {
          objects = await getObjects(
            projectID, container.name, marker, signal);
        }

        if (objects.length > 0) {
          objects.forEach(obj => {
            obj.container = container.name;
            obj.containerID = container.id;
            obj.tokens = isSegmentsContainer ? [] : tokenize(obj.name);
            if (owner) {
              obj.containerOwner = container.owner;
            }
          });
          newObjects = newObjects.concat(objects);
          marker = objects[objects.length - 1].name;
        }
      } while (objects.length > 0);

      let toDelete = [];

      for (let i = 0; i < existingObjects.length; i++) {
        const oldObj = existingObjects[i];
        if (!newObjects.find(obj => obj.name === oldObj.name &&
          obj.containerID === oldObj.containerID)
        ) {
          toDelete.push(oldObj.id);
        }
      }

      if (toDelete.length) {
        await getDB().objects.bulkDelete(toDelete);
      }

      if (!isSegmentsContainer) {
        const segment_objects = await getObjects(
          projectID,
          `${container.name}_segments`,
          "",
          signal,
          !!owner,
          owner ? owner : "",
        );

        if (!isSegmentsContainer) {
          // Map segments by their parent object for quick lookup
          const segsByObject = new Map();
          for (const seg of segment_objects) {
            const key = seg.name.split("/")[0];
            const arr = segsByObject.get(key) || [];
            arr.push(seg);
            segsByObject.set(key, arr);
          }

          // Update sizes of objects based on their segments
          for (const obj of newObjects) {
            // skip folder markers
            if (obj.name.endsWith("/")) continue;
            // keep known non-zero sizes
            if (Number(obj.bytes ?? 0) > 0) continue;

            // find segments for this object
            const segs =
              segsByObject.get(obj.name) ||
              segment_objects.filter(s => s.name.startsWith(`${obj.name}/`));

            const total = segs.reduce((sum, s) => sum + Number(s.bytes || 0), 0);
            if (total > 0) obj.bytes = total;
          }

          // Update last_modified of container if needed
          updateContainerLastmodified(projectID, container, newObjects);
        }
      }

      for (let i = 0; i < newObjects.length; i++) {
        const newObj = newObjects[i];
        const oldObj = existingObjects.find(
          obj => obj.name === newObj.name && obj.containerID === newObj.containerID,
        );

        // Consider objects equal if all properties are equal except 'id'
        const isEqualObject = isEqualWith(oldObj, newObj, (a, b) => {
          if (a?.id && !b?.id) return true;
        });

        if (oldObj) {
          // Preserve size of object if uploading a 0-byte file
          const isFolderMarker = newObj.name.endsWith("/");
          if (!isFolderMarker &&
              Number(newObj.bytes ?? 0) === 0 &&
              Number(oldObj.bytes ?? 0) > 0) {
            newObj.bytes = oldObj.bytes;
          }

          // Preserve last_modified of object if uploading a file
          if (!isEqualObject) {
            await getDB().objects.update(oldObj.id, newObj);
          }
        } else {
          await getDB().objects.put(newObj);
        }
      }
      // Update container count if needed
      if (!isSegmentsContainer) {
        const realCount = newObjects.filter(o =>
          !(o.name.endsWith("/") && Number(o.bytes || 0) === 0),
        ).length;

        await getDB().containers.update(container.id, { count: realCount });
      }

      if (!isSegmentsContainer && updateTags) {
        await dispatch("updateObjectTags", {
          projectID,
          container,
          signal,
          owner,
        });
      }
    },
    updateObjectTags: async function (
      _,
      { projectID, container, signal, owner },
    ) {
      let objectList = [];
      const allTags = [];

      const objects = await getDB().objects
        .where({ containerID: container.id })
        .toArray();

      for (let i = 0; i < objects.length; i++) {
        // Object names end up in the URL, which has hard length limits.
        // The aiohttp complains at 8190. The maximum size
        // for object name is 1024. Set it to a safe enough amount.
        // We split the requests to prevent reaching said limits.
        objectList.push(objects[i].name);

        if (
          i === objects.length - 1 ||
          makeGetObjectsMetaURL(projectID, container.name, [
            ...objectList,
            objects[i + 1].name,
          ]).href.length >= 8190
        ) {
          const url = makeGetObjectsMetaURL(
            projectID,
            container.name,
            objectList,
          );

          let tags = await getTagsForObjects(
            projectID,
            container.name,
            objectList,
            url,
            signal,
            owner,
          );

          allTags.push(tags);
          objectList = [];
        }
      }

      if (allTags.flat().length > 0) {
        const newObjects = objects.map((obj, index) => {
          const tags = allTags.flat()[index][1];
          return {...obj, tags};
        });
        await getDB().objects.bulkPut(newObjects);
      }
    },
    startCopyJob({ commit, dispatch }, { jobId, projectId, label }) {
      commit("setCopyJob", {
        jobId,
        projectId,
        label,
        state: "running",
        done: 0,
        total: 0,
        error: "",
      });

      // start polling
      if (pollers[jobId]) clearInterval(pollers[jobId]);
      pollers[jobId] = setInterval(() => {
        dispatch("pollCopyJob", { jobId });
      }, 1500);

      dispatch("pollCopyJob", { jobId });
    },
    async pollCopyJob({ state, commit, dispatch }, { jobId }) {
      const job = state.copyJobs[jobId];
      if (!job) return;

      try {
        const s = await getCopyStatus(jobId, job.projectId);
        commit("updateCopyJob", {
          jobId,
          patch: {
            state: s.state,
            done: s.done,
            total: s.total,
            error: s.error || "",
          },
        });

        if (["finished", "failed", "cancelled"].includes(s.state)) {
          dispatch("stopCopyJobPolling", { jobId });

          if (s.state === "finished") {
            dispatch("updateContainers", { projectID: job.projectId });
          }
        }
      } catch (e) {
        commit("updateCopyJob", {
          jobId,
          patch: { state: "failed", error: String(e?.message || e) },
        });
        dispatch("stopCopyJobPolling", { jobId });
      }
    },
    stopCopyJobPolling(_, { jobId }) {
      if (pollers[jobId]) {
        clearInterval(pollers[jobId]);
        delete pollers[jobId];
      }
    },
    async cancelCopyJob({ state, commit, dispatch }, { jobId }) {
      const job = state.copyJobs[jobId];
      if (!job) return;
      // stop polling
      dispatch("stopCopyJobPolling", { jobId });
      commit("removeCopyJob", jobId);
      try {
        await cancelCopy(jobId, job.projectId);
      } finally {
        dispatch("updateContainers", { projectID: job.projectId });
      }
    },
    dismissCopyJob({ commit, dispatch }, { jobId }) {
      dispatch("stopCopyJobPolling", { jobId });
      commit("removeCopyJob", jobId);
    },
    async ensurePublicBase({ state, commit }, { projectID, signal }) {
      if (state.publicBase) return state.publicBase;
      const { base } = await getPublicBaseAddress(projectID, signal);
      commit("setPublicBase", base);
      return base;
   },
  },
});

export default store;
