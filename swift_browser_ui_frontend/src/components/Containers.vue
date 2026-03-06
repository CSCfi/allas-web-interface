<template>
  <div class="contents">
    <div id="optionsbar">
      <div class="options-row options-row--search">
        <div class="row-left">
          <div class="search-wrap">
            <SearchBox :containers="containers || []" />
          </div>
        </div>
        <div class="row-end"></div>
      </div>
      <div class="options-row options-row--actions">
        <div class="row-left">
          <FolderFilterDrawer
            :all-containers="containers || []"
            :result-count="displayedCount"
            @apply="onFilterApply"
            @clear="onFilterClear"
          />
        </div>

        <div class="row-end">
          <c-button
            size="small"
            outlined
            data-testid="create-folder"
            @click="toggleCreateFolderModal(false)"
            @keyup.enter="toggleCreateFolderModal(true)"
          >
            <c-icon :path="mdiPlus" />
            {{ $t("message.createFolder") }}
          </c-button>
        </div>
      </div>
    </div>

    <div id="cont-table-wrapper">
      <ContainerTable
        ref="containerTable"
        :conts="renderingContainers"
        :show-timestamp="showTimestamp"
        :disable-pagination="hidePagination"
        :hide-tags="hideTags"
        @delete-container="(cont) => removeContainer(cont)"
      />
      <c-loader v-show="contsLoading" />
    </div>

    <c-toasts id="container-toasts" data-testid="container-toasts" />
  </div>
</template>

<script>
import { liveQuery } from "dexie";
import { getDB } from "@/common/db";
import { useObservable } from "@vueuse/rxjs";
import { mdiPlus } from "@mdi/js";
import {
  getSharingContainers,
  updateObjectsAndObjectTags,
  toggleCreateFolderModal,
} from "@/common/globalFunctions";
import ContainerTable from "@/components/ContainerTable.vue";
import { setPrevActiveElement } from "@/common/keyboardNavigation";
import FolderFilterDrawer from "@/components/FolderFilterDrawer.vue";
import SearchBox from "@/components/SearchBox.vue";

export default {
  name: "ContainersView",
  components: {
    ContainerTable,
    FolderFilterDrawer,
    SearchBox,
  },
  data: function () {
    return {
      mdiPlus,
      currentProject: {},
      showTimestamp: false,
      hidePagination: false,
      hideTags: false,
      selected: undefined,
      isPaginated: true,
      perPage: 15,
      direction: "asc",
      currentPage: 1,
      showTags: true,
      abortController: null,
      containers: [],
      renderingContainers: [],
      containersToUpdateObjs: [],
      contsLoading: false,
    };
  },
  computed: {
    active() {
      return this.$store.state.active;
    },
    isFolderUploading() {
      return this.$store.state.isUploading;
    },
    isFolderCopied() {
      return this.$store.state.isFolderCopied;
    },
    newFolder() {
      return this.$store.state.newFolder;
    },
    locale() {
      return this.$i18n.locale;
    },
    displayedCount() {
      const list = Array.isArray(this.renderingContainers) ? this.renderingContainers : [];
      return list.filter(c => c && typeof c.name === "string" && !c.name.endsWith("_segments")).length;
    },
  },
  watch: {
    active() {
      this.fetchContainers(true);
    },

    currentProject() {
      const saved = this.currentProject.displayOptions;
      if (saved) {
        this.hideTags = saved.hideTags;
        this.hidePagination = saved.hidePagination;
        this.showTimestamp = saved.showTimestamp;
      }
    },

    containers() {
      this.applyFilters();

      if (this.containers && this.newFolder) {
        const idx = this.containers.findIndex((c) => c.name === this.newFolder);
        if (idx > 0) {
          this.containers.unshift(this.containers.splice(idx, 1)[0]);
          this.$refs.containerTable?.toFirstPage?.();
        }
      }
    },

    "$route.query": {
      deep: true,
      handler() {
        this.applyFilters();
      },
    },

    isFolderUploading() {
      if (!this.isFolderUploading) {
        this.contsLoading = true;
        setTimeout(() => {
          this.fetchContainers();
          this.contsLoading = false;
        }, 3000);
      }
    },

    isFolderCopied() {
      if (this.isFolderCopied) {
        this.fetchContainers();
        this.$store.commit("setFolderCopiedStatus", false);
      }
    },

    locale() {
    },

    async containersToUpdateObjs() {
      if (this.contsLoading) setTimeout(() => (this.contsLoading = false), 100);
      await updateObjectsAndObjectTags(
        this.containersToUpdateObjs,
        this.active.id,
        this.abortController.signal,
      );
    },
  },
  beforeMount() {
    this.abortController = new AbortController();
    this.getDirectCurrentPage();
  },
  mounted() {
    this.fetchContainers(true);
  },
  beforeUnmount() {
    this.abortController.abort();
  },
  methods: {
    async applyFilters() {
      const q = this.$route.query || {};

      const shared = Array.isArray(q.shared)
        ? q.shared
        : q.shared
          ? String(q.shared).split(",").filter(Boolean)
          : [];

      const tags = Array.isArray(q.tags)
        ? q.tags
        : q.tags
          ? String(q.tags).split(",").filter(Boolean)
          : [];

      const wantAll = shared.includes("all") || shared.length === 0;
      const wantFrom = shared.includes("from");
      const wantTo = shared.includes("to");
      const isPublic = q.public === "1" || q.public === 1 || q.public === true;

      const matchTags = (cont) => {
        if (!tags.length) return true;
        const ct = Array.isArray(cont.tags) ? cont.tags : [];
        return tags.every((t) => ct.includes(t));
      };

      const matchPublic = (cont) => {
        if (!isPublic) return true;
        return !!cont.is_public;
      };

      const minItems = q.minItems !== undefined ? Number(q.minItems) : null;
      const minSizeMiB = q.minSizeMiB !== undefined ? Number(q.minSizeMiB) : null;
      const exactTime = q.exactTime === "1";
      const hideTags = q.hideTags === "1";
      const showAll = q.showAll === "1";

      const matchMinItems = (cont) => {
        if (!Number.isFinite(minItems) || minItems <= 0) return true;
        const count = Number(cont.count ?? cont.items ?? 0);
        return Number.isFinite(count) ? count >= minItems : true;
      };

      const matchMinSize = (cont) => {
        if (!Number.isFinite(minSizeMiB) || minSizeMiB <= 0) return true;
        const bytes = Number(cont.bytes ?? 0);
        if (!Number.isFinite(bytes)) return true;
        const contMiB = bytes / (1024 * 1024);
        return contMiB >= minSizeMiB;
      };

      const all = (this.containers || []).filter((c) =>
        matchTags(c) &&
        matchPublic(c) &&
        matchMinItems(c) &&
        matchMinSize(c)
      );

      if (wantAll && !wantFrom && !wantTo) {
        this.showTimestamp = exactTime;
        this.hideTags = hideTags;
        this.hidePagination = showAll;

        this.renderingContainers = all;
        return;
      }

      let fromSet = new Set();
      if (wantFrom) {
        const sharingList = await getSharingContainers(
          this.$route.params.project,
          this.abortController.signal,
        ).catch(() => []);
        fromSet = new Set(sharingList || []);
      }

      const filtered = all.filter((cont) => {
        const isTo = !!cont.owner;
        const isFrom = fromSet.has(cont.name);
        if (wantFrom && wantTo) return isFrom || isTo;
        if (wantFrom) return isFrom;
        if (wantTo) return isTo;
        return true;
      });

      this.renderingContainers = filtered;
      this.showTimestamp = exactTime;
      this.hideTags = hideTags;
      this.hidePagination = showAll;
    },

    onFilterApply(queryPatch) {
      const next = { ...this.$route.query, ...queryPatch, page: 1 };

      Object.keys(next).forEach((k) => {
        if (next[k] === null || next[k] === undefined || next[k] === "") {
          delete next[k];
        }
      });

      this.$router.push({ query: next });
    },

    onFilterClear() {
      const {
        shared,
        tags,
        public: _public,
        minItems,
        minSizeMiB,
        minSize,
        minSizeUnit,
        exactTime,
        hideTags,
        showAll,
        ...rest
      } = this.$route.query;

      this.$router.push({ query: { ...rest, page: 1 } });
    },
    fetchContainers: async function (withLoader = false) {
      if (this.active.id === undefined || this.abortController.signal?.aborted) return;
      if (withLoader) this.contsLoading = true;

      this.currentProject = await getDB().projects.get({ id: this.active.id });

      this.containersToUpdateObjs = await this.$store.dispatch("updateContainers", {
        projectID: this.active.id,
        signal: this.abortController.signal,
      });

      this.containers = useObservable(
        liveQuery(() => getDB().containers.where({ projectID: this.active.id }).toArray()),
      );
    },

    removeContainer: async function (container) {
      await getDB().containers.where({ projectID: this.active.id, name: container }).delete();
      await getDB().containers.where({ projectID: this.active.id, name: `${container}_segments` }).delete();
    },

    getDirectCurrentPage: function () {
      this.currentPage = this.$route.query.page ? parseInt(this.$route.query.page) : 1;
    },

    toggleCreateFolderModal: function (keypress) {
      toggleCreateFolderModal();
      if (keypress) setPrevActiveElement();
      setTimeout(() => {
        const newFolderInput = document.querySelector("#newFolder-input input");
        newFolderInput.tabIndex = "0";
        newFolderInput.focus();
      }, 300);
    },
  },
};
</script>

<style scoped>
#optionsbar {
  margin: 0.5em 0;
  background: #fff;
  overflow: visible;

  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.options-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.row-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.row-end {
  display: flex;
  flex-direction: row;
  gap: 1.5rem;
}
.row-end > * {
  align-self: center;
}

.search-wrap {
  width: 420px;
  max-width: 100%;
}

.search-wrap :deep(.searchBox),
.search-wrap :deep(.search) {
  width: 100%;
}
</style>
