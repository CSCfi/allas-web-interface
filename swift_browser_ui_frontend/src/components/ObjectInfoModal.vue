<template>
  <c-card
    ref="infoContainer"
    class="modal-card"
    data-testid="object-info-modal"
    @keydown="handleKeyDown"
  >
    <div
      id="object-info-modal-content"
      class="modal-content-wrapper"
    >
      <h2
        v-if="info"
        class="title is-4 title-row"
      >
        <c-icon
          :path="info.isFolder ? mdiFolder : mdiFileOutline"
          color="var(--c-primary-600)"
          size="20"
          class="title-icon-link"
        />
        {{ info.name }}
      </h2>

      <c-card-content>
        <div v-if="info">
          <p><b>{{ $t("message.table.name") }}:</b> {{ info.name }}</p>
          <p><b>{{ $t("message.table.size") }}:</b> {{ info.sizeHuman || "-" }}</p>
          <p v-if="info.isFolder">
            <b>{{ $t("message.objects.items") }}:</b> {{ info.itemCount }}
          </p>
          <p><b>{{ $t("message.objects.fullPath") }}:</b> {{ info.fullPath || "-" }}</p>
          <p><b>{{ $t("message.objects.contentType") }}:</b> {{ info.contentType || "-" }}</p>
          <p
            v-if="info.etag"
            class="inline-copy"
          >
            <b>ETag:</b>
            <span class="inline-copy-value">{{ info.etag }}</span>
            <c-button
              ghost
              class="copy-icon-btn"
              title="Copy ETag"
              aria-label="Copy ETag"
              @click="copyToClipboard(info.etag)"
              @keyup.enter="copyToClipboard(info.etag)"
            >
              <c-icon
                :path="mdiContentCopy"
              />
            </c-button>
          </p>
          <p><b>{{ $t("message.table.modified") }}:</b> {{ info.lastModified || "-" }}</p>
          <p v-if="!info.isFolder">
            <b>{{ $t("message.objects.created") }}:</b> {{ info.created || "-" }}
          </p>
          <p
            v-if="!info.isFolder"
            class="inline-copy"
          >
            <b>{{ $t("message.objects.checksum") }} (SHA-256):</b>
            <span class="inline-copy-value">{{ info.checksum || "-" }}</span>
            <c-button
              v-if="info.checksum && info.checksum !== '-'"
              ghost
              class="copy-icon-btn"
              title="Copy checksum"
              aria-label="Copy checksum"
              @click="copyToClipboard(info.checksum)"
              @keyup.enter="copyToClipboard(info.checksum)"
            >
              <c-icon
                :path="mdiContentCopy"
              />
            </c-button>
          </p>
          <p
            v-if="!info.isFolder"
            class="info-note"
          >
            {{ $t("message.objects.createdChecksumNote") }}
          </p>
        </div>

        <div v-else>
          {{ $t("message.objects.noInfo") }}
        </div>
      </c-card-content>
    </div>

    <c-card-actions justify="end">
      <c-button
        outlined
        size="large"
        @click="close"
        @keyup.enter="close"
      >
        {{ $t("message.close") }}
      </c-button>
    </c-card-actions>
  </c-card>
</template>

<script>
import {
  getFocusableElements,
  keyboardNavigationInsideModal,
  moveFocusOutOfModal,
} from "@/common/keyboardNavigation";
import { mdiFolder, mdiFileOutline, mdiContentCopy } from "@mdi/js";

export default {
  name: "ObjectInfoModal",
  data() {
    return {
      mdiFolder,
      mdiFileOutline,
      mdiContentCopy,
    };
  },
  computed: {
    info() {
      return this.$store.selectedObjectInfo;
    },
    prevActiveEl() {
      return this.$store.prevActiveEl;
    },
  },
  methods: {
    async copyToClipboard(value) {
      if (!value || value === "-") return;

      try {
        await navigator.clipboard.writeText(value);
      } catch (e) {
        const el = document.createElement("textarea");
        el.value = value;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
    },
    close() {
      this.$store.toggleObjectInfoModal(false);
      this.$store.setSelectedObjectInfo(null);
      moveFocusOutOfModal(this.prevActiveEl);
    },
    handleKeyDown(e) {
      const focusableList = this.$refs.infoContainer.querySelectorAll(
        "c-link, c-button, textarea, c-text-field, c-data-table",
      );
      const { first, last } = getFocusableElements(focusableList);
      keyboardNavigationInsideModal(e, first, last, true);
    },
  },
};
</script>

<style scoped>
c-card-content {
  padding: 1rem 0 0 0;
  color: var(--csc-dark);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.title-icon-link {
  pointer-events: none;
  display: inline-flex;
  margin-right: 0.25rem;
  line-height: 1;
}
.inline-copy {
  display: flex;
  gap: 0.4rem;
  margin-bottom: -25px;
}
.info-note {
  margin-top: 1.8rem;
  font-size: 0.9rem;
  font-style: italic;
  opacity: 0.75;
}
.inline-copy-value {
  word-break: break-all;
}
.copy-icon-btn {
  transform: scale(0.65);
  margin-left: 0.2rem;
  position: relative;
  top: -12px;
}
.copy-icon-btn:hover {
  opacity: 1;
}
</style>
