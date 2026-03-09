<template>
  <div class="filter-wrap">
    <div class="filter-top">
      <c-button
        size="small"
        outlined
        data-testid="open-filter"
        @click="openPanel"
        @keyup.enter="openPanel"
      >
        <i class="mdi mdi-tune" style="margin-right:.5rem;" />
        Filter
      </c-button>

      <span class="bucket-count">
        {{ resultCount }} {{ resultCount === 1 ? "bucket" : "buckets" }}
      </span>
    </div>

    <div class="active-chips" v-if="activeChips.length">
      <c-button text size="small" @click="$emit('clear')">Clear filters</c-button>

      <span class="chip" v-for="chip in activeChips" :key="chip.key">
        <span class="chip-text">{{ chip.label }}</span>
        <button
          class="chip-x"
          @click="removeChip(chip)"
          aria-label="Remove filter"
        >
          ×
        </button>
      </span>
    </div>

    <teleport to="body">
      <div v-if="open" class="filter-overlay" @keydown.esc.prevent="closePanel">
        <div class="filter-backdrop" @click="closePanel" />

        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="Filter"
          ref="panelEl"
          tabindex="-1"
          @click.stop
        >
          <div class="panel-header">
            <div class="title">Filter</div>
            <c-button text size="small" @click="closePanel">
              <i class="mdi mdi-close" />
            </c-button>
          </div>

          <div class="panel-body">
            <div class="section">
                <div class="section-title">Access</div>

                <div class="check">
                <label>
                    <input type="checkbox" value="from" v-model="draft.shared" />
                    Shared by you
                </label>
                </div>

                <div class="check">
                <label>
                    <input type="checkbox" value="to" v-model="draft.shared" />
                    Shared with you
                </label>
                </div>

                <div class="check">
                <label>
                    <input type="checkbox" v-model="draft.public" />
                    Public buckets
                </label>
                </div>

                <div class="hint">Tip: select multiple to combine views.</div>
            </div>

            <div class="section">
                <div class="section-title">Display</div>

                <div class="check">
                    <label>
                    <input type="checkbox" v-model="draft.exactTime" />
                    Show timestamp
                    </label>
                </div>

                <div class="check">
                    <label>
                    <input type="checkbox" v-model="draft.hideTags" />
                    Hide tags
                    </label>
                </div>

                <div class="check">
                    <label>
                    <input type="checkbox" v-model="draft.showAll" />
                    Disable pagination
                    </label>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Size & items</div>

                <div class="field-row">
                    <label class="field-label" for="min-objects">Minimum objects</label>
                    <div class="field-controls">
                    <input
                        id="min-objects"
                        class="field-input"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        v-model.number="draft.minItems"
                    />
                    <span class="field-suffix">objects</span>
                    </div>
                </div>

                <div class="field-row">
                    <label class="field-label" for="min-size">Minimum size</label>
                    <div class="field-controls">
                    <input
                        id="min-size"
                        class="field-input"
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder="0"
                        v-model.number="draft.minSize"
                    />
                    <select class="field-select" v-model="draft.minSizeUnit">
                        <option value="MiB">MiB</option>
                        <option value="GiB">GiB</option>
                        <option value="TiB">TiB</option>
                    </select>
                    </div>
                </div>

                <div class="hint">Leave blank or 0 to disable these filters.</div>
            </div>

            <div class="section">
                <div class="section-title">Tags</div>

                <div class="tag-grid">
                <label v-for="t in availableTags" :key="t" class="tag-pill">
                    <input type="checkbox" :value="t" v-model="draft.tags" />
                    <span>{{ t }}</span>
                </label>
                </div>

                <div class="hint" v-if="!availableTags.length">
                No tags found in this project.
                </div>
            </div>

          </div>
          <div class="panel-footer">
            <c-button outlined size="small" @click="closePanel">Close</c-button>
            <c-button size="small" @click="apply">Apply</c-button>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script>
export default {
  name: "FolderFilterDrawer",
  props: {
    allContainers: { type: Array, default: () => [] },
    resultCount: { type: Number, default: 0 },
  },
  emits: ["apply", "clear"],
  data() {
    return {
      open: false,
      draft: {
        shared: [],
        tags: [],
        public: false,
        minItems: null,
        minSize: null,
        minSizeUnit: "GiB",
        exactTime: false,
        hideTags: false,
        showAll: false,
      },
    };
  },
  computed: {
    availableTags() {
      const set = new Set();
      for (const c of this.allContainers || []) {
        const tags = Array.isArray(c.tags) ? c.tags : [];
        for (const t of tags) set.add(t);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },

    applied() {
      const q = this.$route.query || {};

      const shared = Array.isArray(q.shared)
        ? q.shared
        : q.shared ? String(q.shared).split(",").filter(Boolean) : [];

      const tags = Array.isArray(q.tags)
        ? q.tags
        : q.tags ? String(q.tags).split(",").filter(Boolean) : [];

      const isPublic = q.public === "1" || q.public === 1 || q.public === true;

      const minItems = q.minItems !== undefined ? Number(q.minItems) : null;
      const minSizeMiB = q.minSizeMiB !== undefined ? Number(q.minSizeMiB) : null;

      const minSize = q.minSize !== undefined ? Number(q.minSize) : null;
      const minSizeUnit = q.minSizeUnit ? String(q.minSizeUnit) : null;

      const exactTime = q.exactTime === "1";
      const hideTags = q.hideTags === "1";
      const showAll = q.showAll === "1";

      return {
        shared,
        tags,
        public: !!isPublic,
        minItems: Number.isFinite(minItems) ? minItems : null,
        minSizeMiB: Number.isFinite(minSizeMiB) ? minSizeMiB : null,
        minSize: Number.isFinite(minSize) ? minSize : null,
        minSizeUnit: ["MiB","GiB","TiB"].includes(minSizeUnit) ? minSizeUnit : null,
        exactTime,
        hideTags,
        showAll,
    };
    },

    activeChips() {
        const chips = [];

        for (const s of this.applied.shared) {
            if (s === "from") chips.push({ key: "shared:from", type: "shared", value: "from", label: "Shared by you" });
            if (s === "to") chips.push({ key: "shared:to", type: "shared", value: "to", label: "Shared with you" });
        }

        if (this.applied.public) {
            chips.push({ key: "public:1", type: "public", value: "1", label: "Public" });
        }

        for (const t of this.applied.tags) {
            chips.push({ key: `tag:${t}`, type: "tag", value: t, label: t });
        }

        if (Number.isFinite(this.applied.minItems) && this.applied.minItems > 0) {
            chips.push({
            key: `minItems:${this.applied.minItems}`,
            type: "minItems",
            value: String(this.applied.minItems),
            label: `≥ ${this.applied.minItems} objects`,
            });
        }

        if (Number.isFinite(this.applied.minSizeMiB) && this.applied.minSizeMiB > 0) {
            const mib = this.applied.minSizeMiB;
            let label = `≥ ${mib} MiB`;
            if (mib >= 1024 * 1024) label = `≥ ${(mib / (1024 * 1024)).toFixed(2)} TiB`;
            else if (mib >= 1024) label = `≥ ${(mib / 1024).toFixed(2)} GiB`;

            chips.push({
            key: `minSizeMiB:${mib}`,
            type: "minSizeMiB",
            value: String(mib),
            label,
            });
        }
        if (this.applied.exactTime) {
            chips.push({
                key: "display:exactTime",
                type: "display",
                value: "exactTime",
                label: "Timestamp",
            });
        }

        if (this.applied.hideTags) {
            chips.push({
                key: "display:hideTags",
                type: "display",
                value: "hideTags",
                label: "Hide tags",
            });
        }

        if (this.applied.showAll) {
            chips.push({
                key: "display:showAll",
                type: "display",
                value: "showAll",
                label: "Disable pagination",
            });
        }

        return chips;
    },

    activeCount() {
      return this.activeChips.length;
    },
  },
  watch: {
    open(val) {
      if (val) {
        this.syncDraft();
        document.body.style.overflow = "hidden";
        this.$nextTick(() => this.$refs.panelEl?.focus?.());
      } else {
        document.body.style.overflow = "";
      }
    },
  },
  beforeUnmount() {
    document.body.style.overflow = "";
  },
  methods: {
    openPanel() {
      this.open = true;
    },
    closePanel() {
      this.open = false;
    },

    syncDraft() {
        this.draft.shared = [...this.applied.shared];
        this.draft.tags = [...this.applied.tags];
        this.draft.public = !!this.applied.public;
        this.draft.exactTime = !!this.applied.exactTime;
        this.draft.hideTags = !!this.applied.hideTags;
        this.draft.showAll = !!this.applied.showAll;

        this.draft.minItems = this.applied.minItems ?? null;

        if (this.applied.minSize != null && this.applied.minSizeUnit) {
            this.draft.minSize = this.applied.minSize;
            this.draft.minSizeUnit = this.applied.minSizeUnit;
        } else if (this.applied.minSizeMiB != null) {
            const mib = this.applied.minSizeMiB;
            this.draft.minSizeUnit = "MiB";
            this.draft.minSize = mib;
        } else {
            this.draft.minSizeUnit = "GiB";
            this.draft.minSize = null;
        }
    },

    apply() {
        const shared = Array.from(new Set(this.draft.shared || []));
        const tags = Array.from(new Set(this.draft.tags || []));
        const isPublic = !!this.draft.public;

        const minItems =
            Number.isFinite(this.draft.minItems) && this.draft.minItems > 0
            ? Math.floor(this.draft.minItems)
            : null;

        const minSizeNum =
            Number.isFinite(this.draft.minSize) && this.draft.minSize > 0
            ? this.draft.minSize
            : null;

        const unit = this.draft.minSizeUnit || "GiB";
        const toMiB = (val) => {
            if (unit === "MiB") return val;
            if (unit === "GiB") return val * 1024;
            if (unit === "TiB") return val * 1024 * 1024;
            return val * 1024;
        };

        const minSizeMiB = minSizeNum != null ? +toMiB(minSizeNum).toFixed(2) : null;

        const patch = {
            shared: shared.length ? shared.join(",") : null,
            tags: tags.length ? tags.join(",") : null,
            public: isPublic ? "1" : null,
            minItems: minItems != null ? String(minItems) : null,
            minSizeMiB: minSizeMiB != null ? String(minSizeMiB) : null,
            minSize: minSizeNum != null ? String(minSizeNum) : null,
            minSizeUnit: minSizeNum != null ? unit : null,
            exactTime: this.draft.exactTime ? "1" : null,
            hideTags: this.draft.hideTags ? "1" : null,
            showAll: this.draft.showAll ? "1" : null,
        };

        this.$emit("apply", patch);
        this.closePanel();
    },

    clearDraft() {
        this.draft.shared = [];
        this.draft.tags = [];
        this.draft.public = false;
        this.draft.minItems = null;
        this.draft.minSize = null;
        this.draft.minSizeUnit = "GiB";
        this.draft.exactTime = false;
        this.draft.hideTags = false;
        this.draft.showAll = false;
    },

    removeChip(chip) {
        const next = {
            shared: [...this.applied.shared],
            tags: [...this.applied.tags],
            public: !!this.applied.public,
            minItems: this.applied.minItems,
            minSizeMiB: this.applied.minSizeMiB,
            minSize: this.applied.minSize,
            minSizeUnit: this.applied.minSizeUnit,
            exactTime: !!this.applied.exactTime,
            hideTags: !!this.applied.hideTags,
            showAll: !!this.applied.showAll,
        };

        if (chip.type === "shared") {
            next.shared = next.shared.filter((x) => x !== chip.value);
        }

        if (chip.type === "tag") {
            next.tags = next.tags.filter((x) => x !== chip.value);
        }

        if (chip.type === "public") {
            next.public = false;
        }

        if (chip.type === "minItems") {
            next.minItems = null;
        }

        if (chip.type === "minSizeMiB") {
            next.minSizeMiB = null;
            next.minSize = null;
            next.minSizeUnit = null;
        }

        if (chip.type === "display") {
            if (chip.value === "exactTime") next.exactTime = false;
            if (chip.value === "hideTags") next.hideTags = false;
            if (chip.value === "showAll") next.showAll = false;
        }

        const patch = {
            shared: next.shared.length ? next.shared.join(",") : null,
            tags: next.tags.length ? next.tags.join(",") : null,
            public: next.public ? "1" : null,
            minItems: next.minItems != null ? String(next.minItems) : null,
            minSizeMiB: next.minSizeMiB != null ? String(next.minSizeMiB) : null,
            minSize: next.minSizeMiB != null && next.minSize != null ? String(next.minSize) : null,
            minSizeUnit: next.minSizeMiB != null && next.minSizeUnit ? String(next.minSizeUnit) : null,
            exactTime: next.exactTime ? "1" : null,
            hideTags: next.hideTags ? "1" : null,
            showAll: next.showAll ? "1" : null,
        };

        this.$emit("apply", patch);
    }
  },
};
</script>

<style>
.filter-top {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

.bucket-count {
  font-size: 14px;
  color: var(--csc-dark-grey, #4b5563);
  white-space: nowrap;
}

.filter-wrap {
    display:flex;
    flex-direction:column;
    gap:.5rem;
    max-width:100%;
}

.badge {
    margin-left:.5rem;
    font-size:12px;
    padding:0 .45rem;
    border-radius:999px;
    background:var(--csc-primary-lighter);
    color:var(--csc-primary);
}

.active-chips {
    display:flex;
    flex-wrap:wrap;
    gap:.5rem;
    align-items:center;
    max-width:100%;
}

.chip {
    display:inline-flex;
    align-items:center;
    gap:.35rem;
    padding:.25rem .5rem;
    border:1px solid #e5e7eb;
    border-radius:999px;
    background:#fff;
    max-width:100%;
}

.chip-text {
    font-size:12px;

}
.chip-x {
    border:none;
    background:transparent;
    cursor:pointer;
    font-size:16px;
    line-height:1;
    padding:0 .2rem;
}

.filter-overlay {
    position:fixed;
    inset:0;
    z-index:3000;
}

.filter-backdrop {
    position:absolute;
    inset:0;
    background:rgba(0,0,0,.35);
}

.panel {
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%,-50%);
  width:min(520px, calc(100vw - 24px));
  max-height:calc(100vh - 24px);
  background:#fff;
  border-radius:10px;
  overflow:hidden;
  box-shadow:0 10px 30px rgba(0,0,0,.2);
  display:flex;
  flex-direction:column;
  outline:none;
}

.panel-header {
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:1rem 1rem .75rem;
    border-bottom:1px solid #eee;
}

.title {
    font-size:18px;
    font-weight:700;
    color:#2e3438;
}

.panel-body {
    padding:1rem;
    overflow:auto;
    flex:1;
}

.section {
    padding-bottom:1rem;
    margin-bottom:1rem;
    border-bottom:1px solid #f2f2f2;
}
.section:last-child {
    border-bottom:none;
    margin-bottom:0;
    padding-bottom:0;
}
.section-title {
    font-weight:700;
    margin-bottom:.75rem;
}
.check {
    margin:.5rem 0;
}
.check label {
    display:flex;
    align-items:center;
    gap:.5rem;
}

.hint {
    margin-top:.5rem;
    font-size:12px;
    color:#6b7280;
}


.tag-grid {
    display:flex;
    flex-wrap:wrap;
    gap:.5rem;
}

.tag-pill {
    display:inline-flex;
    align-items:center;
    gap:.4rem;
    border:1px solid #e5e7eb;
    border-radius:999px;
    padding:.25rem .6rem;
    cursor:pointer;
    user-select:none;
}

.tag-pill input {
    margin:0;
}

.panel-footer {
    padding:.75rem 1rem 1rem;
    display:flex;
    justify-content:space-between;
    gap:.75rem;
    border-top:1px solid #eee;
}

.field-row {
  display: grid;
  grid-template-columns: 130px 1fr;
  align-items: center;
  column-gap: 1rem;
  row-gap: 0.5rem;
  margin: 0.65rem 0;
}

.field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}


.field-label {
  font-size: 14px;
  color: #374151;
  margin: 0;
}

.field-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.field-input {
  width: 140px;
  padding: 0.35rem 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.field-select {
  min-width: 72px;
  padding: 0.35rem 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
  box-sizing: border-box;
}

.field-suffix {
  font-size: 13px;
  color: #4b5563;
}
</style>
