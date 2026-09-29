<template>
  <div class="contents container-box">
    <div id="optionsbar">
      <div class="options-row">
        <!--<SearchBox :containers="renderingContainers" />-->
        <div class="row-left">
          <BucketFilterDrawer
            :result-count="displayedCount"
            @apply="onFilterApply"
            @clear="onFilterClear"
          />
        </div>
        <div class="row-end">
          <c-button
            size="small"
            outlined
            :disabled="projectSuspended"
            data-testid="create-bucket"
            @click="toggleCreateBucketModal"
            @keyup.enter="toggleCreateBucketModal"
          >
            <c-icon :path="mdiPlus" />
            {{ $t("message.createBucket") }}
          </c-button>
        </div>
      </div>
    </div>
    <c-alert
      v-if="projectSuspended"
      class="suspended-alert"
      type="warning"
      data-testid="suspended-alert"
    >
      {{ $t("message.emptyProject.suspended") }}
    </c-alert>

    <div id="cont-table-wrapper">
      <ContainerTable
        :conts="renderingContainers"
        :show-timestamp="showTimestamp"
        :disable-pagination="hidePagination"
        @delete-container="(cont) => removeContainer(cont)"
      />
      <c-loader v-show="contsLoading" />
    </div>
    <c-toasts
      id="container-toasts"
      data-testid="container-toasts"
    />
  </div>
</template>

<script>
import { liveQuery } from "dexie";
import { getDB } from "@/common/idb";
import { updateContainers, updateBucketStats } from "@/common/idbFunctions";
import { useObservable } from "@vueuse/rxjs";
import { getBucketStats, getBucketPublicStatus } from "@/common/s3commands";
import { mdiPlus } from "@mdi/js";
import { toggleCreateBucketModal, DEV } from "@/common/globalFunctions";
import { getAccessDetails, getSharingContainers } from "@/common/share";
import ContainerTable from "@/components/ContainerTable.vue";
import BucketFilterDrawer from "@/components/BucketFilterDrawer.vue";
//import SearchBox from "@/components/SearchBox.vue";

export default {
  name: "ContainersView",
  components: {
    ContainerTable,
    BucketFilterDrawer,
    //SearchBox,
  },
  data: function () {
    return {
      mdiPlus,
      showTimestamp: false,
      hidePagination: false,
      abortController: null,
      abortRenderingController: null,
      containers: [], // idb bucket data
      enrichedContainers: [], // merged bucket list with sharing info
      renderingContainers: [], // enriched and filtered data for table
      publicStatusCache: new Map(), // bucket name -> bool, for the public filter
      filterRun: 0,
      contsLoading: false,
    };
  },
  computed: {
    readyToSetUp() {
      return (this.active?.id && this.$store.sharingClient);
    },
    active() {
      return this.$store.active;
    },
    isBucketUploading() {
      return this.$store.isUploading;
    },
    sharingUpdated() {
      return this.$store.sharingUpdated;
    },
    locale() {
      return this.$i18n.locale;
    },
    projectSuspended() {
      return this.$store.projectSuspended;
    },
    displayedCount() {
      return (this.renderingContainers || []).length;
    },
  },
  watch: {
    readyToSetUp: function() {
      this.setUpIfReady();
    },
    containers: async function() {
      if (!this.containers?.length)  {
        this.renderingContainers = [];
        return;
      }

      // Abort previous update
      this.abortRenderingController?.abort({ reason: "Abort duplicate" });
      this.abortRenderingController = new AbortController();
      const { signal } = this.abortRenderingController;

      // Segment buckets are never displayed; mark their parents with hasSegments
      const segmentNames = new Set(
        this.containers
          .filter(b => b.name.endsWith("_segments"))
          .map(b => b.name.slice(0, -"_segments".length)),
      );
      const bucketsNoSegments = this.containers
        .filter(bucket => !bucket.name.endsWith("_segments"))
        .map(bucket => ({ ...bucket, hasSegments: segmentNames.has(bucket.name) }));

      // Single merged view: own, shared-to and shared-from buckets are
      // all in one list; the filter drawer narrows it via query params
      const sharingBuckets = await getSharingContainers(
        this.$route.params.project,
        signal,
      );
      const sharingSet = new Set(sharingBuckets);

      // For buckets shared BY this project, resolve the granted access
      // levels so the sharing column can show them
      const sharedAccessMap = await this.fetchSharedAccess(
        bucketsNoSegments.filter(bucket => sharingSet.has(bucket.name)),
        signal,
      );

      const sharedBuckets = await this.enrichSharedBuckets(bucketsNoSegments, signal);
      const sharedMap = new Map(sharedBuckets.map(bucket => [bucket.name, bucket]));

      // Combine buckets
      const finalBuckets = bucketsNoSegments.map(bucket => {
        if (sharedMap.has(bucket.name)) {
          return {
            ...bucket,
            ...sharedMap.get(bucket.name),
            sharing: "shared",
          };
        }

        else if (sharingSet.has(bucket.name)) {
          return {
            ...bucket,
            sharing: "sharing",
            sharedAccess: sharedAccessMap.get(bucket.name) || [],
          };
        }

        return {
          ...bucket,
          sharing: "none",
        };
      });

      if (!signal?.aborted) {
        this.enrichedContainers = finalBuckets;
        await this.applyFilters();
        this.contsLoading = false;
      }
    },
    "$route.query": {
      deep: true,
      handler() {
        this.applyFilters();
      },
    },
    isBucketUploading(newValue) {
      if (newValue === false) {
        this.contsLoading = true;
        setTimeout(() => {
          this.fetchContainers();
          this.contsLoading = false;
        }, 3000);
        this.loadBucketStats();
      }
    },
    $route(to, from) {
      if (!to.params.container && from.params.container) {
        this.loadBucketStats();
      }
    },
    sharingUpdated(newValue) {
      // Sharing updated by user or via sharing sync
      if (newValue) {
        this.fetchContainers(true);
        this.$store.setSharingUpdated(false);
      }
    },
  },
  created() {
    this.abortController = new AbortController();
    this.abortRenderingController = new AbortController();
    this.setUpIfReady();
  },
  beforeUnmount() {
    this.abortController.abort({ reason: "Unmounting component" });
    this.abortRenderingController.abort({ reason: "Unmounting component" });

  },
  methods: {
    setUpIfReady: async function () {
      // Check id: not available on created on page refresh
      if (this.readyToSetUp) {
        this.fetchContainers(true);
      }
    },
    enrichSharedBuckets: async function (buckets, signal) {
      try {
        let shared = await Promise.all(
          buckets
            .filter(bucket => bucket.owner)
            // Get access details for each bucket
            .map(async(bucket) => {
              if (signal?.aborted) throw signal?.reason;
              const sharedDetails = await getAccessDetails(
                this.$route.params.project,
                bucket.name,
                bucket.owner,
                signal);
              const accessRights = sharedDetails ? sharedDetails.access : null;
              if (accessRights !== null) return {...bucket, accessRights, sharing: "shared"};
            }),
        );
        // Remove buckets that share details don't exist for
        shared = shared.filter(bucket => !!bucket);
        return shared;
      } catch {
        return [];
      }
    },
    fetchSharedAccess: async function (buckets, signal) {
      // Per-recipient access lists for buckets shared by this project
      const accessMap = new Map();
      const CONCURRENCY = 5;
      for (let i = 0; i < buckets.length; i += CONCURRENCY) {
        if (signal?.aborted) break;
        const batch = buckets.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (bucket) => {
          try {
            const details = await this.$store.sharingClient.getShareDetails(
              this.$route.params.project,
              bucket.name,
              signal,
            );
            if (Array.isArray(details)) {
              accessMap.set(bucket.name, details.map(d => d.access));
            }
          } catch {
            // Sharing column just shows no access detail for this bucket
          }
        }));
      }
      return accessMap;
    },
    applyFilters: async function () {
      const myRun = ++this.filterRun;
      const q = this.$route.query || {};

      const shared = Array.isArray(q.shared)
        ? q.shared
        : q.shared ? String(q.shared).split(",").filter(Boolean) : [];
      const wantFrom = shared.includes("from");
      const wantTo = shared.includes("to");
      const wantPublic = q.public === "1" || q.public === 1 || q.public === true;
      const minItems = Number(q.minItems) > 0 ? Number(q.minItems) : null;
      const minSizeMiB = Number(q.minSizeMiB) > 0 ? Number(q.minSizeMiB) : null;

      // Display toggles also live in the filter query
      this.showTimestamp = q.exactTime === "1";
      this.hidePagination = q.showAll === "1";

      let filtered = this.enrichedContainers;

      if (wantFrom || wantTo) {
        filtered = filtered.filter(cont =>
          (wantFrom && cont.sharing === "sharing")
          || (wantTo && cont.sharing === "shared"),
        );
      }
      if (minItems != null) {
        filtered = filtered.filter(cont => (cont.count || 0) >= minItems);
      }
      if (minSizeMiB != null) {
        const minBytes = minSizeMiB * 1024 * 1024;
        filtered = filtered.filter(cont => (cont.bytes || 0) >= minBytes);
      }
      if (wantPublic) {
        // Public status isn't kept on the bucket objects — resolve it
        // on demand and cache for the session. Shared-in buckets can't
        // be queried and are treated as not public.
        await this.ensurePublicStatuses(
          filtered.filter(cont => !cont.owner),
        );
        if (myRun !== this.filterRun) return; // superseded run
        filtered = filtered.filter(
          cont => !cont.owner && this.publicStatusCache.get(cont.name) === true,
        );
      }

      this.renderingContainers = filtered;
    },
    ensurePublicStatuses: async function (buckets) {
      const missing = buckets.filter(
        bucket => !this.publicStatusCache.has(bucket.name),
      );
      const CONCURRENCY = 5;
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const batch = missing.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (bucket) => {
          try {
            const status = await getBucketPublicStatus(bucket.name);
            this.publicStatusCache.set(bucket.name, status.public === true);
          } catch {
            this.publicStatusCache.set(bucket.name, false);
          }
        }));
      }
    },
    onFilterApply: function (queryPatch) {
      const query = { ...this.$route.query, ...queryPatch };
      for (const key of Object.keys(query)) {
        if (query[key] === null || query[key] === undefined
          || query[key] === "") {
          delete query[key];
        }
      }
      this.$router.push({ query });
    },
    onFilterClear: function () {
      const {
        shared, public: pub, minItems, minSizeMiB, minSize, minSizeUnit,
        exactTime, showAll,
        ...rest
      } = this.$route.query || {};
      this.$router.push({ query: rest });
    },
    fetchContainers: async function (withLoader = false) {
      if (this.active.id === undefined
        || this.abortController.signal?.aborted) {
        return;
      }
      if (withLoader) this.contsLoading = true;

      this.containers = useObservable(
        liveQuery(() =>
          getDB().containers
            .where({ projectID: this.active.id })
            .toArray(),
        ),
      );

      try {
        await updateContainers(this.active.id, this.abortController.signal);
        if (!this.projectSuspended) {
          this.loadBucketStats();
        }
      } catch (err) {
        if (DEV) console.log("Failed to update the bucket listing", err);
      } finally {
        this.contsLoading = false;
      }
    },
    loadBucketStats: async function () {
      const projectID = this.active.id;
      const signal = this.abortController.signal;

      const allBuckets = await getDB().containers
        .where({ projectID })
        .toArray();

      const CONCURRENCY = 5;
      const statsMap = new Map();

      // Phase 1: fetch HeadBucket stats. Shared-in buckets are included:
      // the share policy grants s3:ListBucket, which HeadBucket needs.
      // Failures (e.g. revoked access) return null and are skipped.
      for (let i = 0; i < allBuckets.length; i += CONCURRENCY) {
        if (signal?.aborted) return;
        const batch = allBuckets.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (bucket) => {
          if (signal?.aborted) return;
          const stats = await getBucketStats(bucket.name);
          if (stats) statsMap.set(bucket.name, stats);
        }));
      }

      // Phase 2: roll up _segments bytes into parent, write to IDB
      // If no _segments buckets exist (Swift deprecated) this is a no-op.
      for (const bucket of allBuckets) {
        if (bucket.name.endsWith("_segments")) continue;
        const stats = statsMap.get(bucket.name);
        if (!stats) continue;

        const segStats = statsMap.get(`${bucket.name}_segments`);
        if (segStats) stats.bytes += segStats.bytes;

        await updateBucketStats(projectID, bucket.name, stats.count, stats.bytes);
      }
    },
    removeContainer: async function(container) {
      await getDB().containers.where({
        projectID: this.active.id,
        name: container,
      }).delete();

      await getDB().containers.where({
        projectID: this.active.id,
        name: `${container}_segments`,
      }).delete();
    },
    toggleCreateBucketModal,
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
  padding-left: 0.75rem;
}

#cont-table-wrapper {
  position: relative;
}

.suspended-alert {
  margin-bottom: 1rem;
}

.row-end {
  display: flex;
  flex-direction: row;
  gap: 1.5rem;
}
.row-end > * {
  align-self: center;
}

</style>
