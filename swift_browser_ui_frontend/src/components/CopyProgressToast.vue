<template>
  <div v-if="progress" class="copy-toast-stack" aria-live="polite">
    <div class="copy-toast-card">
      <div class="copy-toast-top">
        <div class="copy-toast-title">
          <div class="title is-6">{{ progress.label }}</div>
          <div class="copy-toast-sub">
            <template v-if="progress.state === 'running'">
              {{ $t("message.copyinprogress") }}
            </template>
            <template v-else-if="progress.state === 'finished'">
              {{ $t("message.copysuccess") }}
            </template>
            <template v-else-if="progress.state === 'failed'">
              {{ $t("message.copyfail") }}
            </template>
          </div>
        </div>
        <span class="copy-toast-pill" :data-state="progress.state">
          {{ progress.state }}
        </span>
      </div>

      <div class="copy-toast-progress">
        <c-progress-bar
          v-if="progress.total > 0"
          :value="percent"
          single-line
          :label="$t('message.upload.progressLabel')"
        />
        <c-progress-bar
          v-else
          single-line
          indeterminate
        />
        <div v-if="progress.total > 0" class="copy-toast-meta">
          {{ progress.done }} / {{ progress.total }}
        </div>
      </div>

      <div class="copy-toast-actions">
        <c-button
          v-if="progress.state === 'running'"
          size="small"
          outlined
          @click="cancel"
        >
          {{ $t("message.cancel") }}
        </c-button>
        <c-button
          v-else
          size="small"
          outlined
          @click="dismiss"
        >
          {{ $t("message.close") }}
        </c-button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "CopyProgressToast",
  computed: {
    progress() {
      return this.$store.copyProgress;
    },
    percent() {
      if (!this.progress?.total) return 0;
      return Math.min(100, Math.floor((this.progress.done / this.progress.total) * 100));
    },
  },
  methods: {
    cancel() {
      this.$store.clearCopyProgress();
    },
    dismiss() {
      this.$store.clearCopyProgress();
    },
  },
};
</script>

<style scoped>
.copy-toast-stack {
  position: fixed;
  left: 50%;
  bottom: 3rem;
  transform: translateX(-50%);
  z-index: 2000;
  width: min(640px, calc(100vw - 2rem));
}

.copy-toast-card {
  background: var(--csc-white, #fff);
  color: var(--csc-dark, #222);
  border-radius: 6px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.18);
  padding: 1.25rem 1.25rem 1rem 1.25rem;
  border: 2px solid #5bb318;
  border-left: 10px solid #5bb318;
  overflow: hidden;
}

.copy-toast-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.copy-toast-sub {
  margin-top: 0.25rem;
  opacity: 0.9;
  font-size: 14px;
}

.copy-toast-pill {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--csc-light-grey, #eee);
  text-transform: capitalize;
  white-space: nowrap;
  margin-top: 2px;
}

.copy-toast-progress {
  margin-top: 0.75rem;
}

.copy-toast-meta {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 0.35rem;
}

.copy-toast-actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-start;
}
</style>
