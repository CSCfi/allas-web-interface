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
        <i class="mdi mdi-tune filter-icon" />
        {{ $t("message.filter.filter") }}
      </c-button>

      <span class="bucket-count">
        {{ resultCount }} {{ resultCount === 1
          ? $t("message.filter.bucket") : $t("message.filter.buckets") }}
      </span>
    </div>

    <div
      v-if="activeChips.length"
      class="active-chips"
    >
      <c-button
        text
        size="small"
        @click="$emit('clear')"
      >
        {{ $t("message.filter.clearFilters") }}
      </c-button>

      <span
        v-for="chip in activeChips"
        :key="chip.key"
        class="chip"
      >
        <span class="chip-text">{{ chip.label }}</span>
        <button
          class="chip-x"
          :aria-label="$t('message.filter.removeFilter')"
          @click="removeChip(chip)"
        >
          ×
        </button>
      </span>
    </div>

    <teleport to="body">
      <div
        v-if="open"
        class="filter-overlay"
        @keydown.esc.prevent="closePanel"
      >
        <div
          class="filter-backdrop"
          @click="closePanel"
        />

        <div
          ref="panelEl"
          class="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="$t('message.filter.filter')"
          tabindex="-1"
          @click.stop
        >
          <div class="panel-header">
            <div class="title">
              {{ $t("message.filter.filter") }}
            </div>
            <c-button
              text
              size="small"
              @click="closePanel"
            >
              <i class="mdi mdi-close" />
            </c-button>
          </div>

          <div class="panel-body">
            <div class="section">
              <div class="section-title">
                {{ $t("message.filter.access") }}
              </div>

              <div class="check">
                <label>
                  <input
                    v-model="draft.shared"
                    type="checkbox"
                    value="from"
                  >
                  {{ $t("message.filter.sharedByYou") }}
                </label>
              </div>

              <div class="check">
                <label>
                  <input
                    v-model="draft.shared"
                    type="checkbox"
                    value="to"
                  >
                  {{ $t("message.filter.sharedWithYou") }}
                </label>
              </div>

              <div class="check">
                <label>
                  <input
                    v-model="draft.public"
                    type="checkbox"
                  >
                  {{ $t("message.filter.publicBuckets") }}
                </label>
              </div>

              <div class="hint">
                {{ $t("message.filter.combineHint") }}
              </div>
            </div>

            <div class="section">
              <div class="section-title">
                {{ $t("message.filter.sizeAndItems") }}
              </div>

              <div class="field-row">
                <label
                  class="field-label"
                  for="min-objects"
                >{{ $t("message.filter.minObjects") }}</label>
                <div class="field-controls">
                  <input
                    id="min-objects"
                    v-model.number="draft.minItems"
                    class="field-input"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                  >
                  <span class="field-suffix">
                    {{ $t("message.filter.objectsSuffix") }}
                  </span>
                </div>
              </div>

              <div class="field-row">
                <label
                  class="field-label"
                  for="min-size"
                >{{ $t("message.filter.minSize") }}</label>
                <div class="field-controls">
                  <input
                    id="min-size"
                    v-model.number="draft.minSize"
                    class="field-input"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                  >
                  <select
                    v-model="draft.minSizeUnit"
                    class="field-select"
                  >
                    <option value="MiB">MiB</option>
                    <option value="GiB">GiB</option>
                    <option value="TiB">TiB</option>
                  </select>
                </div>
              </div>

              <div class="hint">
                {{ $t("message.filter.disableHint") }}
              </div>
            </div>
          </div>
          <div class="panel-footer">
            <c-button
              outlined
              size="small"
              @click="closePanel"
            >
              {{ $t("message.filter.close") }}
            </c-button>
            <c-button
              size="small"
              @click="apply"
            >
              {{ $t("message.filter.apply") }}
            </c-button>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script>
export default {
  name: "BucketFilterDrawer",
  props: {
    resultCount: { type: Number, default: 0 },
  },
  emits: ["apply", "clear"],
  data() {
    return {
      open: false,
      draft: {
        shared: [],
        public: false,
        minItems: null,
        minSize: null,
        minSizeUnit: "GiB",
      },
    };
  },
  computed: {
    applied() {
      const q = this.$route.query || {};

      const shared = Array.isArray(q.shared)
        ? q.shared
        : q.shared ? String(q.shared).split(",").filter(Boolean) : [];

      const isPublic = q.public === "1" || q.public === 1 || q.public === true;

      const minItems = q.minItems !== undefined ? Number(q.minItems) : null;
      const minSizeMiB = q.minSizeMiB !== undefined ? Number(q.minSizeMiB) : null;

      const minSize = q.minSize !== undefined ? Number(q.minSize) : null;
      const minSizeUnit = q.minSizeUnit ? String(q.minSizeUnit) : null;

      return {
        shared,
        public: !!isPublic,
        minItems: Number.isFinite(minItems) ? minItems : null,
        minSizeMiB: Number.isFinite(minSizeMiB) ? minSizeMiB : null,
        minSize: Number.isFinite(minSize) ? minSize : null,
        minSizeUnit: ["MiB", "GiB", "TiB"].includes(minSizeUnit) ? minSizeUnit : null,
      };
    },

    activeChips() {
      const chips = [];

      for (const s of this.applied.shared) {
        if (s === "from") {
          chips.push({
            key: "shared:from",
            type: "shared",
            value: "from",
            label: this.$t("message.filter.sharedByYou"),
          });
        }
        if (s === "to") {
          chips.push({
            key: "shared:to",
            type: "shared",
            value: "to",
            label: this.$t("message.filter.sharedWithYou"),
          });
        }
      }

      if (this.applied.public) {
        chips.push({
          key: "public:1",
          type: "public",
          value: "1",
          label: this.$t("message.filter.publicChip"),
        });
      }

      if (Number.isFinite(this.applied.minItems) && this.applied.minItems > 0) {
        chips.push({
          key: `minItems:${this.applied.minItems}`,
          type: "minItems",
          value: String(this.applied.minItems),
          label: `≥ ${this.applied.minItems} ${this.$t("message.filter.objectsSuffix")}`,
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

      return chips;
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
      this.draft.public = !!this.applied.public;
      this.draft.minItems = this.applied.minItems ?? null;

      if (this.applied.minSize != null && this.applied.minSizeUnit) {
        this.draft.minSize = this.applied.minSize;
        this.draft.minSizeUnit = this.applied.minSizeUnit;
      } else if (this.applied.minSizeMiB != null) {
        this.draft.minSizeUnit = "MiB";
        this.draft.minSize = this.applied.minSizeMiB;
      } else {
        this.draft.minSizeUnit = "GiB";
        this.draft.minSize = null;
      }
    },

    apply() {
      const shared = Array.from(new Set(this.draft.shared || []));
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
        public: isPublic ? "1" : null,
        minItems: minItems != null ? String(minItems) : null,
        minSizeMiB: minSizeMiB != null ? String(minSizeMiB) : null,
        minSize: minSizeNum != null ? String(minSizeNum) : null,
        minSizeUnit: minSizeNum != null ? unit : null,
      };

      this.$emit("apply", patch);
      this.closePanel();
    },

    removeChip(chip) {
      const next = {
        shared: [...this.applied.shared],
        public: !!this.applied.public,
        minItems: this.applied.minItems,
        minSizeMiB: this.applied.minSizeMiB,
        minSize: this.applied.minSize,
        minSizeUnit: this.applied.minSizeUnit,
      };

      if (chip.type === "shared") {
        next.shared = next.shared.filter((x) => x !== chip.value);
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

      const patch = {
        shared: next.shared.length ? next.shared.join(",") : null,
        public: next.public ? "1" : null,
        minItems: next.minItems != null ? String(next.minItems) : null,
        minSizeMiB: next.minSizeMiB != null ? String(next.minSizeMiB) : null,
        minSize: next.minSizeMiB != null && next.minSize != null
          ? String(next.minSize) : null,
        minSizeUnit: next.minSizeMiB != null && next.minSizeUnit
          ? String(next.minSizeUnit) : null,
      };

      this.$emit("apply", patch);
    },
  },
};
</script>

<style>
.filter-top {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

.filter-icon {
  margin-right: .5rem;
}

.bucket-count {
  font-size: 14px;
  color: var(--csc-dark-grey, #4b5563);
  white-space: nowrap;
}

.filter-wrap {
  display: flex;
  flex-direction: column;
  gap: .5rem;
  max-width: 100%;
}

.active-chips {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  align-items: center;
  max-width: 100%;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  padding: .25rem .5rem;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #fff;
  max-width: 100%;
}

.chip-text {
  font-size: 12px;
}

.chip-x {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 .2rem;
}

.filter-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
}

.filter-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, .35);
}

.panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(520px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .2);
  display: flex;
  flex-direction: column;
  outline: none;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem .75rem;
  border-bottom: 1px solid #eee;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #2e3438;
}

.panel-body {
  padding: 1rem;
  overflow: auto;
  flex: 1;
}

.section {
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #f2f2f2;
}

.section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.section-title {
  font-weight: 700;
  margin-bottom: .75rem;
}

.check {
  margin: .5rem 0;
}

.check label {
  display: flex;
  align-items: center;
  gap: .5rem;
}

.hint {
  margin-top: .5rem;
  font-size: 12px;
  color: #6b7280;
}

.panel-footer {
  padding: .75rem 1rem 1rem;
  display: flex;
  justify-content: space-between;
  gap: .75rem;
  border-top: 1px solid #eee;
}

.field-row {
  display: grid;
  grid-template-columns: 130px 1fr;
  align-items: center;
  column-gap: 1rem;
  row-gap: 0.5rem;
  margin: 0.65rem 0;
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
